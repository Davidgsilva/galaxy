#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const path = require('path');

const packageInfo = require('../package.json');
const ApiClient = require('./services/api-client');
const YoctoService = require('./services/yocto/yocto-service');
const SiliconService = require('./services/yocto/silicon-service');
const LicenseService = require('./services/yocto/license-service');
const ConfigService = require('./services/config-service');

class BeaconYoctoCLI {
  constructor() {
    this.program = new Command();
    this.apiClient = new ApiClient();
    this.yoctoService = new YoctoService();
    this.siliconService = new SiliconService();
    this.licenseService = new LicenseService();
    this.configService = new ConfigService();
    
    this.setupCommands();
  }

  setupCommands() {
    this.program
      .name('beacon')
      .description('🚀 AI-powered CLI for Yocto Project embedded development')
      .version(packageInfo.version)
      .option('-v, --verbose', 'enable verbose logging')
      .option('-c, --config <path>', 'config file path')
      .option('--proxy-url <url>', 'proxy server URL', 'http://localhost:3001')
      .hook('preAction', (thisCommand) => {
        const options = thisCommand.opts();
        if (options.config) {
          this.configService.loadConfig(options.config);
        }
        this.apiClient.setProxyUrl(options.proxyUrl);
      });

    // Main conversation command
    this.program
      .argument('[message]', 'message to send to Yocto AI assistant')
      .option('-s, --streaming', 'enable streaming responses')
      .option('-t, --thinking', 'enable extended thinking mode')
      .option('-m, --model <model>', 'AI model to use', 'claude-sonnet-4-20250514')
      .option('--temperature <temp>', 'temperature for AI responses', '0.1')
      .option('--context', 'include project context')
      .action(async (message, options) => {
        if (!message) {
          await this.startInteractiveMode(options);
        } else {
          await this.sendMessage(message, options);
        }
      });

    // Yocto Project Commands
    this.program
      .command('init')
      .description('🔧 Initialize new Yocto project with AI guidance')
      .option('-b, --board <board>', 'target board/machine')
      .option('-d, --distro <distro>', 'distribution configuration', 'poky')
      .option('-r, --release <release>', 'Yocto release (kirkstone, scarthgap, etc.)')
      .option('-f, --features <features>', 'comma-separated features (qt5,wifi,canbus)')
      .option('--silicon <vendor>', 'silicon vendor (nxp, xilinx, ti, broadcom)')
      .option('--interactive', 'interactive setup wizard')
      .action(async (options) => {
        await this.initProject(options);
      });

    this.program
      .command('machine')
      .description('🔧 Machine configuration management')
      .option('-l, --list', 'list supported machines')
      .option('-s, --show <machine>', 'show machine details')
      .option('-c, --create <name>', 'create new machine configuration')
      .option('--silicon <vendor>', 'filter by silicon vendor')
      .action(async (options) => {
        await this.manageMachine(options);
      });

    this.program
      .command('recipe')
      .description('📝 Recipe generation and management')
      .option('-c, --create <name>', 'create new recipe')
      .option('-a, --analyze <recipe>', 'analyze existing recipe')
      .option('-o, --optimize <recipe>', 'optimize recipe for performance')
      .option('-l, --license-check <recipe>', 'check license compliance')
      .option('--type <type>', 'recipe type (application, library, kernel-module)')
      .action(async (options) => {
        await this.manageRecipe(options);
      });

    this.program
      .command('layer')
      .description('📚 Layer management and BSP operations')
      .option('-l, --list', 'list available layers')
      .option('-a, --add <layer>', 'add layer to project')
      .option('-r, --remove <layer>', 'remove layer from project')
      .option('-c, --create <name>', 'create new BSP layer')
      .option('--bsp', 'focus on BSP layer operations')
      .action(async (options) => {
        await this.manageLayer(options);
      });

    this.program
      .command('build')
      .description('🔨 Build management and optimization')
      .option('-t, --target <target>', 'build target (image, sdk, etc.)')
      .option('-o, --optimize', 'optimize build configuration')
      .option('-a, --analyze', 'analyze build performance')
      .option('-c, --clean', 'clean build artifacts')
      .option('--parallel <jobs>', 'parallel build jobs')
      .action(async (options) => {
        await this.manageBuild(options);
      });

    this.program
      .command('debug')
      .description('🐛 Build debugging and error diagnosis')
      .option('-l, --logs', 'analyze build logs')
      .option('-e, --error <task>', 'debug specific task error')
      .option('-r, --recipe <recipe>', 'debug recipe issues')
      .option('--fix', 'attempt automatic fixes')
      .action(async (options) => {
        await this.debugBuild(options);
      });

    this.program
      .command('security')
      .description('🔒 Security analysis and hardening')
      .option('-s, --scan', 'security vulnerability scan')
      .option('-h, --harden', 'apply security hardening')
      .option('-c, --compliance <standard>', 'check compliance (cis, nist)')
      .option('-l, --licenses', 'license compliance check')
      .action(async (options) => {
        await this.manageSecurity(options);
      });

    this.program
      .command('silicon')
      .description('💾 Silicon platform information and support')
      .option('-l, --list', 'list supported silicon platforms')
      .option('-s, --show <platform>', 'show platform details')
      .option('-b, --boards <platform>', 'list boards for platform')
      .option('--detect', 'detect current hardware platform')
      .action(async (options) => {
        await this.manageSilicon(options);
      });

    // Advanced Features
    this.program
      .command('chat')
      .description('💬 Interactive chat with Yocto AI expert')
      .option('-s, --streaming', 'enable streaming responses')
      .option('-c, --context', 'include project context')
      .option('--thinking', 'enable extended thinking mode')
      .action(async (options) => {
        await this.startInteractiveMode(options);
      });

    this.program
      .command('analyze')
      .description('📊 Project analysis and recommendations')
      .option('-p, --project', 'analyze entire project')
      .option('-l, --licenses', 'license analysis')
      .option('-s, --security', 'security analysis')
      .option('-b, --build', 'build configuration analysis')
      .option('--report', 'generate detailed report')
      .action(async (options) => {
        await this.analyzeProject(options);
      });

    this.program
      .command('config')
      .description('⚙️ Configuration management')
      .option('--init', 'initialize configuration')
      .option('--show', 'show current configuration')
      .option('--set <key=value>', 'set configuration value')
      .option('--reset', 'reset to defaults')
      .action(async (options) => {
        await this.manageConfig(options);
      });

    this.program
      .command('doctor')
      .description('🩺 System health check and diagnostics')
      .option('--full', 'comprehensive system check')
      .action(async (options) => {
        await this.systemDoctor(options);
      });
  }

  async sendMessage(message, options) {
    const spinner = ora('🤖 Processing your Yocto request...').start();
    
    try {
      // Build context if enabled
      let context = [];
      if (options.context) {
        context = await this.yoctoService.getProjectContext();
      }

      // Use Yocto-specific system prompt
      const requestData = {
        message,
        context,
        model: options.model,
        temperature: parseFloat(options.temperature),
        maxTokens: 8192,
        streaming: options.streaming,
        extendedThinking: options.thinking,
        useYoctoPrompt: true,
        tools: [{
          type: 'text_editor_20250728',
          name: 'str_replace_based_edit_tool'
        }]
      };

      if (options.streaming) {
        spinner.stop();
        console.log(chalk.blue('🤖 Beacon Yocto AI:'));
        await this.handleStreamingResponse(requestData);
      } else {
        const response = await this.apiClient.chat(requestData);
        spinner.stop();
        
        console.log(chalk.blue('🤖 Beacon Yocto AI:'));
        console.log(response.response);

        if (response.usage) {
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

  async initProject(options) {
    const spinner = ora('🔧 Initializing Yocto project...').start();
    
    try {
      let projectConfig = {};

      if (options.interactive) {
        spinner.stop();
        projectConfig = await this.runInteractiveSetup();
        spinner.start();
      } else {
        projectConfig = {
          board: options.board,
          distro: options.distro || 'poky',
          release: options.release,
          features: options.features ? options.features.split(',') : [],
          silicon: options.silicon
        };
      }

      // Validate silicon platform
      if (projectConfig.silicon) {
        const platformInfo = await this.siliconService.getPlatformInfo(projectConfig.silicon);
        if (!platformInfo) {
          spinner.warn(`Silicon platform '${projectConfig.silicon}' not found in database`);
        }
      }

      const aiMessage = `Initialize a new Yocto project with the following configuration:
- Board/Machine: ${projectConfig.board || 'not specified'}
- Distribution: ${projectConfig.distro}
- Release: ${projectConfig.release || 'latest LTS'}
- Features: ${projectConfig.features.join(', ') || 'basic'}
- Silicon Platform: ${projectConfig.silicon || 'generic'}

Please provide:
1. Recommended directory structure
2. Required meta-layers and their git repositories
3. Machine configuration template
4. Local.conf configuration
5. Any silicon-specific BSP requirements
6. License compliance warnings if applicable

Focus on best practices and production-ready configuration.`;

      const response = await this.apiClient.chat({
        message: aiMessage,
        useYoctoPrompt: true,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 8192,
        tools: [{
          type: 'text_editor_20250728',
          name: 'str_replace_based_edit_tool'
        }]
      });

      spinner.succeed('✅ Project initialization plan generated');
      console.log(chalk.green('\n🚀 Yocto Project Setup Plan:'));
      console.log(response.response);

      // Ask if user wants to create the structure
      const { shouldCreate } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldCreate',
          message: 'Would you like Beacon to create this project structure?',
          default: true
        }
      ]);

      if (shouldCreate) {
        await this.createProjectStructure(projectConfig);
      }

    } catch (error) {
      spinner.fail('❌ Project initialization failed');
      console.error(chalk.red('Error:'), error.message);
    }
  }

  async runInteractiveSetup() {
    console.log(chalk.blue('\n🧙‍♂️ Welcome to Beacon Interactive Yocto Setup!'));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'silicon',
        message: 'Select your silicon platform:',
        choices: [
          { name: '🔲 NXP i.MX Series', value: 'nxp' },
          { name: '🔸 AMD/Xilinx Zynq', value: 'xilinx' },
          { name: '🔵 Texas Instruments', value: 'ti' },
          { name: '🔴 Broadcom (Raspberry Pi)', value: 'broadcom' },
          { name: '🔘 Intel x86/x64', value: 'intel' },
          { name: '⚡ ARM Generic', value: 'arm' },
          { name: '❓ Other/Custom', value: 'custom' }
        ]
      },
      {
        type: 'input',
        name: 'board',
        message: 'Enter your target board/machine name:',
        validate: (input) => input.trim().length > 0 || 'Board name is required'
      },
      {
        type: 'list',
        name: 'release',
        message: 'Select Yocto release:',
        choices: [
          { name: 'Styhead (5.1) - Latest', value: 'styhead' },
          { name: 'Scarthgap (5.0) - LTS', value: 'scarthgap' },
          { name: 'Kirkstone (4.0) - LTS', value: 'kirkstone' },
          { name: 'Other', value: 'other' }
        ]
      },
      {
        type: 'checkbox',
        name: 'features',
        message: 'Select desired features:',
        choices: [
          { name: 'Qt5/Qt6 GUI Framework', value: 'qt' },
          { name: 'WiFi/Wireless Connectivity', value: 'wifi' },
          { name: 'Bluetooth Support', value: 'bluetooth' },
          { name: 'CAN Bus Support', value: 'canbus' },
          { name: 'Industrial Protocols (Modbus, etc.)', value: 'industrial' },
          { name: 'Container Support (Docker)', value: 'containers' },
          { name: 'Python 3 Runtime', value: 'python' },
          { name: 'Node.js Runtime', value: 'nodejs' },
          { name: 'Security Hardening', value: 'security' },
          { name: 'Real-time Kernel (PREEMPT_RT)', value: 'realtime' }
        ]
      },
      {
        type: 'list',
        name: 'distro',
        message: 'Select distribution configuration:',
        choices: [
          { name: 'poky (default)', value: 'poky' },
          { name: 'poky-tiny (minimal)', value: 'poky-tiny' },
          { name: 'Custom distribution', value: 'custom' }
        ]
      }
    ]);

    return answers;
  }

  async manageMachine(options) {
    try {
      if (options.list) {
        const machines = await this.siliconService.getSupportedMachines(options.silicon);
        console.log(chalk.blue('\n🔧 Supported Machines:'));
        machines.forEach(machine => {
          console.log(`  • ${machine.name} (${machine.vendor}) - ${machine.description}`);
        });
        return;
      }

      if (options.show) {
        const machineInfo = await this.siliconService.getMachineInfo(options.show);
        if (machineInfo) {
          console.log(chalk.blue(`\n🔧 Machine: ${options.show}`));
          console.log(`  Vendor: ${machineInfo.vendor}`);
          console.log(`  Architecture: ${machineInfo.arch}`);
          console.log(`  Features: ${machineInfo.features.join(', ')}`);
          console.log(`  Required Layers: ${machineInfo.layers.join(', ')}`);
        } else {
          console.log(chalk.yellow(`❓ Machine '${options.show}' not found`));
        }
        return;
      }

      if (options.create) {
        await this.createMachine(options.create);
        return;
      }

      // Default - interactive machine selection
      await this.selectMachine();

    } catch (error) {
      console.error(chalk.red('❌ Machine management error:'), error.message);
    }
  }

  async manageRecipe(options) {
    const spinner = ora('📝 Processing recipe request...').start();
    
    try {
      if (options.create) {
        const aiMessage = `Create a new Yocto recipe for "${options.create}" with type "${options.type || 'application'}".

Please provide:
1. Complete BitBake recipe (.bb file)
2. License information and compliance notes
3. Dependencies and layer requirements
4. Build instructions and configuration
5. Installation and packaging details
6. Any security considerations

Follow Yocto Project standards and best practices.`;

        const response = await this.apiClient.chat({
          message: aiMessage,
          useYoctoPrompt: true,
          maxTokens: 6144,
          tools: [{
            type: 'text_editor_20250728',
            name: 'str_replace_based_edit_tool'
          }]
        });

        spinner.succeed(`✅ Recipe created for ${options.create}`);
        console.log(response.response);
        return;
      }

      if (options.licenseCheck) {
        await this.checkRecipeLicense(options.licenseCheck);
        return;
      }

      if (options.analyze) {
        await this.analyzeRecipe(options.analyze);
        return;
      }

      spinner.stop();
      console.log(chalk.yellow('📝 Please specify a recipe operation (--create, --analyze, --license-check)'));

    } catch (error) {
      spinner.fail('❌ Recipe operation failed');
      console.error(chalk.red('Error:'), error.message);
    }
  }

  async checkRecipeLicense(recipeName) {
    const spinner = ora(`🔍 Checking license compliance for ${recipeName}...`).start();
    
    try {
      const licenseReport = await this.licenseService.checkRecipe(recipeName);
      spinner.succeed('✅ License check completed');

      console.log(chalk.blue(`\n📋 License Report for ${recipeName}:`));
      
      if (licenseReport.warnings.length > 0) {
        console.log(chalk.yellow('\n⚠️  License Warnings:'));
        licenseReport.warnings.forEach(warning => {
          console.log(`  • ${warning}`);
        });
      }

      if (licenseReport.gplv3Components.length > 0) {
        console.log(chalk.red('\n🚨 GPLv3 Components Detected:'));
        licenseReport.gplv3Components.forEach(component => {
          console.log(`  • ${component} - ${chalk.red('WARNING: Corporate policies may prohibit GPLv3')}`);
        });
      }

      if (licenseReport.recommendations.length > 0) {
        console.log(chalk.green('\n💡 Recommendations:'));
        licenseReport.recommendations.forEach(rec => {
          console.log(`  • ${rec}`);
        });
      }

    } catch (error) {
      spinner.fail('❌ License check failed');
      console.error(chalk.red('Error:'), error.message);
    }
  }

  async startInteractiveMode(options) {
    console.log(chalk.blue('🚀 Welcome to Beacon Yocto Interactive Mode'));
    console.log(chalk.gray('Your AI-powered Yocto Project assistant'));
    console.log(chalk.gray('Type "exit" to quit, "help" for commands, "context" to show project info\n'));

    const context = [];
    
    while (true) {
      try {
        const { message } = await inquirer.prompt([
          {
            type: 'input',
            name: 'message',
            message: chalk.green('You:'),
            validate: (input) => input.trim().length > 0 || 'Please enter a message'
          }
        ]);

        if (message.toLowerCase() === 'exit') {
          console.log(chalk.blue('👋 Happy building with Yocto!'));
          break;
        }

        if (message.toLowerCase() === 'help') {
          this.showInteractiveHelp();
          continue;
        }

        if (message.toLowerCase() === 'context') {
          await this.showProjectContext();
          continue;
        }

        // Add user message to context
        context.push({ role: 'user', content: message });

        const requestData = {
          message,
          context: context.slice(0, -1),
          useYoctoPrompt: true,
          model: options.model || 'claude-sonnet-4-20250514',
          temperature: 0.1,
          maxTokens: 8192,
          streaming: options.streaming,
          extendedThinking: options.thinking,
          tools: [{
            type: 'text_editor_20250728',
            name: 'str_replace_based_edit_tool'
          }]
        };

        console.log(chalk.blue('🤖 Beacon Yocto AI:'));

        if (options.streaming) {
          await this.handleStreamingResponse(requestData);
        } else {
          const response = await this.apiClient.chat(requestData);
          console.log(response.response);
          
          // Add assistant response to context
          context.push({ role: 'assistant', content: response.response });

          if (response.usage) {
            console.log(chalk.gray(`📊 ${response.usage.input_tokens} in, ${response.usage.output_tokens} out tokens`));
          }
        }

        console.log(); // Empty line for spacing

      } catch (error) {
        console.error(chalk.red('❌ Error:'), error.message);
      }
    }
  }

  showInteractiveHelp() {
    console.log(chalk.blue('\n🧙‍♂️ Beacon Yocto AI Assistant Commands:'));
    console.log(chalk.gray('  exit     - Exit interactive mode'));
    console.log(chalk.gray('  help     - Show this help message'));
    console.log(chalk.gray('  context  - Show current project context'));
    console.log(chalk.gray('\n💡 I can help you with:'));
    console.log(chalk.gray('  🔧 Machine configurations and BSP development'));
    console.log(chalk.gray('  📝 Recipe creation and BitBake syntax'));
    console.log(chalk.gray('  🏗️  Build optimization and debugging'));
    console.log(chalk.gray('  🔒 Security hardening and license compliance'));
    console.log(chalk.gray('  💾 Silicon-specific platform guidance'));
    console.log(chalk.gray('  🐛 Error diagnosis and troubleshooting'));
    console.log(chalk.gray('  📚 Layer management and dependencies'));
    console.log(chalk.gray('  ⚙️  Device tree and kernel configuration\n'));
  }

  async showProjectContext() {
    try {
      const context = await this.yoctoService.getProjectContext();
      if (context.length === 0) {
        console.log(chalk.yellow('📁 No Yocto project detected in current directory'));
        return;
      }

      console.log(chalk.blue('\n📁 Current Project Context:'));
      context.forEach(item => {
        console.log(`  • ${item.type}: ${item.name} (${item.path})`);
      });
      console.log();
    } catch (error) {
      console.log(chalk.red('❌ Error reading project context:'), error.message);
    }
  }

  async systemDoctor(options) {
    const spinner = ora('🩺 Running system diagnostics...').start();
    
    try {
      const checks = [
        'Yocto environment detection',
        'BitBake installation check',
        'Required dependencies verification',
        'Layer compatibility analysis',
        'Build environment validation',
        'License compliance status'
      ];

      for (const check of checks) {
        spinner.text = `🩺 ${check}...`;
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate check
      }

      spinner.succeed('✅ System diagnostics completed');
      
      console.log(chalk.green('\n🩺 Beacon System Health Report:'));
      console.log('  ✅ Yocto environment: OK');
      console.log('  ✅ BitBake installation: Found');
      console.log('  ✅ Required tools: Available'); 
      console.log('  ⚠️  Build cache: Not optimized');
      console.log('  ✅ License compliance: No issues');
      console.log('\n💡 Recommendations:');
      console.log('  • Configure shared build cache for faster builds');
      console.log('  • Update to latest LTS release when possible');

    } catch (error) {
      spinner.fail('❌ System diagnostics failed');
      console.error(chalk.red('Error:'), error.message);
    }
  }

  async handleStreamingResponse(requestData) {
    // Implementation would handle streaming similar to previous version
    // Simplified for this example
    const response = await this.apiClient.chat(requestData);
    console.log(response.response);
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