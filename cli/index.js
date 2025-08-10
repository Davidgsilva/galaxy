#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const { 
  input, 
  select, 
  checkbox, 
  confirm, 
  search, 
  password, 
  expand, 
  editor, 
  number, 
  rawlist 
} = require('@inquirer/prompts');

const packageInfo = require('../package.json');
const ApiClient = require('./services/api-client');

class PromptHelper {
  static async input(message, options = {}) {
    return await input({ message, ...options });
  }

  static async select(message, choices, options = {}) {
    return await select({ message, choices, ...options });
  }

  static async multiSelect(message, choices, options = {}) {
    return await checkbox({ message, choices, ...options });
  }

  static async confirm(message, options = {}) {
    return await confirm({ message, ...options });
  }

  static async search(message, source, options = {}) {
    return await search({ message, source, ...options });
  }

  static async password(message, options = {}) {
    return await password({ message, ...options });
  }

  static async expand(message, choices, options = {}) {
    return await expand({ message, choices, ...options });
  }

  static async editor(message, options = {}) {
    return await editor({ message, ...options });
  }

  static async number(message, options = {}) {
    return await number({ message, ...options });
  }

  static async rawList(message, choices, options = {}) {
    return await rawlist({ message, choices, ...options });
  }


  static async getProjectType() {
    const types = [
      { name: '🆕 Create new Yocto project', value: 'new', description: 'Start fresh Linux distribution' },
      { name: '🔧 Work on existing project', value: 'existing', description: 'Continue development' }
    ];

    return await this.select('What would you like to do?', types);
  }

  static async getProjectDescription() {
    return await this.input(
      '📝 Describe your project (e.g., "IoT gateway with WiFi and CAN bus for industrial automation"):',
      {
        validate: (input) => input.trim().length > 10 || 'Please provide a detailed description (at least 10 characters)'
      }
    );
  }


  static async getProjectConfiguration() {
    const config = {};
    
    config.projectName = await this.input('Project name:');
    config.machine = await this.input('Target machine/hardware:', { default: 'genericx86-64' });
    
    // Use consistent defaults - Poky distro and latest stable release
    config.distro = { name: 'Poky', value: 'poky' };
    config.release = { name: 'Latest stable', value: 'latest' };
    config.buildOptions = ['systemd', 'security']; // Sensible defaults
    
    config.useSharedState = await this.confirm('Use shared state directory for faster builds?', { default: true });
    
    if (config.useSharedState) {
      config.sharedStateDir = await this.input('Shared state directory path:', { default: '/opt/yocto-sstate' });
    }

    return config;
  }
}

class BeaconYoctoCLI {
  constructor() {
    this.program = new Command();
    this.apiClient = new ApiClient();
    
    // Register for file operations immediately
    this.apiClient.registerForFileOperations().catch(err => {
      console.error('Failed to register for file operations:', err.message);
    });

    // Handle graceful shutdown
    this.setupShutdownHandlers();
    
    this.setupCommands();
  }

  setupShutdownHandlers() {
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\\n🛑 Shutting down gracefully...'));
      this.apiClient.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log(chalk.yellow('\\n🛑 Received SIGTERM, shutting down...'));
      this.apiClient.disconnect();
      process.exit(0);
    });
  }

  setupCommands() {
    this.program
      .name('beacon')
      .description('🚀 AI-powered Yocto Project assistant - Chat interface for embedded Linux development')
      .version(packageInfo.version)
      .option('-v, --verbose', 'enable verbose logging')
      .option('--proxy-url <url>', 'proxy server URL', 'http://localhost:3001')
      .hook('preAction', (thisCommand) => {
        const options = thisCommand.opts();
        this.apiClient.setProxyUrl(options.proxyUrl);
      });

    // Main conversation command - like claude CLI
    this.program
      .argument('[message]', 'message to send to Yocto AI assistant')
      .option('-s, --streaming', 'enable streaming responses', true)
      .option('-t, --thinking', 'enable extended thinking mode', false)
      .option('-m, --model <model>', 'AI model to use', process.env.DEFAULT_MODEL || 'gpt-4o-mini')
      .option('--temperature <temp>', 'temperature for AI responses', '0.1')
      .action(async (message, options) => {
        if (!message) {
          await this.startBeacon(options);
        } else {
          // Check if this is a project creation request
          if (this.isProjectCreationRequest(message)) {
            await this.createNewProjectWithDescription(message, options);
          } else {
            await this.sendMessage(message, options);
          }
        }
      });

    // Help command
    this.program
      .command('help')
      .description('Show help information')
      .action(() => {
        this.showHelp();
      });

    // Interactive project setup command
    this.program
      .command('setup')
      .description('Interactive Yocto project setup wizard')
      .action(async (options) => {
        await this.runProjectSetup(options);
      });

    // Prompt demo command
    this.program
      .command('demo-prompts')
      .description('Demonstrate all available prompt types')
      .action(async () => {
        await this.demoPrompts();
      });
  }

  async sendMessage(message, options) {
    const spinner = ora('🤖 Processing your Yocto request...').start();
    
    try {
      // Get project context
      const projectContext = await this.getProjectContext();
      
      // Enhance message with context
      const contextualMessage = `Working Directory: ${projectContext.workingDirectory}
${projectContext.hasYoctoProject ? 'Yocto Project: Detected' : 'Yocto Project: Not detected'}
${projectContext.projectFiles.length > 0 ? `Relevant files: ${projectContext.projectFiles.slice(0, 5).join(', ')}` : ''}

User Request: ${message}`;

      const requestData = {
        message: contextualMessage,
        context: [],
        model: options.model,
        temperature: options.thinking === true ? 1 : parseFloat(options.temperature), // Must be 1 when thinking is enabled
        maxTokens: 16000,
        streaming: options.streaming,
        extendedThinking: options.thinking === true, // Default to false
        useYoctoPrompt: true,
        tools: []
      };

      console.log(chalk.cyan(`🔍 CLI Debug: Sending to server with model=${options.model}`));

      if (options.streaming) {
        spinner.stop();
        console.log(chalk.blue('🤖 Beacon:'));
        await this.handleStreamingResponse(requestData);
      } else {
        const response = await this.apiClient.chat(requestData);
        spinner.stop();
        
        console.log(chalk.blue('🤖 Beacon:'));
        console.log(response.response);

        if (response.usage && options.verbose) {
          console.log(chalk.gray(`\n📊 Usage: ${response.usage.input_tokens} input, ${response.usage.output_tokens} output tokens`));
        }
      }

    } catch (error) {
      spinner.stop();
      console.error(chalk.red('❌ Error:'), error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
    }
  }

  async detectYoctoProject(directory) {
    const fs = require('fs');
    const path = require('path');
    
    try {
      // Check for common Yocto project indicators
      const indicators = [
        'bitbake',
        'oe-init-build-env',
        'meta-openembedded',
        'meta-poky',
        'poky',
        'build/conf/local.conf',
        'build/conf/bblayers.conf',
        'layers',
        'sources'
      ];
      
      for (const indicator of indicators) {
        const fullPath = path.join(directory, indicator);
        if (fs.existsSync(fullPath)) {
          return true;
        }
      }
      
      // Check for any meta-* directories
      const files = fs.readdirSync(directory);
      return files.some(file => file.startsWith('meta-') && fs.statSync(path.join(directory, file)).isDirectory());
    } catch (error) {
      return false;
    }
  }

  async getProjectContext() {
    const cwd = process.cwd();
    const fs = require('fs');
    const path = require('path');
    
    const context = {
      workingDirectory: cwd,
      hasYoctoProject: await this.detectYoctoProject(cwd),
      projectFiles: []
    };
    
    try {
      // Look for key Yocto files
      const keyFiles = [
        'build/conf/local.conf',
        'build/conf/bblayers.conf',
        'build/conf/site.conf',
        'meta-*/conf/layer.conf',
        '*.bb',
        '*.bbappend'
      ];
      
      const files = fs.readdirSync(cwd);
      context.projectFiles = files.filter(file => {
        const stat = fs.statSync(path.join(cwd, file));
        return stat.isFile() && (file.endsWith('.bb') || file.endsWith('.bbappend') || file.endsWith('.conf'));
      });
    } catch (error) {
      // Ignore errors, just return basic context
    }
    
    return context;
  }

  async showProjectStatus() {
    const projectContext = await this.getProjectContext();
    
    console.log(chalk.blue('\n📊 Project Status'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Working Directory: ${chalk.yellow(projectContext.workingDirectory)}`);
    console.log(`Yocto Project: ${projectContext.hasYoctoProject ? chalk.green('✓ Detected') : chalk.red('✗ Not found')}`);
    
    if (projectContext.projectFiles.length > 0) {
      console.log(`\nRelevant Files (${projectContext.projectFiles.length}):`);
      projectContext.projectFiles.slice(0, 10).forEach(file => {
        console.log(`  • ${chalk.cyan(file)}`);
      });
      if (projectContext.projectFiles.length > 10) {
        console.log(`  ... and ${projectContext.projectFiles.length - 10} more`);
      }
    }
    
    if (!projectContext.hasYoctoProject) {
      console.log(chalk.yellow('\n💡 Suggestions:'));
      console.log('  • Clone Yocto: "Help me clone and setup a new Yocto project"');
      console.log('  • Check existing project: "Look for Yocto files in subdirectories"');
      console.log('  • Create from scratch: "Set up a minimal Yocto environment"');
    }
    console.log();
  }

  showHelp() {
    console.log(chalk.blue('🚀 Beacon - AI-powered Yocto Project Assistant'));
    console.log(chalk.gray('\nUsage:'));
    console.log('  beacon [message]                    # Send a message to Yocto AI');
    console.log('  beacon                              # Start interactive chat mode');
    console.log('  beacon setup                        # Interactive project setup wizard');
    console.log('  beacon demo-prompts                 # Demonstrate all prompt types');
    console.log('\nExamples:');
    console.log('  beacon "Create a Qt5 recipe"');
    console.log('  beacon "Help debug my build error"');
    console.log('  beacon "Set up WiFi drivers for i.MX8"');
    console.log('\nCommands:');
    console.log('  setup                               # Interactive Yocto project setup');
    console.log('  demo-prompts                        # Try all available prompt types');
    console.log('  help                                # Show this help');
    console.log('\nInteractive Commands:');
    console.log('  /help or help                       # Show this help');
    console.log('  /status or status                   # Show project status');
    console.log('  exit                                # Exit interactive mode');
    console.log('\nOptions:');
    console.log('  -s, --streaming                     # Enable streaming responses (default: true)');
    console.log('  -t, --thinking                      # Enable extended thinking mode (default: true)');
    console.log('  -m, --model <model>                 # AI model (e.g. claude-sonnet-4-20250514, gpt-5)');
    console.log('  --temperature <temp>                # Temperature for AI responses');
    console.log('  --proxy-url <url>                   # Proxy server URL');
    console.log('  -v, --verbose                       # Enable verbose logging');
    console.log('\n💡 Beacon specializes in:');
    console.log('  🔧 Machine configurations and BSP development');
    console.log('  📝 Recipe creation and BitBake syntax');
    console.log('  🏗️  Build optimization and debugging');
    console.log('  🔒 Security hardening and license compliance');
    console.log('  💾 Silicon-specific platform guidance');
    console.log('  🐛 Error diagnosis and troubleshooting');
    console.log('  📚 Layer management and dependencies');
    console.log('  ⚙️  Device tree and kernel configuration');
  }

  async startBeacon(options) {
      const cwd = process.cwd();
      // Claude Code style welcome box  
      console.log('╭───────────────────────────────────────────────────╮');
      console.log('│ ✻ Welcome to Beacon!                              │');
      console.log('│                                                   │');
      console.log('│   /help for help, /status for your current setup  │');
      console.log('│                                                   │');
      console.log(`│   cwd: ${cwd.padEnd(42)} │`);
      console.log('╰───────────────────────────────────────────────────╯');
      console.log();

    try {
      const projectType = await PromptHelper.getProjectType();
      
      if (projectType.value === 'new') {
        await this.createNewProject(options);
      } else {
        await this.startInteractiveMode(options);
      }
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
    }
  }

  async createNewProject(options) {
    console.log(chalk.blue('\n🎯 New Yocto Project Creation'));
    console.log(chalk.gray('─'.repeat(50)));

    try {
      // Get project description first
      const description = await PromptHelper.getProjectDescription();

      // Get project name
      const projectName = await PromptHelper.input('📁 Project name:', {
        default: 'my-yocto-project',
        validate: (input) => {
          const name = input.trim();
          return (name.length > 0 && /^[a-zA-Z0-9_-]+$/.test(name)) || 
                 'Project name must contain only letters, numbers, hyphens, and underscores';
        }
      });

      // Use latest stable release
      const release = { name: 'Latest stable', value: 'latest' };

      console.log(chalk.green('\n✅ Project Configuration Complete!'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`📝 Description: ${chalk.cyan(description)}`);
      console.log(`📁 Project: ${chalk.cyan(projectName)}`);
      console.log(`🏗️  Release: ${chalk.cyan(release.name)}`);

      const proceed = await PromptHelper.confirm('\n🚀 Ready to create your Yocto project?', { default: true });

      if (proceed) {
        // Create the project using AI with enhanced context
        await this.generateYoctoProject({
          description,
          projectName,
          release: release,
          options
        });
      } else {
        console.log(chalk.yellow('Project creation cancelled. You can restart anytime with: beacon'));
      }

    } catch (error) {
      console.error(chalk.red('❌ Project creation failed:'), error.message);
    }
  }

  async generateYoctoProject(config) {
    console.log(chalk.blue('\n🤖 Generating your Yocto project with AI...'));
    console.log(chalk.gray('─'.repeat(60)));

    try {
      console.log(chalk.blue('\n🤖 Beacon AI:'));
      
      // Use the new dedicated server endpoint for project generation
      const requestData = {
        projectName: config.projectName,
        description: config.description,
        streaming: true
      };

      await this.apiClient.generateYoctoProject(requestData);

      console.log(chalk.green('\n🎉 Project generation complete!'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.blue(`📁 Your Yocto project is ready: ${config.projectName}/`));
      console.log(chalk.yellow('💡 Next steps:'));
      console.log(`   1. cd ${config.projectName}`);
      console.log('   2. ./setup-yocto.sh');
      console.log('   3. ./setup-environment.sh');
      console.log('   4. ./build.sh');
      console.log(chalk.blue('\n💬 Continue with: beacon (for more help)'));

    } catch (error) {
      console.error(chalk.red('\n❌ Project generation failed:'), error.message);
      if (error.message.includes('file operation')) {
        console.log(chalk.yellow('💡 This might be due to file permissions or path issues.'));
      }
    }
  }

  showProgressStep(icon, description) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${chalk.cyan(icon)} ${description}... ${chalk.gray(`[${timestamp}]`)}`);
  }

  showOperationStart(operation, details = '') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = chalk.blue('►');
    process.stdout.write(`${prefix} ${chalk.cyan(operation)}${details ? ` ${chalk.gray(details)}` : ''}... ${chalk.gray(`[${timestamp}]`)}`);
  }

  showOperationComplete(duration, result = '') {
    const durationText = duration ? ` ${chalk.gray(`(${duration}ms)`)}` : '';
    const resultText = result ? ` ${chalk.green(result)}` : '';
    console.log(`${durationText}${resultText} ${chalk.green('✓')}`);
  }

  showOperationError(error, duration) {
    const durationText = duration ? ` ${chalk.gray(`(${duration}ms)`)}` : '';
    console.log(`${durationText} ${chalk.red('✗')} ${chalk.red(error)}`);
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isProjectCreationRequest(message) {
    const lowerMessage = message.toLowerCase();
    
    // Check for project creation patterns
    const creationPatterns = [
      /create.*yocto.*project/i,
      /set.*up.*yocto.*project/i,
      /new.*yocto.*project/i,
      /generate.*yocto.*project/i,
      /build.*yocto.*project/i,
      /start.*yocto.*project/i,
      /(create|make|generate|setup|build).*project.*for.*(raspberry|pi|imx|beagle|xilinx|intel)/i,
      /yocto.*for.*(raspberry|pi|imx|beagle|xilinx|intel)/i
    ];
    
    return creationPatterns.some(pattern => pattern.test(message));
  }

  async executeRepositorySetup(config) {
    const path = require('path');
    const { spawn } = require('child_process');
    const fs = require('fs').promises;
    
    const projectPath = path.resolve(config.projectName);
    const setupScriptPath = path.join(projectPath, 'setup-yocto.sh');
    
    try {
      // Verify setup script exists
      await fs.access(setupScriptPath);
      
      // Show initial cloning message
      console.log(chalk.cyan('📦 Cloning Yocto repositories...'));
      
      return new Promise((resolve, reject) => {
        const child = spawn('bash', [setupScriptPath], {
          cwd: projectPath,
          stdio: ['inherit', 'pipe', 'pipe']
        });

        let currentRepo = '';
        let operationStartTime = Date.now();
        
        // Track cloning operations with real-time feedback
        const repositories = [
          { name: 'Poky (core Yocto)', pattern: /Cloning Poky|poky\.git/i, completed: false },
          { name: 'meta-openembedded', pattern: /Cloning meta-openembedded|meta-openembedded\.git/i, completed: false },
          { name: 'meta-raspberrypi', pattern: /Cloning.*Raspberry|meta-raspberrypi\.git/i, completed: false },
          { name: 'meta-freescale', pattern: /Cloning.*NXP|meta-freescale\.git/i, completed: false }
        ];

        const processOutput = (data, isError = false) => {
          const lines = data.toString().split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            // Check if this line indicates a new cloning operation
            const repo = repositories.find(r => !r.completed && r.pattern.test(line));
            
            if (repo) {
              // Complete previous operation if there was one
              if (currentRepo) {
                const duration = ((Date.now() - operationStartTime) / 1000).toFixed(1);
                this.showOperationComplete(null, `(${duration}s)`);
              }
              
              // Start new operation
              currentRepo = repo.name;
              operationStartTime = Date.now();
              this.showOperationStart(`📦 Cloning ${repo.name}`);
              repo.completed = true;
            }
            
            // Check for completion indicators
            else if (line.includes('✅') || line.includes('complete') || 
                     line.match(/Already up to date|already exists/i)) {
              if (currentRepo) {
                const duration = ((Date.now() - operationStartTime) / 1000).toFixed(1);
                this.showOperationComplete(null, `(${duration}s)`);
                currentRepo = '';
              }
            }
            
            // Check for errors
            else if (isError || line.toLowerCase().includes('error') || 
                     line.toLowerCase().includes('failed')) {
              if (currentRepo) {
                const duration = ((Date.now() - operationStartTime) / 1000).toFixed(1);
                this.showOperationError(line, duration);
                currentRepo = '';
              } else {
                console.error(chalk.red(`❌ ${line}`));
              }
            }
          }
        };

        child.stdout.on('data', (data) => processOutput(data, false));
        child.stderr.on('data', (data) => processOutput(data, true));

        child.on('close', (code) => {
          // Complete any remaining operation
          if (currentRepo) {
            const duration = ((Date.now() - operationStartTime) / 1000).toFixed(1);
            if (code === 0) {
              this.showOperationComplete(null, `(${duration}s)`);
            } else {
              this.showOperationError('Clone failed', duration);
            }
          }

          if (code === 0) {
            console.log(chalk.green(`\n✅ Repository setup completed successfully`));
            this.validateRepositories(config).then(resolve).catch(reject);
          } else {
            const error = new Error(`Repository setup failed with exit code ${code}`);
            reject(error);
          }
        });

        child.on('error', (error) => {
          if (currentRepo) {
            const duration = ((Date.now() - operationStartTime) / 1000).toFixed(1);
            this.showOperationError(error.message, duration);
          }
          reject(new Error(`Failed to execute setup script: ${error.message}`));
        });
      });

    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('Setup script not found. File generation may have failed.');
      }
      throw new Error(`Repository setup failed: ${error.message}`);
    }
  }

  async validateRepositories(config) {
    const path = require('path');
    const fs = require('fs').promises;
    
    const projectPath = path.resolve(config.projectName);
    const requiredPaths = [
      'sources/poky',
      'sources/meta-openembedded'
    ];
    
    // Basic validation for core repositories
    
    const validationResults = [];
    
    for (const repoPath of requiredPaths) {
      const fullPath = path.join(projectPath, repoPath);
      try {
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          // Check if it's a git repository
          const gitPath = path.join(fullPath, '.git');
          try {
            await fs.access(gitPath);
            validationResults.push({ path: repoPath, status: 'valid', type: 'git' });
          } catch {
            validationResults.push({ path: repoPath, status: 'directory', type: 'non-git' });
          }
        } else {
          validationResults.push({ path: repoPath, status: 'invalid', error: 'Not a directory' });
        }
      } catch (error) {
        validationResults.push({ path: repoPath, status: 'missing', error: error.message });
      }
    }
    
    const validRepos = validationResults.filter(r => r.status === 'valid').length;
    const totalExpected = requiredPaths.length;
    
    if (validRepos === totalExpected) {
      console.log(chalk.green(`🔍 Validated ${validRepos}/${totalExpected} repositories successfully`));
    } else {
      console.log(chalk.yellow(`⚠️  Validation: ${validRepos}/${totalExpected} repositories found`));
      
      const missing = validationResults.filter(r => r.status === 'missing');
      if (missing.length > 0) {
        console.log(chalk.red('Missing repositories:'));
        missing.forEach(repo => {
          console.log(chalk.red(`  ❌ ${repo.path}`));
        });
        
        throw new Error(`Repository validation failed: ${missing.length} repositories missing`);
      }
    }
  }

  async handleStreamingResponseWithProgress(requestData, config) {
    let currentOperation = null;
    let operationStartTime = Date.now();
    const operations = [];
    
    try {
      const response = await this.apiClient.chatStream(requestData);
      
      // Enhanced operation tracking
      const originalLog = console.log;
      
      console.log = (...args) => {
        const message = args.join(' ');
        
        // Detect various operations and show progress
        const operationPatterns = [
          { pattern: /(Cloning|clone.*repositor)/i, icon: '📦', color: 'yellow', name: 'Repository Setup' },
          { pattern: /(Creating.*director|mkdir)/i, icon: '📁', color: 'blue', name: 'Directory Creation' },
          { pattern: /(Writing|Creating).*local\.conf/i, icon: '⚙️', color: 'cyan', name: 'Configuration Setup' },
          { pattern: /(Writing|Creating).*bblayers\.conf/i, icon: '🔧', color: 'cyan', name: 'Layer Configuration' },
          { pattern: /(Writing|Creating).*README/i, icon: '📝', color: 'green', name: 'Documentation' },
          { pattern: /(Generat|Creat).*BSP/i, icon: '🔧', color: 'magenta', name: 'BSP Configuration' },
          { pattern: /(Writing|Creating).*recipe/i, icon: '🍳', color: 'yellow', name: 'Recipe Creation' },
          { pattern: /(Setting up|Configur).*build/i, icon: '🏗️', color: 'blue', name: 'Build Setup' },
          { pattern: /(Research|Search).*documentation/i, icon: '🔍', color: 'gray', name: 'Documentation Research' },
        ];

        for (const { pattern, icon, color, name } of operationPatterns) {
          if (pattern.test(message)) {
            // Complete previous operation
            if (currentOperation) {
              const duration = Date.now() - operationStartTime;
              this.showOperationComplete(duration);
            }

            // Start new operation
            currentOperation = name;
            operationStartTime = Date.now();
            this.showOperationStart(`${icon} ${name}`);
            operations.push({ name, startTime: operationStartTime });
            
            // Don't show the original message for operations we're tracking
            return;
          }
        }

        // Show progress for file creation
        if (message.includes('✓') || message.includes('Created') || message.includes('✅')) {
          if (currentOperation) {
            const duration = Date.now() - operationStartTime;
            const fileMatch = message.match(/([^/\n]+\.(conf|md|sh|bb|bbappend|inc))/);
            const filename = fileMatch ? fileMatch[1] : '';
            this.showOperationComplete(duration, filename);
            currentOperation = null;
          }
          return; // Don't show the original success message
        }

        // Show regular AI output (but suppress some verbose tool output)
        if (!message.includes('str_replace_based_edit_tool') && 
            !message.includes('tool_use') && 
            !message.includes('Executing') &&
            !message.match(/^(\s*$|─+)$/)) {
          originalLog(...args);
        }
      };

      // Wait for streaming to complete
      await response;
      
      // Complete final operation
      if (currentOperation) {
        const duration = Date.now() - operationStartTime;
        this.showOperationComplete(duration);
      }

      // Restore original functions
      console.log = originalLog;
      
      // Show summary
      if (operations.length > 0) {
        console.log(chalk.green(`\n📊 Completed ${operations.length} operations successfully`));
        console.log(chalk.gray('Operations: ' + operations.map(op => op.name).join(', ')));
      }
      
      return response;
      
    } catch (error) {
      // Restore functions on error
      console.log = originalLog;
      
      if (currentOperation) {
        const duration = Date.now() - operationStartTime;
        this.showOperationError(error.message, duration);
      }
      
      throw error;
    }
  }


  async createProjectFilesLocally(config, aiResponse) {
    const fs = require('fs').promises;
    const path = require('path');
    
    try {
      // Create project directory
      const projectPath = path.resolve(config.projectName);
      await fs.mkdir(projectPath, { recursive: true });
      
      // Create standard Yocto directory structure
      const dirs = ['sources', 'build', 'downloads', 'sstate-cache', 'scripts'];
      for (const dir of dirs) {
        await fs.mkdir(path.join(projectPath, dir), { recursive: true });
        this.showOperationComplete(50, dir);
      }

      // Create setup script for cloning repositories
      const setupScript = this.generateSetupScript(config);
      await fs.writeFile(path.join(projectPath, 'setup-yocto.sh'), setupScript, { mode: 0o755 });
      this.showOperationComplete(100, 'setup-yocto.sh');

      // Create environment setup script
      const envScript = this.generateEnvironmentScript(config);
      await fs.writeFile(path.join(projectPath, 'setup-environment.sh'), envScript, { mode: 0o755 });
      this.showOperationComplete(80, 'setup-environment.sh');

      // Create build script
      const buildScript = this.generateBuildScript(config);
      await fs.writeFile(path.join(projectPath, 'build.sh'), buildScript, { mode: 0o755 });
      this.showOperationComplete(90, 'build.sh');

      // Create configuration templates
      const localConf = this.generateLocalConf(config);
      await fs.mkdir(path.join(projectPath, 'conf'), { recursive: true });
      await fs.writeFile(path.join(projectPath, 'conf', 'local.conf.template'), localConf);
      this.showOperationComplete(120, 'local.conf.template');

      const bblayersConf = this.generateBblayersConf(config);
      await fs.writeFile(path.join(projectPath, 'conf', 'bblayers.conf.template'), bblayersConf);
      this.showOperationComplete(110, 'bblayers.conf.template');

      // Create README
      const readme = this.generateReadme(config);
      await fs.writeFile(path.join(projectPath, 'README.md'), readme);
      this.showOperationComplete(200, 'README.md');

      // Create .gitignore
      const gitignore = this.generateGitignore();
      await fs.writeFile(path.join(projectPath, '.gitignore'), gitignore);
      this.showOperationComplete(30, '.gitignore');

      console.log(chalk.green(`\n✅ Created project structure in: ${projectPath}`));

    } catch (error) {
      this.showOperationError(`Failed to create project files: ${error.message}`, 0);
      throw error;
    }
  }

  generateSetupScript(config) {    
    return `#!/bin/bash
# Yocto Project Setup Script for ${config.projectName}
# Generated by Beacon - Lovable for Yocto
# Using latest stable release

set -e

echo "Setting up Yocto Project ${config.projectName}..."
echo "Using latest stable Yocto release"
echo ""

# Create sources directory if it doesn't exist
mkdir -p sources

# Clone Poky (core Yocto) - latest stable branch
if [ ! -d "sources/poky" ]; then
    echo "Cloning Poky (Yocto core) - latest stable..."
    git clone git://git.yoctoproject.org/poky.git sources/poky
else
    echo "Poky already exists, updating..."
    cd sources/poky
    git pull
    cd ../..
fi

# Clone meta-openembedded - latest stable branch
if [ ! -d "sources/meta-openembedded" ]; then
    echo "Cloning meta-openembedded - latest stable..."
    git clone git://git.openembedded.org/meta-openembedded sources/meta-openembedded
else
    echo "meta-openembedded already exists, updating..."
    cd sources/meta-openembedded
    git pull
    cd ../..
fi

echo ""
echo "✅ Repository setup complete!"
echo "Next steps:"
echo "  1. Run: ./setup-environment.sh"
echo "  2. Run: ./build.sh"
echo ""
`;
  }

  generateEnvironmentScript(config) {
    return `#!/bin/bash
# Yocto Build Environment Setup
# Generated by Beacon - Lovable for Yocto

set -e

if [ ! -d "sources/poky" ]; then
    echo "❌ Poky not found. Run ./setup-yocto.sh first."
    exit 1
fi

# Source the Yocto environment
echo "Setting up Yocto build environment..."
source sources/poky/oe-init-build-env build

# Copy configuration templates if they don't exist
if [ ! -f conf/local.conf.orig ]; then
    cp conf/local.conf conf/local.conf.orig
fi

if [ ! -f conf/bblayers.conf.orig ]; then
    cp conf/bblayers.conf conf/bblayers.conf.orig
fi

# Copy our templates
if [ -f ../conf/local.conf.template ]; then
    echo "Copying local.conf template..."
    cp ../conf/local.conf.template conf/local.conf
fi

if [ -f ../conf/bblayers.conf.template ]; then
    echo "Copying bblayers.conf template..."
    cp ../conf/bblayers.conf.template conf/bblayers.conf
fi

echo "✅ Build environment ready!"
echo "You are now in the build directory."
echo "Run 'bitbake core-image-minimal' to start building."
`;
  }

  generateBuildScript(config) {
    return `#!/bin/bash
# Yocto Build Script
# Generated by Beacon - Lovable for Yocto

set -e

# Check if build environment is set up
if [ ! -d "build" ]; then
    echo "Build environment not found. Running setup..."
    ./setup-environment.sh
fi

cd build

# Source environment
source ../sources/poky/oe-init-build-env .

echo "Starting build process..."

# Build core image
echo "Building core-image-minimal..."
bitbake core-image-minimal

echo ""
echo "✅ Build complete!"
echo "Images are in: build/tmp/deploy/images/\${MACHINE}/"
echo ""
`;
  }

  generateLocalConf(config) {
    return `# Local configuration for ${config.projectName}
# Generated by Beacon - Lovable for Yocto

# Machine Selection (will be determined by AI based on project description)
MACHINE ?= "genericx86-64"

# Default policy config
DISTRO ?= "poky"

# Package Management
PACKAGE_CLASSES ?= "package_rpm"

# SDK/ADT target architecture
SDKMACHINE ?= "x86_64"

# Extra image features
EXTRA_IMAGE_FEATURES ?= "debug-tweaks"

# Additional image features
USER_CLASSES ?= "buildstats image-mklibs image-prelink"

# Interactive shell configuration
PATCHRESOLVE = "noop"

# Disk Space Monitoring
BB_DISKMON_DIRS ??= "\\
    STOPTASKS,\${TMPDIR},1G,100M \\
    STOPTASKS,\${DL_DIR},1G,100M \\
    STOPTASKS,\${SSTATE_DIR},1G,100M \\
    STOPTASKS,/tmp,100M,100K \\
    ABORT,\${TMPDIR},100M,1K \\
    ABORT,\${DL_DIR},100M,1K \\
    ABORT,\${SSTATE_DIR},100M,1K \\
    ABORT,/tmp,10M,1K"

# Hash Equivalence
BB_HASHSERVE = "auto"
BB_SIGNATURE_HANDLER = "OEEquivHash"

# Parallelism Options
BB_NUMBER_THREADS ?= "\${@oe.utils.cpu_count()}"
PARALLEL_MAKE ?= "-j \${@oe.utils.cpu_count()}"

# Download directory
DL_DIR ?= "\${TOPDIR}/../downloads"

# Shared state directory  
SSTATE_DIR ?= "\${TOPDIR}/../sstate-cache"

# Build optimization
INHERIT += "rm_work"
`;
  }

  generateBblayersConf(config) {
    const layers = `  \${BSPDIR}/sources/poky/meta \\
  \${BSPDIR}/sources/poky/meta-poky \\
  \${BSPDIR}/sources/meta-openembedded/meta-oe \\
  \${BSPDIR}/sources/meta-openembedded/meta-python \\`;

    return `# POKY_BBLAYERS_CONF_VERSION is increased each time build/conf/bblayers.conf
# changes incompatibly
POKY_BBLAYERS_CONF_VERSION = "2"

BBPATH = "\${TOPDIR}"
BBFILES ?= ""

BSPDIR := "\${@os.path.abspath(os.path.dirname(d.getVar('FILE', True)) + '/../..')}"

BBLAYERS ?= " \\${layers}
  "
`;
  }

  generateReadme(config) {
    return `# ${config.projectName}

${config.description}

**Yocto Release:** Latest stable (default branch)

## Quick Start

1. **Setup Yocto repositories:**
   \`\`\`bash
   ./setup-yocto.sh
   \`\`\`

2. **Initialize build environment:**
   \`\`\`bash
   ./setup-environment.sh
   \`\`\`

3. **Build the image:**
   \`\`\`bash
   ./build.sh
   \`\`\`

## Project Structure

- \`sources/\` - Yocto layers and BSP sources
- \`build/\` - Build output directory
- \`downloads/\` - Downloaded source packages
- \`sstate-cache/\` - Shared state cache
- \`conf/\` - Configuration templates
- \`scripts/\` - Additional helper scripts

## Manual Build Process

If you prefer to build manually:

\`\`\`bash
# Source the environment (from project root)
source sources/poky/oe-init-build-env build

# Build an image
bitbake core-image-minimal

# Or build SDK
bitbake core-image-minimal -c populate_sdk
\`\`\`

## Build Output

See the generated build output in \`build/tmp/deploy/images/\${MACHINE}/\`

## Generated by Beacon

This project was generated by **Beacon - Lovable for Yocto**, an AI-powered tool for embedded Linux development.

For more help: \`beacon --help\`
`;
  }

  generateGitignore() {
    return `# Yocto build artifacts
build/
downloads/
sstate-cache/
cache/

# Temporary files
*.tmp
*.temp
*.log

# IDE files
.vscode/
.idea/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db

# Local environment
.env
local.conf
bblayers.conf

# Backup files
*.orig
*.bak
*~
`;
  }

  async createNewProjectWithDescription(initialDescription, options) {
    console.log(chalk.blue('\n🎯 New Yocto Project Creation'));
    console.log(chalk.gray('─'.repeat(50)));

    try {
      // Use the provided description or ask for refinement
      console.log(chalk.cyan(`Initial request: "${initialDescription}"`));
      
      // Check if we're in a good location for project creation
      const cwd = process.cwd();
      const shouldCreateDir = !cwd.includes('yocto') && !cwd.endsWith('/projects') && !cwd.endsWith('/workspace');
      
      if (shouldCreateDir) {
        console.log(chalk.yellow(`\n💡 Current directory: ${cwd}`));
        console.log(chalk.yellow('Recommendation: Create project in a dedicated directory'));
        
        const createInSubdir = await PromptHelper.confirm('Create project in a subdirectory?', { default: true });
        if (createInSubdir) {
          const subdirName = await PromptHelper.input('Directory name:', { default: 'yocto-projects' });
          const fs = require('fs').promises;
          const path = require('path');
          const newDir = path.resolve(subdirName);
          
          await fs.mkdir(newDir, { recursive: true });
          process.chdir(newDir);
          console.log(chalk.green(`✅ Created and switched to: ${newDir}`));
        }
      }
      
      const description = await PromptHelper.confirm('Use this description as-is?', { default: true })
        ? initialDescription
        : await PromptHelper.getProjectDescription();

      // Get project name with smart default
      const defaultName = initialDescription
        .toLowerCase()
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 30) || 'my-yocto-project';

      const projectName = await PromptHelper.input('📁 Project name:', {
        default: defaultName,
        validate: (input) => {
          const name = input.trim();
          return (name.length > 0 && /^[a-zA-Z0-9_-]+$/.test(name)) || 
                 'Project name must contain only letters, numbers, hyphens, and underscores';
        }
      });

      // Use latest stable release
      const release = { name: 'Latest stable', value: 'latest' };

      console.log(chalk.green('\n✅ Project Configuration Complete!'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`📝 Description: ${chalk.cyan(description)}`);
      console.log(`📁 Project: ${chalk.cyan(projectName)}`);
      console.log(`🏗️  Release: ${chalk.cyan(release.name)}`);

      const proceed = await PromptHelper.confirm('\n🚀 Ready to create your Yocto project?', { default: true });

      if (proceed) {
        // Create the project using AI with enhanced context
        await this.generateYoctoProject({
          description,
          projectName,
          release: release,
          options
        });
      } else {
        console.log(chalk.yellow('Project creation cancelled. You can restart anytime with: beacon'));
      }

    } catch (error) {
      console.error(chalk.red('❌ Project creation failed:'), error.message);
    }
  }





  async startInteractiveMode(options) {
    const cwd = process.cwd();
    const hasYoctoProject = await this.detectYoctoProject(cwd);

    // Track Ctrl+C presses to support "press twice to exit"
    let lastSigintAt = 0;
    const SIGINT_WINDOW_MS = 2000;
    let sigintJustHandled = false;
    process.on('SIGINT', () => {
      const now = Date.now();
      if (now - lastSigintAt < SIGINT_WINDOW_MS) {
        restoreCursor();
        console.log('\n👋 Happy building with Yocto!');
        process.exit(130);
      }
      lastSigintAt = now;
      sigintJustHandled = true;
      // Reset flag on next tick so prompt catch won't double-handle
      setImmediate(() => { sigintJustHandled = false; });
      console.log();
      console.log(chalk.yellow('Press CTRL-C again to exit'));
    });

    if (hasYoctoProject) {
      console.log(' What\'s here:');
      console.log('  • Existing Yocto project detected - ready for recipes, builds, and debugging');
    } else {
      console.log(' What\'s new:');
      console.log('  • No Yocto project found - I can help you set up a new project or work with existing files');
    }

    console.log('Capabilities');
    console.log('Building with extended thinking');
    const activeModel = (options && options.model) || process.env.DEFAULT_MODEL || 'gpt-4o-mini';
    console.log(chalk.gray(`Model: ${activeModel}  (override with -m <model> or DEFAULT_MODEL env)`));
    console.log();

    const context = [];
    
    while (true) {
      try {
        const message = await PromptHelper.input('>', {
          validate: (input) => input.trim().length > 0 || 'Please enter a message'
        });

        if (message.toLowerCase() === 'exit') {
          break;
        }

        if (message.toLowerCase() === '/help' || message.toLowerCase() === 'help') {
          this.showHelp();
          continue;
        }

        if (message.toLowerCase() === '/status' || message.toLowerCase() === 'status') {
          await this.showProjectStatus();
          continue;
        }

        // Check if this is a project creation request
        if (this.isProjectCreationRequest(message)) {
          await this.createNewProjectWithDescription(message, options);
          // Exit interactive mode after project creation
          console.log(chalk.blue('\n💬 Project created! Run beacon again for more help.'));
          break;
        }

        // Add user message to context
        context.push({ role: 'user', content: message });

        // Get project context for each message
        const projectContext = await this.getProjectContext();
        
        // Enhance message with context
        const contextualMessage = `Working Directory: ${projectContext.workingDirectory}
${projectContext.hasYoctoProject ? 'Yocto Project: Detected' : 'Yocto Project: Not detected'}
${projectContext.projectFiles.length > 0 ? `Relevant files: ${projectContext.projectFiles.slice(0, 5).join(', ')}` : ''}

User Request: ${message}`;

        const requestData = {
          message: contextualMessage,
          context: context.slice(0, -1),
          useYoctoPrompt: true,
          model: options.model || process.env.DEFAULT_MODEL || 'gpt-4o-mini',
          temperature: options.thinking === true ? 1 : 0.1, // Must be 1 when thinking is enabled
          maxTokens: 16000,
          streaming: options.streaming !== false,
          extendedThinking: options.thinking === true, // Default to false
          tools: []
        };

        if (requestData.streaming) {
          const response = await this.handleStreamingResponse(requestData);
          // Add assistant response to context
          if (response.response) {
            context.push({ role: 'assistant', content: response.response });
          }
        } else {
          const response = await this.apiClient.chat(requestData);
          console.log(response.response);
          
          // Add assistant response to context
          context.push({ role: 'assistant', content: response.response });

          if (response.usage && options.verbose) {
            console.log(chalk.gray(`📊 ${response.usage.input_tokens} in, ${response.usage.output_tokens} out tokens`));
          }
        }

        console.log(); // Empty line for spacing

      } catch (error) {
        // Friendly Ctrl+C handling: first press shows hint, second within window exits
        const msg = String((error && error.message) || '');
        const isSigint = (
          error && (error.signal === 'SIGINT' || error.name === 'AbortError' || error.isCanceled === true)
        ) || /SIGINT|canceled|cancelled|aborted|force closed/i.test(msg);

        if (isSigint) {
          if (sigintJustHandled) {
            // Process-level handler already displayed the hint; just re-prompt
            continue;
          }
          const now = Date.now();
          if (now - lastSigintAt < SIGINT_WINDOW_MS) {
            restoreCursor();
            console.log('\n👋 Happy building with Yocto!');
            process.exit(130); // 130 = terminated by Ctrl+C
          }
          lastSigintAt = now;
          console.log();
          console.log(chalk.yellow('Press CTRL-C again to exit'));
          continue; // re-prompt
        }

        console.error(chalk.red('❌ Error:'), error.message);
      }
    }
  }



  async handleStreamingResponse(requestData) {
    try {
      const response = await this.apiClient.chatStream(requestData);
      console.log(); // New line after streaming output
      
      if (response.usage && requestData.verbose) {
        console.log(chalk.gray(`📊 Usage: ${response.usage.input_tokens} input, ${response.usage.output_tokens} output tokens`));
      }
      
      return response;
    } catch (error) {
      console.error(chalk.red('❌ Streaming error:'), error.message);
      throw error;
    }
  }

  async runProjectSetup(options) {
    console.log(chalk.blue('\n🚀 Yocto Project Setup Wizard'));
    console.log(chalk.gray('─'.repeat(50)));

    try {
      const config = await PromptHelper.getProjectConfiguration();
      
      console.log(chalk.green('\n✅ Configuration Complete!'));
      console.log(chalk.gray('─'.repeat(30)));
      console.log(`Project: ${chalk.cyan(config.projectName)}`);
      console.log(`Machine: ${chalk.cyan(config.machine)}`);
      console.log(`Distro: ${chalk.cyan(config.distro.value || config.distro)}`);
      console.log(`Release: ${chalk.cyan(config.release.value || config.release)}`);
      console.log(`Build Options: ${chalk.cyan(config.buildOptions.map(opt => opt.value || opt).join(', '))}`);
      console.log(`Shared State: ${chalk.cyan(config.useSharedState ? 'Yes' : 'No')}`);
      if (config.sharedStateDir) {
        console.log(`Shared State Dir: ${chalk.cyan(config.sharedStateDir)}`);
      }

      const proceed = await PromptHelper.confirm('\nWould you like me to help create the project structure?', { default: true });
      
      if (proceed) {
        console.log(chalk.blue('\n🔧 I can help you:'));
        console.log('  • Initialize the Yocto environment');
        console.log('  • Configure local.conf and bblayers.conf');
        console.log('  • Set up the directory structure');
        console.log('  • Create initial recipes if needed');
        console.log(chalk.yellow('\nJust ask me: "Set up my Yocto project with the configuration we just created"'));
      }
    } catch (error) {
      console.error(chalk.red('❌ Setup cancelled or failed:'), error.message);
    }
  }

  async demoPrompts() {
    console.log(chalk.blue('\n🎨 Inquirer Prompts Demo'));
    console.log(chalk.gray('─'.repeat(50)));

    try {
      // Input prompt
      const name = await PromptHelper.input('What is your name?');
      console.log(chalk.green(`Hello, ${name}!`));

      // Select prompt
      const color = await PromptHelper.select('What is your favorite color?', [
        'red', 'green', 'blue', 'yellow', 'purple'
      ]);
      console.log(chalk.green(`Nice choice: ${color}`));

      // Confirm prompt
      const likes = await PromptHelper.confirm('Do you like Yocto development?', { default: true });
      console.log(chalk.green(likes ? 'Great! This tool will help you.' : 'This tool might change your mind!'));

      // Multiple select prompt
      const tools = await PromptHelper.multiSelect('Which development tools do you use?', [
        { name: 'VS Code', value: 'vscode' },
        { name: 'Vim/Neovim', value: 'vim' },
        { name: 'Emacs', value: 'emacs' },
        { name: 'BitBake', value: 'bitbake' },
        { name: 'Git', value: 'git' },
        { name: 'Docker', value: 'docker' }
      ]);
      console.log(chalk.green(`Your tools: ${tools.map(t => t.value || t).join(', ')}`));

      // Number prompt
      const experience = await PromptHelper.number('How many years of Linux experience do you have?', {
        min: 0,
        max: 50
      });
      console.log(chalk.green(`${experience} years - ${experience > 5 ? 'experienced!' : 'welcome to the journey!'}`));

      // Expand prompt (single letter shortcuts)
      const action = await PromptHelper.expand('What would you like to do next?', [
        { key: 'c', name: 'Create a new recipe', value: 'create' },
        { key: 'b', name: 'Build an image', value: 'build' },
        { key: 'd', name: 'Debug an issue', value: 'debug' },
        { key: 'q', name: 'Quit demo', value: 'quit' }
      ]);
      console.log(chalk.green(`Selected action: ${action.value || action}`));

      // Raw list prompt (numbered)
      const priority = await PromptHelper.rawList('What is your top priority?', [
        'Fast build times',
        'Small image size', 
        'Security hardening',
        'Easy debugging',
        'Rich feature set'
      ]);
      console.log(chalk.green(`Your priority: ${priority}`));

      // Editor prompt (opens editor)
      const editDemo = await PromptHelper.confirm('Would you like to try the editor prompt?', { default: false });
      if (editDemo) {
        const recipe = await PromptHelper.editor('Write a simple BitBake recipe (opens in your default editor):');
        console.log(chalk.green(`Recipe content (${recipe.length} characters):`));
        console.log(chalk.gray(recipe.substring(0, 200) + (recipe.length > 200 ? '...' : '')));
      }

      console.log(chalk.blue('\n✨ Demo complete! All prompt types are now available in your CLI.'));

    } catch (error) {
      console.error(chalk.red('❌ Demo cancelled:'), error.message);
    }
  }

  run() {
    this.program.parse();
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error(chalk.red('💥 Uncaught Exception:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('💥 Unhandled Rejection:'), reason);
  process.exit(1);
});

// Create and run CLI
const cli = new BeaconYoctoCLI();
cli.run();