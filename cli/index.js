#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const path = require('path');

const packageInfo = require('../package.json');
const ApiClient = require('./services/api-client');

class BeaconYoctoCLI {
  constructor() {
    this.program = new Command();
    this.apiClient = new ApiClient();
    
    this.setupCommands();
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
      .option('-t, --thinking', 'enable extended thinking mode', true)
      .option('-m, --model <model>', 'AI model to use', 'claude-sonnet-4-20250514')
      .option('--temperature <temp>', 'temperature for AI responses', '0.1')
      .action(async (message, options) => {
        if (!message) {
          await this.startInteractiveMode(options);
        } else {
          await this.sendMessage(message, options);
        }
      });

    // Help command
    this.program
      .command('help')
      .description('Show help information')
      .action(() => {
        this.showHelp();
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
        temperature: options.thinking !== false ? 1 : parseFloat(options.temperature), // Must be 1 when thinking is enabled
        maxTokens: 16000,
        streaming: options.streaming,
        extendedThinking: options.thinking !== false, // Default to true
        useYoctoPrompt: true,
        tools: [{
          type: 'text_editor_20250728',
          name: 'str_replace_based_edit_tool'
        }]
      };

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
    console.log('\nExamples:');
    console.log('  beacon "Create a Qt5 recipe"');
    console.log('  beacon "Help debug my build error"');
    console.log('  beacon "Set up WiFi drivers for i.MX8"');
    console.log('\nInteractive Commands:');
    console.log('  /help or help                       # Show this help');
    console.log('  /status or status                   # Show project status');
    console.log('  exit                                # Exit interactive mode');
    console.log('\nOptions:');
    console.log('  -s, --streaming                     # Enable streaming responses (default: true)');
    console.log('  -t, --thinking                      # Enable extended thinking mode (default: true)');
    console.log('  -m, --model <model>                 # AI model to use');
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





  async startInteractiveMode(options) {
    const cwd = process.cwd();
    const hasYoctoProject = await this.detectYoctoProject(cwd);
    
    // Multiple attempts to disable cursor blinking
    process.stdout.write('\x1b[?12l'); // Stop cursor blinking (method 1)
    process.stdout.write('\x1b[2 q');  // Steady block cursor (method 2)
    process.stdout.write('\x1b]12;white\x07'); // Set cursor color (sometimes helps)
    
    const restoreCursor = () => {
      process.stdout.write('\x1b[?12h'); // Restore blinking
      process.stdout.write('\x1b[1 q');  // Default cursor
    };
    
    process.on('exit', restoreCursor);
    process.on('SIGINT', () => {
      restoreCursor();
      process.exit();
    });
    
    // Claude Code style welcome box  
    console.log('╭───────────────────────────────────────────────────╮');
    console.log('│ ✻ Welcome to Beacon!                              │');
    console.log('│                                                   │');
    console.log('│   /help for help, /status for your current setup  │');
    console.log('│                                                   │');
    console.log(`│   cwd: ${cwd.padEnd(42)} │`);
    console.log('╰───────────────────────────────────────────────────╯');
    console.log();
    
    if (hasYoctoProject) {
      console.log(' What\'s here:');
      console.log('  • Existing Yocto project detected - ready for recipes, builds, and debugging');
    } else {
      console.log(' What\'s new:');
      console.log('  • No Yocto project found - I can help you set up a new project or work with existing files');
    }

    console.log('Capabilities');
    console.log('Building with extended thinking');
    console.log();

    const context = [];
    
    while (true) {
      try {
        const { message } = await inquirer.prompt([
          {
            type: 'input',
            name: 'message',
            message: '>',
            validate: (input) => input.trim().length > 0 || 'Please enter a message'
          }
        ]);

        if (message.toLowerCase() === 'exit') {
          console.log(chalk.blue('👋 Happy building with Yocto!'));
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
          model: options.model || 'claude-sonnet-4-20250514',
          temperature: options.thinking !== false ? 1 : 0.1, // Must be 1 when thinking is enabled
          maxTokens: 16000,
          streaming: options.streaming !== false,
          extendedThinking: options.thinking !== false, // Default to true
          tools: [{
            type: 'text_editor_20250728',
            name: 'str_replace_based_edit_tool'
          }]
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