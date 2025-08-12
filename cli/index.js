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

  showHelp() {
    console.log(chalk.blue('🚀 Beacon - AI-powered Yocto Project Assistant'));
    console.log(chalk.gray('\nUsage:'));
    console.log('  beacon [message]                    # Send a message to Yocto AI');
    console.log('  beacon                              # Start interactive chat mode');
    console.log('  beacon demo-prompts                 # Demonstrate all prompt types');
    console.log('\nExamples:');
    console.log('  beacon "Create a Qt5 recipe"');
    console.log('  beacon "Help debug my build error"');
    console.log('  beacon "Set up WiFi drivers for i.MX8"');
    console.log('\nCommands:');
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
      console.log(' Status:');
      console.log('  • Yocto project detected - ask me anything about your setup!');
    } else {
      console.log(' Status:');
      console.log('  • No Yocto project found - I can help you get started');
    }

    console.log(' Ready to help with:');
    console.log('  • Yocto project setup and configuration');
    console.log('  • Recipe creation and debugging');
    console.log('  • Build issues and optimization');
    console.log('  • Layer management and BSP development');
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