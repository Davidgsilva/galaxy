const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class ConfigService {
  constructor() {
    this.configDir = path.join(os.homedir(), '.beacon');
    this.configFile = path.join(this.configDir, 'config.json');
    this.defaultConfig = {
      // API Settings
      proxyUrl: 'http://localhost:3001',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      defaultModel: 'claude-sonnet-4-20250514',
      maxTokens: 8192,
      temperature: 0.1,
      
      // Yocto Settings
      yocto: {
        defaultRelease: 'scarthgap',
        defaultDistro: 'poky',
        preferredLayers: [
          'meta-openembedded',
          'meta-security'
        ],
        buildOptimization: {
          parallelMake: true,
          sharedStateCache: true,
          downloadCache: true,
          rmWork: true
        }
      },
      
      // Silicon Platform Preferences
      silicon: {
        preferredVendors: ['nxp', 'xilinx', 'ti'],
        autoDetectHardware: true,
        cacheHardwareInfo: true
      },
      
      // License Compliance
      licenses: {
        strictMode: true,
        allowGplv3: false,
        corporatePolicy: 'strict',
        approvedLicenses: ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'LGPL-2.1'],
        warnOnUnknown: true
      },
      
      // CLI Behavior
      cli: {
        useColors: true,
        verbose: false,
        autoSave: true,
        confirmDestructive: true,
        streamingEnabled: false,
        extendedThinking: false
      },
      
      // Cache Settings
      cache: {
        enabled: true,
        ttl: 3600, // 1 hour
        maxSize: 1000,
        clearOnExit: false
      },
      
      // Project Defaults
      project: {
        defaultStructure: 'standard',
        createGitRepo: true,
        addGitignore: true,
        setupBuildEnv: true
      }
    };
    
    this.config = null;
    this.loadConfig();
  }

  /**
   * Load configuration from file
   */
  async loadConfig(configPath = null) {
    try {
      const targetPath = configPath || this.configFile;
      
      if (await fs.pathExists(targetPath)) {
        const fileConfig = await fs.readJson(targetPath);
        this.config = this.mergeConfig(this.defaultConfig, fileConfig);
      } else {
        this.config = { ...this.defaultConfig };
        // Create default config file
        await this.saveConfig();
      }
    } catch (error) {
      console.warn('Error loading config, using defaults:', error.message);
      this.config = { ...this.defaultConfig };
    }
  }

  /**
   * Save configuration to file
   */
  async saveConfig(configPath = null) {
    try {
      const targetPath = configPath || this.configFile;
      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeJson(targetPath, this.config, { spaces: 2 });
    } catch (error) {
      throw new Error(`Failed to save configuration: ${error.message}`);
    }
  }

  /**
   * Initialize configuration file
   */
  async initConfig() {
    try {
      await fs.ensureDir(this.configDir);
      
      if (await fs.pathExists(this.configFile)) {
        throw new Error('Configuration file already exists');
      }

      this.config = { ...this.defaultConfig };
      await this.saveConfig();
      
      return {
        success: true,
        configFile: this.configFile,
        message: 'Configuration initialized successfully'
      };
    } catch (error) {
      throw new Error(`Failed to initialize configuration: ${error.message}`);
    }
  }

  /**
   * Get configuration value
   */
  get(key) {
    if (!this.config) {
      return null;
    }

    return this.getNestedValue(this.config, key);
  }

  /**
   * Set configuration value
   */
  async set(key, value) {
    if (!this.config) {
      this.config = { ...this.defaultConfig };
    }

    this.setNestedValue(this.config, key, value);
    await this.saveConfig();
  }

  /**
   * Get all configuration
   */
  getAll() {
    return this.config || this.defaultConfig;
  }

  /**
   * Reset configuration to defaults
   */
  async reset() {
    this.config = { ...this.defaultConfig };
    await this.saveConfig();
  }

  /**
   * Merge configurations (deep merge)
   */
  mergeConfig(defaultConfig, userConfig) {
    const merged = { ...defaultConfig };
    
    for (const [key, value] of Object.entries(userConfig)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        merged[key] = this.mergeConfig(merged[key] || {}, value);
      } else {
        merged[key] = value;
      }
    }
    
    return merged;
  }

  /**
   * Get nested value from object using dot notation
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : null;
    }, obj);
  }

  /**
   * Set nested value in object using dot notation
   */
  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((current, key) => {
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      return current[key];
    }, obj);
    
    target[lastKey] = value;
  }

  /**
   * Validate configuration
   */
  validateConfig(config = this.config) {
    const errors = [];
    const warnings = [];

    // Validate API settings
    if (!config.anthropicApiKey) {
      warnings.push('ANTHROPIC_API_KEY not set - AI features will not work');
    }

    if (!config.proxyUrl || !this.isValidUrl(config.proxyUrl)) {
      errors.push('Invalid proxy URL');
    }

    if (config.maxTokens < 1000 || config.maxTokens > 8192) {
      warnings.push('maxTokens should be between 1000 and 8192');
    }

    if (config.temperature < 0 || config.temperature > 1) {
      errors.push('temperature must be between 0 and 1');
    }

    // Validate Yocto settings
    const validReleases = ['kirkstone', 'scarthgap', 'styhead', 'nanbield'];
    if (!validReleases.includes(config.yocto.defaultRelease)) {
      warnings.push(`Unknown Yocto release: ${config.yocto.defaultRelease}`);
    }

    // Validate license settings
    if (config.licenses.strictMode && config.licenses.allowGplv3) {
      warnings.push('GPLv3 allowed in strict license mode - review corporate policy');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Check if URL is valid
   */
  isValidUrl(urlString) {
    try {
      new URL(urlString);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Yocto-specific configuration
   */
  getYoctoConfig() {
    return this.get('yocto') || this.defaultConfig.yocto;
  }

  /**
   * Get silicon platform configuration
   */
  getSiliconConfig() {
    return this.get('silicon') || this.defaultConfig.silicon;
  }

  /**
   * Get license configuration
   */
  getLicenseConfig() {
    return this.get('licenses') || this.defaultConfig.licenses;
  }

  /**
   * Get CLI configuration
   */
  getCliConfig() {
    return this.get('cli') || this.defaultConfig.cli;
  }

  /**
   * Export configuration
   */
  async exportConfig(outputPath) {
    try {
      const config = {
        ...this.config,
        // Remove sensitive information
        anthropicApiKey: this.config.anthropicApiKey ? '[REDACTED]' : null,
        exportedAt: new Date().toISOString(),
        version: require('../../package.json').version
      };

      await fs.writeJson(outputPath, config, { spaces: 2 });
      
      return {
        success: true,
        outputPath,
        message: 'Configuration exported successfully'
      };
    } catch (error) {
      throw new Error(`Failed to export configuration: ${error.message}`);
    }
  }

  /**
   * Import configuration
   */
  async importConfig(inputPath) {
    try {
      if (!await fs.pathExists(inputPath)) {
        throw new Error('Configuration file not found');
      }

      const importedConfig = await fs.readJson(inputPath);
      
      // Remove metadata fields
      delete importedConfig.exportedAt;
      delete importedConfig.version;
      
      // Merge with current config
      this.config = this.mergeConfig(this.config, importedConfig);
      
      // Validate merged config
      const validation = this.validateConfig();
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      await this.saveConfig();
      
      return {
        success: true,
        inputPath,
        warnings: validation.warnings,
        message: 'Configuration imported successfully'
      };
    } catch (error) {
      throw new Error(`Failed to import configuration: ${error.message}`);
    }
  }

  /**
   * Get configuration schema for validation
   */
  getSchema() {
    return {
      type: 'object',
      properties: {
        proxyUrl: { type: 'string', format: 'uri' },
        anthropicApiKey: { type: 'string' },
        defaultModel: { 
          type: 'string', 
          enum: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'] 
        },
        maxTokens: { type: 'integer', minimum: 1000, maximum: 8192 },
        temperature: { type: 'number', minimum: 0, maximum: 1 },
        yocto: {
          type: 'object',
          properties: {
            defaultRelease: { 
              type: 'string',
              enum: ['kirkstone', 'scarthgap', 'styhead', 'nanbield']
            },
            defaultDistro: { type: 'string' },
            preferredLayers: { type: 'array', items: { type: 'string' } }
          }
        },
        licenses: {
          type: 'object',
          properties: {
            strictMode: { type: 'boolean' },
            allowGplv3: { type: 'boolean' },
            corporatePolicy: { 
              type: 'string',
              enum: ['strict', 'moderate', 'permissive'] 
            }
          }
        }
      }
    };
  }

  /**
   * Get environment-specific configuration
   */
  getEnvironmentConfig() {
    const env = process.env.NODE_ENV || 'development';
    
    const envConfig = {
      development: {
        verbose: true,
        cache: { enabled: false },
        cli: { confirmDestructive: true }
      },
      production: {
        verbose: false,
        cache: { enabled: true },
        cli: { confirmDestructive: true }
      },
      test: {
        verbose: false,
        cache: { enabled: false },
        cli: { confirmDestructive: false }
      }
    };

    return envConfig[env] || {};
  }

  /**
   * Apply environment-specific overrides
   */
  applyEnvironmentOverrides() {
    const envConfig = this.getEnvironmentConfig();
    this.config = this.mergeConfig(this.config, envConfig);
  }

  /**
   * Check if configuration exists
   */
  async configExists() {
    return await fs.pathExists(this.configFile);
  }

  /**
   * Get configuration file path
   */
  getConfigPath() {
    return this.configFile;
  }

  /**
   * Get configuration directory
   */
  getConfigDir() {
    return this.configDir;
  }

  /**
   * Backup current configuration
   */
  async backupConfig() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.configDir, `config.backup.${timestamp}.json`);
      
      if (await fs.pathExists(this.configFile)) {
        await fs.copy(this.configFile, backupPath);
        return {
          success: true,
          backupPath,
          message: 'Configuration backed up successfully'
        };
      } else {
        throw new Error('No configuration file to backup');
      }
    } catch (error) {
      throw new Error(`Failed to backup configuration: ${error.message}`);
    }
  }

  /**
   * List configuration backups
   */
  async listBackups() {
    try {
      const backups = [];
      
      if (await fs.pathExists(this.configDir)) {
        const files = await fs.readdir(this.configDir);
        
        for (const file of files) {
          if (file.startsWith('config.backup.') && file.endsWith('.json')) {
            const filePath = path.join(this.configDir, file);
            const stats = await fs.stat(filePath);
            
            backups.push({
              filename: file,
              path: filePath,
              created: stats.birthtime,
              size: stats.size
            });
          }
        }
      }
      
      return backups.sort((a, b) => b.created - a.created);
    } catch (error) {
      throw new Error(`Failed to list backups: ${error.message}`);
    }
  }
}

module.exports = ConfigService;