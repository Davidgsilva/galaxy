#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { execSync } = require('child_process');

class BeaconSetup {
  constructor() {
    this.projectRoot = path.join(__dirname, '..');
    this.envPath = path.join(this.projectRoot, '.env');
  }

  async run() {
    console.log(chalk.blue('🚀 Welcome to Beacon Yocto CLI Setup!'));
    console.log(chalk.gray('Setting up your AI-powered Yocto development environment...\n'));

    try {
      // Check prerequisites
      await this.checkPrerequisites();
      
      // Setup configuration
      await this.setupConfiguration();
      
      // Install dependencies
      await this.installDependencies();
      
      // Initialize services
      await this.initializeServices();
      
      // Create example configurations
      await this.createExamples();
      
      // Final instructions
      this.showCompletionMessage();

    } catch (error) {
      console.error(chalk.red('\n❌ Setup failed:'), error.message);
      process.exit(1);
    }
  }

  async checkPrerequisites() {
    console.log(chalk.blue('📋 Checking prerequisites...'));

    const checks = [
      { name: 'Node.js', command: 'node --version', minVersion: '18.0.0' },
      { name: 'npm', command: 'npm --version', minVersion: '8.0.0' }
    ];

    for (const check of checks) {
      try {
        const version = execSync(check.command, { encoding: 'utf8' }).trim();
        console.log(chalk.green(`  ✅ ${check.name}: ${version}`));
      } catch (error) {
        throw new Error(`${check.name} is not installed or not in PATH`);
      }
    }

    // Check if in Yocto environment (optional)
    const yoctoEnvs = [
      process.env.BUILDDIR,
      process.env.BB_ENV_EXTRAWHITE,
      process.env.OEROOT
    ];

    const hasYoctoEnv = yoctoEnvs.some(env => env);
    if (hasYoctoEnv) {
      console.log(chalk.yellow('  ⚠️  Yocto build environment detected - some features may behave differently'));
    }

    console.log(chalk.green('✅ Prerequisites check passed\n'));
  }

  async setupConfiguration() {
    console.log(chalk.blue('⚙️  Setting up configuration...'));

    // Check if .env already exists
    if (await fs.pathExists(this.envPath)) {
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: 'Configuration file already exists. Overwrite?',
          default: false
        }
      ]);

      if (!overwrite) {
        console.log(chalk.yellow('  Using existing configuration'));
        return;
      }
    }

    // Gather configuration
    const config = await inquirer.prompt([
      {
        type: 'input',
        name: 'anthropicApiKey',
        message: 'Enter your Anthropic API key:',
        validate: (input) => input.trim().length > 0 || 'API key is required',
        filter: (input) => input.trim()
      },
      {
        type: 'list',
        name: 'defaultModel',
        message: 'Select default AI model:',
        choices: [
          { name: 'Claude Sonnet 4 (Recommended)', value: 'claude-sonnet-4-20250514' },
          { name: 'Claude Opus 4 (Most Capable)', value: 'claude-opus-4-20250514' }
        ],
        default: 'claude-sonnet-4-20250514'
      },
      {
        type: 'number',
        name: 'proxyPort',
        message: 'Proxy server port:',
        default: 3001,
        validate: (input) => input > 1000 && input < 65536 || 'Port must be between 1000 and 65535'
      },
      {
        type: 'confirm',
        name: 'enableCache',
        message: 'Enable response caching for better performance?',
        default: true
      },
      {
        type: 'confirm',
        name: 'strictLicenses',
        message: 'Enable strict license compliance checking?',
        default: true
      }
    ]);

    // Create .env file
    const envContent = `# Beacon Yocto CLI Configuration
# Generated on ${new Date().toISOString()}

# AI Services
ANTHROPIC_API_KEY=${config.anthropicApiKey}
DEFAULT_MODEL=${config.defaultModel}

# Server Configuration
PORT=${config.proxyPort}
NODE_ENV=development

# Feature Flags
ENABLE_CACHE=${config.enableCache}
STRICT_LICENSES=${config.strictLicenses}
ENABLE_STREAMING=true
ENABLE_THINKING=true

# Yocto Specific
DEFAULT_YOCTO_RELEASE=scarthgap
DEFAULT_DISTRO=poky
SILICON_DB_PATH=./data/silicon/platforms.json

# Security
RATE_LIMIT_ENABLED=true
CORS_ENABLED=true
`;

    await fs.writeFile(this.envPath, envContent);
    console.log(chalk.green('  ✅ Configuration saved to .env'));
  }

  async installDependencies() {
    console.log(chalk.blue('📦 Installing dependencies...'));

    try {
      execSync('npm install', { 
        stdio: 'inherit', 
        cwd: this.projectRoot 
      });
      console.log(chalk.green('✅ Dependencies installed successfully\n'));
    } catch (error) {
      throw new Error('Failed to install dependencies');
    }
  }

  async initializeServices() {
    console.log(chalk.blue('🔧 Initializing services...'));

    // Ensure data directories exist
    const dataDirs = [
      'data/silicon',
      'data/licenses',
      'data/cache',
      'logs',
      'tmp'
    ];

    for (const dir of dataDirs) {
      const fullPath = path.join(this.projectRoot, dir);
      await fs.ensureDir(fullPath);
      console.log(chalk.gray(`  Created directory: ${dir}`));
    }

    // Initialize silicon database if not exists
    const siliconDbPath = path.join(this.projectRoot, 'data/silicon/platforms.json');
    if (await fs.pathExists(siliconDbPath)) {
      console.log(chalk.green('  ✅ Silicon platform database found'));
    } else {
      console.log(chalk.yellow('  ⚠️  Silicon platform database not found - using defaults'));
    }

    // Create gitignore
    const gitignorePath = path.join(this.projectRoot, '.gitignore');
    const gitignoreContent = `# Beacon Yocto CLI
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Cache
.cache/
data/cache/
tmp/

# Build artifacts
dist/
build/

# IDE files
.vscode/
.idea/
*.swp
*.swo

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Yocto build artifacts
build*/
tmp*/
sstate-cache*/
downloads*/
*.lock
`;

    if (!await fs.pathExists(gitignorePath)) {
      await fs.writeFile(gitignorePath, gitignoreContent);
      console.log(chalk.gray('  Created .gitignore'));
    }

    console.log(chalk.green('✅ Services initialized\n'));
  }

  async createExamples() {
    console.log(chalk.blue('📝 Creating example configurations...'));

    const examplesDir = path.join(this.projectRoot, 'examples');
    await fs.ensureDir(examplesDir);

    // Example project configuration
    const exampleProject = {
      name: 'example-imx8mp-project',
      description: 'Example i.MX8MP project with Qt5 and WiFi',
      machine: 'imx8mp-evk',
      distro: 'poky',
      yoctoRelease: 'scarthgap',
      silicon: 'nxp',
      features: ['qt5', 'wifi', 'bluetooth', 'security'],
      layers: [
        'meta-openembedded',
        'meta-freescale',
        'meta-qt5',
        'meta-security'
      ],
      localConf: {
        BB_NUMBER_THREADS: '$(nproc)',
        PARALLEL_MAKE: '-j$(nproc)',
        MACHINE_FEATURES_append: ' wifi bluetooth',
        DISTRO_FEATURES_append: ' systemd qt5 wifi bluetooth security',
        IMAGE_INSTALL_append: ' qtbase qtdeclarative wpa-supplicant bluez5'
      }
    };

    await fs.writeJson(
      path.join(examplesDir, 'imx8mp-project.json'),
      exampleProject,
      { spaces: 2 }
    );

    // Example batch operations
    const exampleBatch = {
      description: 'Example batch operations for code review',
      operations: [
        {
          id: 'analyze-recipes',
          type: 'chat',
          message: 'Analyze all recipes in the current project for license compliance and security issues'
        },
        {
          id: 'check-machine-config',
          type: 'chat', 
          message: 'Review machine configuration for best practices and optimization opportunities'
        },
        {
          id: 'generate-security-report',
          type: 'chat',
          message: 'Generate a comprehensive security analysis report for the current build configuration'
        }
      ]
    };

    await fs.writeJson(
      path.join(examplesDir, 'batch-code-review.json'),
      exampleBatch,
      { spaces: 2 }
    );

    console.log(chalk.gray('  Created example project configuration'));
    console.log(chalk.gray('  Created example batch operations'));
    console.log(chalk.green('✅ Examples created\n'));
  }

  showCompletionMessage() {
    console.log(chalk.green('🎉 Beacon Yocto CLI setup completed successfully!\n'));
    
    console.log(chalk.blue('🚀 Getting Started:'));
    console.log(chalk.gray('  1. Start the proxy server:'));
    console.log(chalk.white('     npm start\n'));
    
    console.log(chalk.gray('  2. In another terminal, try these commands:'));
    console.log(chalk.white('     npx beacon --help'));
    console.log(chalk.white('     npx beacon init --interactive'));
    console.log(chalk.white('     npx beacon silicon --list'));
    console.log(chalk.white('     npx beacon chat\n'));

    console.log(chalk.blue('📚 Documentation:'));
    console.log(chalk.gray('  • README.md - Complete documentation'));
    console.log(chalk.gray('  • examples/ - Example configurations'));
    console.log(chalk.gray('  • docs/ - Additional guides\n'));

    console.log(chalk.blue('💡 Tips:'));
    console.log(chalk.gray('  • Use "beacon chat" for interactive AI assistance'));
    console.log(chalk.gray('  • Try "beacon init --interactive" for guided project setup'));
    console.log(chalk.gray('  • Run "beacon doctor" to check system health'));
    console.log(chalk.gray('  • Use "--thinking" flag for detailed AI reasoning\n'));

    console.log(chalk.yellow('⚠️  Important:'));
    console.log(chalk.gray('  • Keep your .env file secure (contains API key)'));
    console.log(chalk.gray('  • Review license compliance warnings carefully'));
    console.log(chalk.gray('  • Test configurations in development before production\n'));

    console.log(chalk.green('Happy building with Yocto! 🛠️'));
  }
}

// Run setup if called directly
if (require.main === module) {
  const setup = new BeaconSetup();
  setup.run().catch(error => {
    console.error(chalk.red('Setup failed:'), error);
    process.exit(1);
  });
}

module.exports = BeaconSetup;