#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');

const packageInfo = require('../package.json');
const ApiClient = require('./services/api-client');
const { createShell } = require('./ui/blessedShell');


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
      console.log(chalk.yellow('\n💡 Ask the AI to help you:'));
      console.log('  • "Help me set up a new Yocto project"');
      console.log('  • "Look for Yocto files in subdirectories"');
      console.log('  • "Create a minimal Yocto environment"');
    }
    console.log();
  }

  async getProjectStatusText() {
    const projectContext = await this.getProjectContext();
    
    let status = `{blue-fg}📊 Project Status{/blue-fg}\n${'─'.repeat(50)}\n`;
    status += `Working Directory: {yellow-fg}${projectContext.workingDirectory}{/yellow-fg}\n`;
    status += `Yocto Project: ${projectContext.hasYoctoProject ? '{green-fg}✓ Detected{/green-fg}' : '{red-fg}✗ Not found{/red-fg}'}\n`;
    
    if (projectContext.projectFiles.length > 0) {
      status += `\nRelevant Files (${projectContext.projectFiles.length}):\n`;
      projectContext.projectFiles.slice(0, 10).forEach(file => {
        status += `  • {cyan-fg}${file}{/cyan-fg}\n`;
      });
      if (projectContext.projectFiles.length > 10) {
        status += `  ... and ${projectContext.projectFiles.length - 10} more\n`;
      }
    }
    
    if (!projectContext.hasYoctoProject) {
      status += `\n{yellow-fg}💡 Ask the AI to help you:{/yellow-fg}\n`;
      status += '  • "Help me set up a new Yocto project"\n';
      status += '  • "Look for Yocto files in subdirectories"\n';
      status += '  • "Create a minimal Yocto environment"\n';
    }
    
    return status;
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
    console.log('\nCommands:');
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

  getHelpText() {
    return `{blue-fg}🚀 Beacon - AI-powered Yocto Project Assistant{/blue-fg}

{gray-fg}Usage:{/gray-fg}
  beacon [message]                    # Send a message to Yocto AI
  beacon                              # Start interactive chat mode

{gray-fg}Examples:{/gray-fg}
  beacon "Create a Qt5 recipe"
  beacon "Help debug my build error"
  beacon "Set up WiFi drivers for i.MX8"

{gray-fg}Commands:{/gray-fg}
  help                                # Show this help

{gray-fg}Interactive Commands:{/gray-fg}
  /help or help                       # Show this help
  /status or status                   # Show project status
  exit                                # Exit interactive mode

{gray-fg}Options:{/gray-fg}
  -s, --streaming                     # Enable streaming responses (default: true)
  -t, --thinking                      # Enable extended thinking mode (default: true)
  -m, --model <model>                 # AI model (e.g. claude-sonnet-4-20250514, gpt-5)
  --temperature <temp>                # Temperature for AI responses
  --proxy-url <url>                   # Proxy server URL
  -v, --verbose                       # Enable verbose logging

{gray-fg}💡 Beacon specializes in:{/gray-fg}
  🔧 Machine configurations and BSP development
  📝 Recipe creation and BitBake syntax
  🏗️  Build optimization and debugging
  🔒 Security hardening and license compliance
  💾 Silicon-specific platform guidance
  🐛 Error diagnosis and troubleshooting
  📚 Layer management and dependencies
  ⚙️  Device tree and kernel configuration`;
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

    await this.startInteractiveMode(options);
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



















  async startInteractiveMode(options) {
    const cwd = process.cwd();
    const hasYoctoProject = await this.detectYoctoProject(cwd);
    
    // Build welcome message
    const welcomeBox = `{cyan-fg}╭───────────────────────────────────────────────────╮{/cyan-fg}
{cyan-fg}│ ✻ Welcome to Beacon!                              │{/cyan-fg}
{cyan-fg}│                                                   │{/cyan-fg}
{cyan-fg}│   /help for help, /status for your current setup  │{/cyan-fg}
{cyan-fg}│                                                   │{/cyan-fg}
{cyan-fg}│   cwd: ${cwd.substring(0, 42).padEnd(42)} │{/cyan-fg}
{cyan-fg}╰───────────────────────────────────────────────────╯{/cyan-fg}`;

    let statusMessage = '';
    if (hasYoctoProject) {
      statusMessage = ' Status:\n  • Yocto project detected - ask me anything about your setup!';
    } else {
      statusMessage = ' Status:\n  • No Yocto project found - I can help you get started';
    }

    const readyMessage = ' Ready to help with:\n  • Yocto project setup and configuration\n  • Recipe creation and debugging\n  • Build issues and optimization\n  • Layer management and BSP development';
    
    const activeModel = (options && options.model) || process.env.DEFAULT_MODEL || 'gpt-4o-mini';
    const modelMessage = `{grey-fg}Model: ${activeModel}  (override with -m <model> or DEFAULT_MODEL env){/grey-fg}`;
    
    const fullWelcome = `${welcomeBox}\n\n${statusMessage}\n\n${readyMessage}\n\n${modelMessage}\n`;
    
    const context = [];
    
    // Ctrl+C tracking for double-press exit
    let lastCtrlC = 0;
    const CTRL_C_WINDOW = 2000; // 2 seconds
    
    // Create shell
    const shell = createShell({
      welcome: fullWelcome,
      placeholder: '> Try "write a test for index.js"',
      onSubmit: async (message) => {
        try {
          // Show user message
          shell.user(message);
          
          // Handle special commands
          if (message.toLowerCase() === 'exit') {
            shell.destroy();
            console.log('\n👋 Happy building with Yocto!');
            process.exit(0);
            return;
          }
          
          // Handle slash commands
          if (message.startsWith('/')) {
            await this.handleSlashCommand(message, shell, options);
            return;
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
            temperature: options.thinking === true ? 1 : 0.1,
            maxTokens: 16000,
            streaming: options.streaming !== false,
            extendedThinking: options.thinking === true,
            tools: []
          };
          
          if (requestData.streaming) {
            const response = await this.handleStreamingResponseShell(requestData, shell);
            if (response.response) {
              context.push({ role: 'assistant', content: response.response });
            }
          } else {
            const response = await this.apiClient.chat(requestData);
            shell.assistant();
            shell.write(response.response);
            
            context.push({ role: 'assistant', content: response.response });
            
            if (response.usage && options.verbose) {
              shell.info(`📊 ${response.usage.input_tokens} in, ${response.usage.output_tokens} out tokens`);
            }
          }
          
        } catch (error) {
          shell.error(error.message);
        }
      }
    });
    
    // Handle Ctrl+C double-press
    shell.screen.on('beacon-exit', () => {
      const now = Date.now();
      if (now - lastCtrlC < CTRL_C_WINDOW) {
        // Second press - exit
        shell.destroy();
        console.log('\n👋 Happy building with Yocto!');
        process.exit(130);
      } else {
        // First press - show hint
        lastCtrlC = now;
        shell.info('Press CTRL-C again to exit');
      }
    });
    
    // Handle process signals
    const cleanup = () => {
      shell.destroy();
      this.apiClient.disconnect();
    };
    
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    
    // Keep the process alive
    return new Promise(() => {});
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

  async handleSlashCommand(message, shell, options) {
    const [command, ...args] = message.slice(1).split(' ');
    
    switch (command.toLowerCase()) {
      case 'help':
        shell.write(this.getHelpText());
        break;
        
      case 'status':
        const statusText = await this.getProjectStatusText();
        shell.write(statusText);
        break;
        
      case 'model':
        if (args.length > 0) {
          const newModel = args.join(' ');
          options.model = newModel;
          shell.success(`Model changed to: ${newModel}`);
        } else {
          const currentModel = options.model || process.env.DEFAULT_MODEL || 'gpt-4o-mini';
          shell.info(`Current model: ${currentModel}`);
        }
        break;
        
      case 'temperature':
        if (args.length > 0) {
          const temp = parseFloat(args[0]);
          if (isNaN(temp) || temp < 0 || temp > 2) {
            shell.error('Temperature must be a number between 0 and 2');
          } else {
            options.temperature = temp;
            shell.success(`Temperature set to: ${temp}`);
          }
        } else {
          shell.info(`Current temperature: ${options.temperature || 0.1}`);
        }
        break;
        
      case 'thinking':
        options.thinking = !options.thinking;
        shell.success(`Extended thinking ${options.thinking ? 'enabled' : 'disabled'}`);
        break;
        
      case 'streaming':
        options.streaming = !options.streaming;
        shell.success(`Streaming ${options.streaming ? 'enabled' : 'disabled'}`);
        break;
        
      case 'clear':
        shell.clear();
        break;
        
      default:
        shell.info(`Available slash commands:
  /help - Show help information
  /status - Show project status
  /model [name] - Get or set AI model
  /temperature [0-2] - Get or set temperature
  /thinking - Toggle extended thinking mode
  /streaming - Toggle streaming responses  
  /clear - Clear output
  exit - Exit interactive mode`);
    }
  }

  async handleStreamingResponseShell(requestData, shell) {
    try {
      shell.assistant(); // Start with assistant header
      
      // Custom streaming handler for shell
      let fullResponse = '';
      
      const response = await this.apiClient.chatStream(requestData, (chunk) => {
        fullResponse += chunk;
        shell.writeRaw(chunk);
      });
      
      // Add final newline
      shell.writeRaw('\n\n');
      
      if (response.usage && requestData.verbose) {
        shell.info(`📊 Usage: ${response.usage.input_tokens} input, ${response.usage.output_tokens} output tokens`);
      }
      
      return { ...response, response: fullResponse };
    } catch (error) {
      shell.error(`Streaming error: ${error.message}`);
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