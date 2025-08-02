const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

class YoctoService {
  constructor() {
    this.currentPath = process.cwd();
    this.projectCache = new Map();
  }

  /**
   * Detect if current directory is a Yocto project
   */
  async isYoctoProject(projectPath = this.currentPath) {
    try {
      const indicators = [
        'conf/local.conf',
        'conf/bblayers.conf',
        'bitbake',
        'oe-init-build-env'
      ];

      for (const indicator of indicators) {
        const fullPath = path.join(projectPath, indicator);
        if (await fs.pathExists(fullPath)) {
          return true;
        }
      }

      // Check parent directories for build environment
      const parentPath = path.dirname(projectPath);
      if (parentPath !== projectPath) {
        const parentIndicators = ['oe-init-build-env', 'bitbake', 'meta'];
        for (const indicator of parentIndicators) {
          if (await fs.pathExists(path.join(parentPath, indicator))) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get project context for AI assistant
   */
  async getProjectContext(projectPath = this.currentPath) {
    const cacheKey = `context:${projectPath}`;
    
    if (this.projectCache.has(cacheKey)) {
      const cached = this.projectCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 30000) { // 30 second cache
        return cached.data;
      }
    }

    const context = [];

    try {
      // Check if this is a Yocto project
      if (!await this.isYoctoProject(projectPath)) {
        return context;
      }

      // Read local.conf
      const localConfPath = path.join(projectPath, 'conf/local.conf');
      if (await fs.pathExists(localConfPath)) {
        const localConf = await fs.readFile(localConfPath, 'utf8');
        context.push({
          type: 'configuration',
          name: 'local.conf',
          path: localConfPath,
          content: this.extractKeyConfigs(localConf)
        });
      }

      // Read bblayers.conf
      const bblayersPath = path.join(projectPath, 'conf/bblayers.conf');
      if (await fs.pathExists(bblayersPath)) {
        const bblayers = await fs.readFile(bblayersPath, 'utf8');
        context.push({
          type: 'layers',
          name: 'bblayers.conf',
          path: bblayersPath,
          content: this.extractLayers(bblayers)
        });
      }

      // Find recipe files
      const recipes = await this.findProjectRecipes(projectPath);
      recipes.forEach(recipe => {
        context.push({
          type: 'recipe',
          name: recipe.name,
          path: recipe.path,
          content: recipe.summary
        });
      });

      // Find machine configurations
      const machines = await this.findMachineConfigs(projectPath);
      machines.forEach(machine => {
        context.push({
          type: 'machine',
          name: machine.name,
          path: machine.path,
          content: machine.summary
        });
      });

      // Cache results
      this.projectCache.set(cacheKey, {
        data: context,
        timestamp: Date.now()
      });

      return context;

    } catch (error) {
      console.error('Error getting project context:', error.message);
      return context;
    }
  }

  /**
   * Extract key configurations from local.conf
   */
  extractKeyConfigs(content) {
    const configs = {};
    const lines = content.split('\n');

    const keyVars = [
      'MACHINE', 'DISTRO', 'BB_NUMBER_THREADS', 'PARALLEL_MAKE',
      'DL_DIR', 'SSTATE_DIR', 'DISTRO_FEATURES', 'IMAGE_FEATURES',
      'PACKAGE_CLASSES', 'EXTRA_IMAGE_FEATURES'
    ];

    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) {
        return;
      }

      keyVars.forEach(varName => {
        const regex = new RegExp(`^${varName}\\s*[?=+]*\\s*["']?([^"'\\n]+)["']?`);
        const match = trimmed.match(regex);
        if (match) {
          configs[varName] = match[1].trim();
        }
      });
    });

    return configs;
  }

  /**
   * Extract layer information from bblayers.conf
   */
  extractLayers(content) {
    const layers = [];
    const bblayersMatch = content.match(/BBLAYERS\s*[?=+]*\s*"([^"]+)"/s);
    
    if (bblayersMatch) {
      const layerPaths = bblayersMatch[1]
        .split(/\s+/)
        .filter(path => path.trim())
        .map(path => path.replace(/\$\{[^}]+\}/g, '').trim());

      layerPaths.forEach(layerPath => {
        const layerName = path.basename(layerPath);
        if (layerName) {
          layers.push({
            name: layerName,
            path: layerPath
          });
        }
      });
    }

    return layers;
  }

  /**
   * Find recipe files in the project
   */
  async findProjectRecipes(projectPath, maxRecipes = 20) {
    const recipes = [];
    
    try {
      const searchPaths = [
        path.join(projectPath, 'meta-*'),
        path.join(projectPath, '..', 'meta-*')
      ];

      for (const searchPath of searchPaths) {
        const layerDirs = await this.globDirs(searchPath);
        
        for (const layerDir of layerDirs) {
          const recipeFiles = await this.findRecipeFiles(layerDir);
          
          for (const recipeFile of recipeFiles.slice(0, Math.max(0, maxRecipes - recipes.length))) {
            const recipeName = path.basename(recipeFile, '.bb');
            const summary = await this.extractRecipeSummary(recipeFile);
            
            recipes.push({
              name: recipeName,
              path: recipeFile,
              layer: path.basename(layerDir),
              summary
            });
          }

          if (recipes.length >= maxRecipes) break;
        }
        
        if (recipes.length >= maxRecipes) break;
      }

    } catch (error) {
      // Ignore errors in recipe discovery
    }

    return recipes;
  }

  /**
   * Find machine configuration files
   */
  async findMachineConfigs(projectPath) {
    const machines = [];
    
    try {
      const searchPaths = [
        path.join(projectPath, 'conf/machine'),
        path.join(projectPath, '..', 'meta-*/conf/machine')
      ];

      for (const searchPath of searchPaths) {
        if (await fs.pathExists(searchPath)) {
          const machineFiles = await fs.readdir(searchPath);
          
          for (const file of machineFiles) {
            if (file.endsWith('.conf')) {
              const machineName = path.basename(file, '.conf');
              const machineFile = path.join(searchPath, file);
              const summary = await this.extractMachineSummary(machineFile);
              
              machines.push({
                name: machineName,
                path: machineFile,
                summary
              });
            }
          }
        }
      }

    } catch (error) {
      // Ignore errors in machine discovery
    }

    return machines;
  }

  /**
   * Extract summary from recipe file
   */
  async extractRecipeSummary(recipeFile) {
    try {
      const content = await fs.readFile(recipeFile, 'utf8');
      const lines = content.split('\n').slice(0, 50); // First 50 lines

      const summary = {};
      lines.forEach(line => {
        const trimmed = line.trim();
        
        // Extract key recipe variables
        const vars = ['DESCRIPTION', 'SUMMARY', 'LICENSE', 'HOMEPAGE', 'SECTION'];
        vars.forEach(varName => {
          const regex = new RegExp(`^${varName}\\s*[=+]*\\s*["']([^"']+)["']`);
          const match = trimmed.match(regex);
          if (match) {
            summary[varName] = match[1];
          }
        });
      });

      return summary;
    } catch (error) {
      return {};
    }
  }

  /**
   * Extract summary from machine configuration
   */
  async extractMachineSummary(machineFile) {
    try {
      const content = await fs.readFile(machineFile, 'utf8');
      const lines = content.split('\n').slice(0, 30);

      const summary = {};
      lines.forEach(line => {
        const trimmed = line.trim();
        
        // Extract key machine variables
        const vars = ['SOC_FAMILY', 'DEFAULTTUNE', 'MACHINE_FEATURES', 'KERNEL_IMAGETYPE'];
        vars.forEach(varName => {
          const regex = new RegExp(`^${varName}\\s*[=+]*\\s*["']?([^"'\\n]+)["']?`);
          const match = trimmed.match(regex);
          if (match) {
            summary[varName] = match[1].trim();
          }
        });
      });

      return summary;
    } catch (error) {
      return {};
    }
  }

  /**
   * Initialize a new Yocto project structure
   */
  async initializeProject(config) {
    const {
      projectName = 'yocto-project',
      targetDir = this.currentPath,
      yoctoRelease = 'scarthgap',
      machine = 'qemux86-64',
      distro = 'poky',
      layers = [],
      features = []
    } = config;

    const projectDir = path.join(targetDir, projectName);
    const buildDir = path.join(projectDir, 'build');
    const confDir = path.join(buildDir, 'conf');

    try {
      // Create directory structure
      await fs.ensureDir(confDir);

      // Generate local.conf
      const localConf = this.generateLocalConf({
        machine,
        distro,
        features,
        yoctoRelease
      });

      await fs.writeFile(path.join(confDir, 'local.conf'), localConf);

      // Generate bblayers.conf
      const bblayersConf = this.generateBblayersConf({
        layers,
        projectDir,
        yoctoRelease
      });

      await fs.writeFile(path.join(confDir, 'bblayers.conf'), bblayersConf);

      // Create setup script
      const setupScript = this.generateSetupScript({
        projectName,
        yoctoRelease,
        layers
      });

      await fs.writeFile(path.join(projectDir, 'setup-environment.sh'), setupScript);
      
      // Make setup script executable
      await fs.chmod(path.join(projectDir, 'setup-environment.sh'), '755');

      return {
        success: true,
        projectDir,
        buildDir,
        message: `Yocto project '${projectName}' initialized successfully`
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: `Failed to initialize project: ${error.message}`
      };
    }
  }

  /**
   * Generate local.conf content
   */
  generateLocalConf(config) {
    const { machine, distro, features, yoctoRelease } = config;

    return `#
# Local configuration for ${machine} build
# Generated by Beacon Yocto CLI
#

MACHINE = "${machine}"
DISTRO = "${distro}"

# Build performance optimization
BB_NUMBER_THREADS ?= "\${@oe.utils.cpu_count()}"
PARALLEL_MAKE ?= "-j \${@oe.utils.cpu_count()}"

# Shared state and download caches
SSTATE_DIR ?= "\${TOPDIR}/../sstate-cache"
DL_DIR ?= "\${TOPDIR}/../downloads"

# Package management
PACKAGE_CLASSES ?= "package_rpm"

# Additional image features
EXTRA_IMAGE_FEATURES ?= "debug-tweaks tools-profile"

# Distribution features
DISTRO_FEATURES_append = " systemd"
VIRTUAL-RUNTIME_init_manager = "systemd"

${features.includes('wifi') ? 'DISTRO_FEATURES_append = " wifi"\nIMAGE_INSTALL_append = " iw wpa-supplicant"' : ''}
${features.includes('bluetooth') ? 'DISTRO_FEATURES_append = " bluetooth"\nIMAGE_INSTALL_append = " bluez5"' : ''}
${features.includes('qt') ? 'DISTRO_FEATURES_append = " qt5 wayland"\nIMAGE_INSTALL_append = " qtbase qtdeclarative"' : ''}
${features.includes('security') ? 'DISTRO_FEATURES_append = " security"\nIMAGE_INSTALL_append = " apparmor"' : ''}
${features.includes('containers') ? 'DISTRO_FEATURES_append = " virtualization"\nIMAGE_INSTALL_append = " docker"' : ''}

# License compliance
LICENSE_FLAGS_WHITELIST = "commercial"

# Security settings
INHERIT += "rm_work"
RM_OLD_IMAGE = "1"

# Development settings
INHERIT += "buildhistory"
BUILDHISTORY_COMMIT = "1"

# Version information
DISTRO_VERSION = "${yoctoRelease}"
`;
  }

  /**
   * Generate bblayers.conf content
   */
  generateBblayersConf(config) {
    const { layers, projectDir } = config;

    const standardLayers = [
      '${TOPDIR}/../poky/meta',
      '${TOPDIR}/../poky/meta-poky',
      '${TOPDIR}/../poky/meta-yocto-bsp'
    ];

    const customLayers = layers.map(layer => 
      `\${TOPDIR}/../${layer.replace('meta-', 'meta-')}`
    );

    const allLayers = [...standardLayers, ...customLayers];

    return `# POKY_BBLAYERS_CONF_VERSION is increased each time build/conf/bblayers.conf
# changes incompatibly
POKY_BBLAYERS_CONF_VERSION = "2"

BBPATH = "\${TOPDIR}"
BBFILES ?= ""

BBLAYERS ?= " \\
${allLayers.map(layer => `  ${layer} \\`).join('\n')}
"
`;
  }

  /**
   * Generate setup script
   */
  generateSetupScript(config) {
    const { projectName, yoctoRelease, layers } = config;

    return `#!/bin/bash
#
# Setup script for ${projectName}
# Generated by Beacon Yocto CLI
#

set -e

PROJECT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="\${PROJECT_DIR}/build"

echo "Setting up Yocto build environment for ${projectName}..."

# Clone Poky if not present
if [ ! -d "\${PROJECT_DIR}/poky" ]; then
    echo "Cloning Poky (${yoctoRelease})..."
    git clone -b ${yoctoRelease} https://git.yoctoproject.org/poky "\${PROJECT_DIR}/poky"
fi

# Clone additional layers
${layers.map(layer => `
if [ ! -d "\${PROJECT_DIR}/${layer}" ]; then
    echo "Cloning ${layer}..."
    # Add appropriate git clone command for ${layer}
fi`).join('')}

# Initialize build environment
cd "\${PROJECT_DIR}"
if [ ! -f "\${BUILD_DIR}/conf/local.conf" ]; then
    source poky/oe-init-build-env build
else
    source poky/oe-init-build-env build > /dev/null
fi

echo ""
echo "Build environment ready!"
echo "To build an image, run:"
echo "  bitbake core-image-minimal"
echo ""
echo "Available machines:"
echo "  \$(bitbake-layers show-machines 2>/dev/null | grep -v '^NOTE:' | head -10)"
echo ""
`;
  }

  /**
   * Get build status and statistics
   */
  async getBuildStatus(buildDir = null) {
    const targetBuildDir = buildDir || this.findBuildDir();
    
    if (!targetBuildDir) {
      return { status: 'no_build_dir', message: 'No build directory found' };
    }

    try {
      const status = {
        buildDir: targetBuildDir,
        hasBuilds: false,
        lastBuild: null,
        cacheStats: {},
        diskUsage: {}
      };

      // Check for build artifacts
      const tmpDir = path.join(targetBuildDir, 'tmp');
      if (await fs.pathExists(tmpDir)) {
        status.hasBuilds = true;
        
        // Get last build timestamp
        const stats = await fs.stat(tmpDir);
        status.lastBuild = stats.mtime;
      }

      // Get cache statistics
      const sstateDir = path.join(targetBuildDir, '../sstate-cache');
      if (await fs.pathExists(sstateDir)) {
        status.cacheStats.sstate = await this.getDirStats(sstateDir);
      }

      const dlDir = path.join(targetBuildDir, '../downloads');
      if (await fs.pathExists(dlDir)) {
        status.cacheStats.downloads = await this.getDirStats(dlDir);
      }

      // Get disk usage
      status.diskUsage = await this.getDirStats(targetBuildDir);

      return status;

    } catch (error) {
      return {
        status: 'error',
        message: error.message
      };
    }
  }

  /**
   * Find build directory
   */
  findBuildDir(startPath = this.currentPath) {
    const candidates = [
      path.join(startPath, 'build'),
      path.join(startPath, '../build'),
      startPath // Current directory might be build dir
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, 'conf/local.conf'))) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Get directory statistics
   */
  async getDirStats(dirPath) {
    try {
      const stats = await fs.stat(dirPath);
      
      // Use du command if available for more accurate size
      try {
        const du = execSync(`du -sb "${dirPath}" 2>/dev/null`, { encoding: 'utf8' });
        const size = parseInt(du.split('\t')[0]);
        return {
          exists: true,
          size,
          sizeHuman: this.formatBytes(size),
          modified: stats.mtime
        };
      } catch {
        return {
          exists: true,
          size: stats.size,
          sizeHuman: this.formatBytes(stats.size),
          modified: stats.mtime
        };
      }
    } catch (error) {
      return {
        exists: false,
        error: error.message
      };
    }
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Helper method to find recipe files
   */
  async findRecipeFiles(layerDir) {
    const recipes = [];
    
    try {
      const recipesDir = path.join(layerDir, 'recipes-*');
      const recipeDirs = await this.globDirs(recipesDir);
      
      for (const recipeDir of recipeDirs) {
        const files = await this.findFilesRecursive(recipeDir, '.bb');
        recipes.push(...files);
      }
    } catch (error) {
      // Ignore errors
    }

    return recipes;
  }

  /**
   * Helper method for glob-like directory matching
   */
  async globDirs(pattern) {
    const dirs = [];
    const basePath = path.dirname(pattern);
    const namePattern = path.basename(pattern);
    
    try {
      if (await fs.pathExists(basePath)) {
        const entries = await fs.readdir(basePath);
        
        for (const entry of entries) {
          const fullPath = path.join(basePath, entry);
          const stat = await fs.stat(fullPath);
          
          if (stat.isDirectory() && entry.match(namePattern.replace('*', '.*'))) {
            dirs.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Ignore errors
    }

    return dirs;
  }

  /**
   * Helper method to find files recursively
   */
  async findFilesRecursive(dir, extension) {
    const files = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          const subFiles = await this.findFilesRecursive(fullPath, extension);
          files.push(...subFiles);
        } else if (entry.name.endsWith(extension)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore errors
    }

    return files;
  }

  /**
   * Clear project cache
   */
  clearCache() {
    this.projectCache.clear();
  }
}

module.exports = YoctoService;