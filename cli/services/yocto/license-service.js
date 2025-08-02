const fs = require('fs-extra');
const path = require('path');

class LicenseService {
  constructor() {
    this.platformsPath = path.join(__dirname, '../../../data/silicon/platforms.json');
    this.licenseData = null;
    this.loadLicenseData();
  }

  async loadLicenseData() {
    try {
      if (await fs.pathExists(this.platformsPath)) {
        const data = await fs.readJson(this.platformsPath);
        this.licenseData = data.license_database || {};
      } else {
        console.warn('License database not found');
        this.licenseData = {};
      }
    } catch (error) {
      console.error('Error loading license data:', error.message);
      this.licenseData = {};
    }
  }

  /**
   * Check license compliance for a recipe
   */
  async checkRecipe(recipeName, recipePath = null) {
    const report = {
      recipeName,
      warnings: [],
      gplv3Components: [],
      recommendations: [],
      corporateApproved: [],
      alternatives: {},
      complianceScore: 100
    };

    try {
      // If recipe path provided, analyze the actual recipe file
      if (recipePath && await fs.pathExists(recipePath)) {
        const recipeContent = await fs.readFile(recipePath, 'utf8');
        await this.analyzeRecipeContent(recipeContent, report);
      } else {
        // Check against known package database
        await this.checkKnownPackage(recipeName, report);
      }

      // Calculate compliance score
      report.complianceScore = this.calculateComplianceScore(report);

      return report;

    } catch (error) {
      report.warnings.push(`Error analyzing recipe: ${error.message}`);
      report.complianceScore = 0;
      return report;
    }
  }

  /**
   * Analyze recipe file content for license information
   */
  async analyzeRecipeContent(content, report) {
    const lines = content.split('\n');
    
    // Extract license information
    const licenseMatches = content.match(/LICENSE\s*[=+]*\s*["']([^"']+)["']/g);
    const srcUriMatches = content.match(/SRC_URI\s*[=+]*\s*["']([^"']+)["']/g);
    const dependsMatches = content.match(/DEPENDS\s*[=+]*\s*["']([^"']+)["']/g);
    const rdependsMatches = content.match(/RDEPENDS[^=]*\s*[=+]*\s*["']([^"']+)["']/g);

    // Check licenses
    if (licenseMatches) {
      licenseMatches.forEach(match => {
        const license = match.replace(/LICENSE\s*[=+]*\s*["']([^"']+)["']/, '$1').trim();
        this.analyzeLicense(license, report);
      });
    } else {
      report.warnings.push('No LICENSE field found in recipe');
      report.complianceScore -= 20;
    }

    // Check dependencies for known GPLv3 packages
    const allDeps = [
      ...(dependsMatches || []),
      ...(rdependsMatches || [])
    ];

    allDeps.forEach(depMatch => {
      const deps = depMatch.replace(/R?DEPENDS[^=]*\s*[=+]*\s*["']([^"']+)["']/, '$1')
        .split(/\s+/)
        .filter(dep => dep.trim());
      
      deps.forEach(dep => {
        if (this.licenseData.gplv3_packages?.includes(dep)) {
          report.gplv3Components.push(`${dep} (dependency)`);
          report.warnings.push(`Dependency '${dep}' is GPLv3 licensed`);
        }
      });
    });

    // Check for security-sensitive patterns
    this.checkSecurityPatterns(content, report);
  }

  /**
   * Check known package against license database
   */
  async checkKnownPackage(packageName, report) {
    const { gplv3_packages, corporate_approved, alternatives } = this.licenseData;

    // Check if package is known GPLv3
    if (gplv3_packages?.includes(packageName)) {
      report.gplv3Components.push(packageName);
      report.warnings.push(
        `WARNING: ${packageName} is GPLv3 licensed. Many companies prohibit GPLv3 in embedded products due to copyleft requirements. Please check your organization's license policy.`
      );
      
      // Suggest alternatives if available
      if (alternatives?.[packageName]) {
        report.alternatives[packageName] = alternatives[packageName];
        report.recommendations.push(
          `Consider using alternatives to ${packageName}: ${alternatives[packageName].join(', ')}`
        );
      }
    }

    // Check if package is in corporate-approved lists
    for (const [licenseType, packages] of Object.entries(corporate_approved || {})) {
      if (packages.includes(packageName)) {
        report.corporateApproved.push({
          package: packageName,
          license: licenseType.toUpperCase(),
          status: 'approved'
        });
      }
    }
  }

  /**
   * Analyze individual license strings
   */
  analyzeLicense(licenseString, report) {
    const licenses = licenseString.split(/\s*[&|]\s*/).map(l => l.trim());
    
    licenses.forEach(license => {
      const normalizedLicense = license.toLowerCase().replace(/[-_.]/g, '');
      
      // Check for GPLv3
      if (normalizedLicense.includes('gplv3') || 
          normalizedLicense.includes('gpl-3') ||
          normalizedLicense.includes('gpl3')) {
        report.gplv3Components.push(`License: ${license}`);
        report.warnings.push(
          `WARNING: License '${license}' is GPLv3. Many companies prohibit GPLv3 in embedded products due to copyleft requirements. Please check your organization's license policy.`
        );
      }

      // Check for other concerning licenses
      if (normalizedLicense.includes('agpl')) {
        report.warnings.push(`AGPL license '${license}' detected - extremely restrictive for commercial use`);
      }

      // Check for unknown or custom licenses
      const knownLicenses = [
        'mit', 'bsd', 'apache', 'lgpl', 'gpl', 'mpl', 'eclipse', 'cddl',
        'artistic', 'perl', 'ruby', 'python', 'zlib', 'libpng', 'openssl'
      ];
      
      if (!knownLicenses.some(known => normalizedLicense.includes(known))) {
        report.warnings.push(`Unknown or custom license '${license}' - requires manual review`);
      }

      // Positive recommendations for preferred licenses
      if (['mit', 'bsd', 'apache'].some(pref => normalizedLicense.includes(pref))) {
        report.recommendations.push(`License '${license}' is generally corporate-friendly`);
      }
    });
  }

  /**
   * Check for security-sensitive patterns in recipe
   */
  checkSecurityPatterns(content, report) {
    const securityPatterns = [
      {
        pattern: /INSANE_SKIP.*security/i,
        message: 'Recipe skips security checks - review carefully'
      },
      {
        pattern: /--disable-(ssl|tls|crypto|security)/i,
        message: 'Security features may be disabled - verify this is intentional'
      },
      {
        pattern: /--enable-debug/i,
        message: 'Debug mode enabled - may expose sensitive information in production'
      },
      {
        pattern: /COMPATIBLE_HOST.*=.*""/,
        message: 'Empty COMPATIBLE_HOST may allow building on unintended architectures'
      },
      {
        pattern: /do_install_append.*chmod.*777/,
        message: 'Overly permissive file permissions (777) detected'
      }
    ];

    securityPatterns.forEach(({ pattern, message }) => {
      if (pattern.test(content)) {
        report.warnings.push(`Security: ${message}`);
        report.complianceScore -= 5;
      }
    });
  }

  /**
   * Calculate overall compliance score
   */
  calculateComplianceScore(report) {
    let score = 100;

    // Deduct points for GPLv3 components
    score -= report.gplv3Components.length * 25;

    // Deduct points for warnings
    score -= report.warnings.length * 5;

    // Add points for corporate-approved components
    score += report.corporateApproved.length * 5;

    // Ensure score doesn't go below 0 or above 100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Generate license compliance report for entire project
   */
  async analyzeProject(projectPath) {
    const report = {
      projectPath,
      recipes: [],
      summary: {
        totalRecipes: 0,
        gplv3Count: 0,
        warningCount: 0,
        averageScore: 0,
        criticalIssues: []
      },
      recommendations: []
    };

    try {
      // Find all recipe files
      const recipeFiles = await this.findRecipeFiles(projectPath);
      
      for (const recipeFile of recipeFiles) {
        const recipeName = path.basename(recipeFile, '.bb');
        const recipeReport = await this.checkRecipe(recipeName, recipeFile);
        report.recipes.push(recipeReport);
      }

      // Generate summary
      report.summary.totalRecipes = report.recipes.length;
      report.summary.gplv3Count = report.recipes.filter(r => r.gplv3Components.length > 0).length;
      report.summary.warningCount = report.recipes.reduce((sum, r) => sum + r.warnings.length, 0);
      report.summary.averageScore = report.recipes.length > 0 
        ? report.recipes.reduce((sum, r) => sum + r.complianceScore, 0) / report.recipes.length
        : 0;

      // Identify critical issues
      report.recipes.forEach(recipe => {
        if (recipe.gplv3Components.length > 0) {
          report.summary.criticalIssues.push({
            type: 'gplv3',
            recipe: recipe.recipeName,
            components: recipe.gplv3Components
          });
        }
      });

      // Generate project-level recommendations
      this.generateProjectRecommendations(report);

      return report;

    } catch (error) {
      report.summary.criticalIssues.push({
        type: 'error',
        message: `Failed to analyze project: ${error.message}`
      });
      return report;
    }
  }

  /**
   * Find all recipe files in a project
   */
  async findRecipeFiles(projectPath) {
    const recipeFiles = [];
    
    const findRecipesRecursive = async (dir) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            // Skip common directories that don't contain recipes
            if (!['build', 'tmp', 'sstate-cache', 'downloads'].includes(entry.name)) {
              await findRecipesRecursive(fullPath);
            }
          } else if (entry.isFile() && entry.name.endsWith('.bb')) {
            recipeFiles.push(fullPath);
          }
        }
      } catch (error) {
        // Ignore directories we can't read
      }
    };

    await findRecipesRecursive(projectPath);
    return recipeFiles;
  }

  /**
   * Generate project-level recommendations
   */
  generateProjectRecommendations(report) {
    const { recipes, summary } = report;

    // Overall compliance recommendations
    if (summary.averageScore < 70) {
      report.recommendations.push('Project compliance score is below recommended threshold (70). Review license policies and consider alternatives to problematic components.');
    }

    if (summary.gplv3Count > 0) {
      report.recommendations.push(`${summary.gplv3Count} recipes contain GPLv3 components. Consider corporate license policy review and evaluate alternatives.`);
    }

    // Specific component recommendations
    const gplv3Recipes = recipes.filter(r => r.gplv3Components.length > 0);
    if (gplv3Recipes.length > 0) {
      report.recommendations.push('Consider these GPLv3 alternatives:');
      gplv3Recipes.forEach(recipe => {
        if (Object.keys(recipe.alternatives).length > 0) {
          Object.entries(recipe.alternatives).forEach(([component, alternatives]) => {
            report.recommendations.push(`  • ${component} → ${alternatives.join(', ')}`);
          });
        }
      });
    }

    // Security recommendations
    const securityIssues = recipes.filter(r => 
      r.warnings.some(w => w.toLowerCase().includes('security'))
    );
    if (securityIssues.length > 0) {
      report.recommendations.push(`${securityIssues.length} recipes have security-related warnings. Review and address these issues before production deployment.`);
    }
  }

  /**
   * Get license alternatives for a package
   */
  getLicenseAlternatives(packageName) {
    return this.licenseData.alternatives?.[packageName] || [];
  }

  /**
   * Check if a license is corporate-friendly
   */
  isCorporateFriendly(license) {
    const corporateFriendly = ['mit', 'bsd', 'apache', 'lgpl'];
    const normalizedLicense = license.toLowerCase().replace(/[-_.]/g, '');
    
    return corporateFriendly.some(friendly => normalizedLicense.includes(friendly));
  }

  /**
   * Get compliance statistics
   */
  getComplianceStatistics() {
    const stats = {
      totalGplv3Packages: this.licenseData.gplv3_packages?.length || 0,
      corporateApprovedCount: 0,
      alternativesCount: Object.keys(this.licenseData.alternatives || {}).length
    };

    if (this.licenseData.corporate_approved) {
      stats.corporateApprovedCount = Object.values(this.licenseData.corporate_approved)
        .reduce((sum, packages) => sum + packages.length, 0);
    }

    return stats;
  }

  /**
   * Validate license string format
   */
  validateLicenseString(licenseString) {
    const errors = [];
    const warnings = [];

    if (!licenseString || licenseString.trim() === '') {
      errors.push('LICENSE field is empty or missing');
      return { valid: false, errors, warnings };
    }

    // Check for common formatting issues
    if (licenseString.includes('&') && licenseString.includes('|')) {
      warnings.push('Mixed AND (&) and OR (|) operators in license string - verify intended logic');
    }

    // Check for unknown license identifiers
    const licenses = licenseString.split(/\s*[&|]\s*/);
    const knownLicenses = [
      'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'GPL-2.0', 'GPL-3.0',
      'LGPL-2.1', 'LGPL-3.0', 'MPL-2.0', 'EPL-1.0', 'CDDL-1.0'
    ];

    licenses.forEach(license => {
      if (!knownLicenses.includes(license.trim())) {
        warnings.push(`Unknown license identifier: '${license.trim()}'`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}

module.exports = LicenseService;