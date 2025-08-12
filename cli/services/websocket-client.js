const WebSocketClient = require('websocket').client;
const chalk = require('chalk');
const LocalFileService = require('./local-file-service');

class WebSocketFileClient {
  constructor(serverUrl, sessionId) {
    this.serverUrl = serverUrl.replace('http', 'ws'); // Convert HTTP to WS URL
    this.sessionId = sessionId;
    this.clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.client = new WebSocketClient();
    this.connection = null;
    this.localFileService = new LocalFileService();
    this.isConnected = false;
    this.isRegistered = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Start with 1 second

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.on('connectFailed', (error) => {
      console.log(chalk.red('❌ WebSocket connection failed:', error.toString()));
      this.scheduleReconnect();
    });

    this.client.on('connect', (connection) => {
      this.connection = connection;
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;

      console.log(chalk.green('🔗 WebSocket connected successfully'));

      connection.on('error', (error) => {
        console.log(chalk.red('🔗 WebSocket connection error:', error.toString()));
      });

      connection.on('close', () => {
        console.log(chalk.yellow('🔗 WebSocket connection closed'));
        this.isConnected = false;
        this.isRegistered = false;
        this.scheduleReconnect();
      });

      connection.on('message', (message) => {
        this.handleMessage(message);
      });

      // Register immediately after connection
      this.register();
    });
  }

  async connect() {
    try {
      console.log(chalk.blue('🔗 Connecting to WebSocket server...'));
      this.client.connect(`${this.serverUrl}`, 'file-operations');
    } catch (error) {
      console.log(chalk.red('❌ Failed to initiate WebSocket connection:', error.message));
      this.scheduleReconnect();
    }
  }

  register() {
    if (!this.connection || !this.isConnected) {
      console.log(chalk.red('❌ Cannot register: WebSocket not connected'));
      return;
    }

    const message = {
      type: 'register',
      sessionId: this.sessionId,
      clientId: this.clientId,
      timestamp: new Date().toISOString()
    };

    this.connection.sendUTF(JSON.stringify(message));
    console.log(chalk.blue('📝 Registering WebSocket client for file operations...'));
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(chalk.red('❌ Max reconnection attempts reached. Manual restart required.'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    console.log(chalk.yellow(`🔄 Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`));

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  handleMessage(message) {
    try {
      if (message.type === 'utf8') {
        const data = JSON.parse(message.utf8Data);

        switch (data.type) {
          case 'registration_success':
            this.handleRegistrationSuccess(data);
            break;
          case 'registration_error':
            this.handleRegistrationError(data);
            break;
          case 'file_operation':
            this.handleFileOperation(data);
            break;
          case 'ping':
            this.handlePing();
            break;
          case 'heartbeat_ack':
            // Heartbeat acknowledged
            break;
          default:
            console.log(chalk.yellow('🔗 Unknown WebSocket message type:', data.type));
        }
      }
    } catch (error) {
      console.log(chalk.red('❌ Error handling WebSocket message:', error.message));
    }
  }

  handleRegistrationSuccess(data) {
    this.isRegistered = true;
    console.log(chalk.green('✅ WebSocket client registered for file operations'));
  }

  handleRegistrationError(data) {
    console.log(chalk.red('❌ WebSocket registration failed:', data.message));
  }

  handlePing() {
    // Respond to server ping
    if (this.connection && this.isConnected) {
      this.connection.sendUTF(JSON.stringify({
        type: 'heartbeat'
      }));
    }
  }

  async handleFileOperation(data) {
    const { operationId, operation, params } = data;

    try {
      console.log(chalk.blue(`📁 Executing file operation: ${operation}`));

      let result;
      switch (operation) {
        case 'exec':
          result = await this.handleBashExecuteOperation(params);
          break;
        case 'view':
          result = await this.handleViewOperation(params);
          break;
        case 'create':
          result = await this.handleCreateOperation(params);
          break;
        case 'str_replace':
          result = await this.handleStringReplaceOperation(params);
          break;
        case 'insert':
          result = await this.handleInsertOperation(params);
          break;
        case 'delete':
          result = await this.handleDeleteOperation(params);
          break;
        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }

      // Send success result back to server
      this.connection.sendUTF(JSON.stringify({
        type: 'operation_result',
        operationId,
        result,
        timestamp: new Date().toISOString()
      }));

      console.log(chalk.green(`✅ File operation ${operation} completed successfully`));

    } catch (error) {
      console.log(chalk.red(`❌ File operation ${operation} failed:`, error.message));

      // Send error result back to server
      this.connection.sendUTF(JSON.stringify({
        type: 'operation_error',
        operationId,
        error: {
          message: error.message,
          stack: error.stack
        },
        timestamp: new Date().toISOString()
      }));
    }
  }

  async handleViewOperation(params) {
    const { path } = params || {};
    if (typeof path !== 'string' || path.trim() === '') {
      throw new Error('view: missing required string \'path\'');
    }

    const fs = require('fs').promises;
    const resolvedPath = this.localFileService.resolvePath(path);

    try {
      const stats = await fs.stat(resolvedPath);

      if (stats.isDirectory()) {
        // Handle directory listing
        const result = await this.localFileService.listDirectory(path);
        if (result.success) {
          const itemsList = result.items.map(item =>
            `${item.type === 'directory' ? 'd' : '-'} ${item.name}`
          ).join('\n');

          return {
            success: true,
            type: 'directory',
            path,
            content: `Directory: ${path}\nTotal items: ${result.totalItems}\n\n${itemsList}`,
            totalItems: result.totalItems,
            items: result.items
          };
        } else {
          throw new Error('Failed to list directory');
        }
      } else {
        // Handle file reading
        const result = await this.localFileService.readFile(path);
        if (result.success && result.files?.[0]) {
          const file = result.files[0];
          return {
            success: true,
            type: 'file',
            path,
            content: file.content,
            lines: file.content.split('\n').length,
            size: file.size
          };
        } else {
          throw new Error('Failed to read file');
        }
      }
    } catch (error) {
      throw new Error(`Failed to access path: ${error.message}`);
    }
  }

  async handleCreateOperation(params) {
    const { path, file_text } = params;
    await this.localFileService.createFile(path, file_text);

    return {
      success: true,
      message: 'File created successfully',
      path,
      size: file_text?.length || 0
    };
  }

  async handleStringReplaceOperation(params) {
    const { path, old_str, new_str } = params;
    const result = await this.localFileService.stringReplace(path, old_str, new_str);

    return {
      success: true,
      message: 'Text replaced successfully',
      path,
      changes: result
    };
  }

  async handleInsertOperation(params) {
    const { path, new_str, insert_line } = params;
    const result = await this.localFileService.insertAtLine(path, new_str, insert_line);

    return {
      success: true,
      message: 'Text inserted successfully',
      path,
      changes: result
    };
  }

  async handleDeleteOperation(params) {
    const { path, confirm } = params;

    if (!confirm) {
      throw new Error('Delete operation requires explicit confirmation');
    }

    await this.localFileService.deleteFile(path);

    return {
      success: true,
      message: 'File deleted successfully',
      path
    };
  }

  async handleBashExecuteOperation(params) {
    const { command, cwd } = params;
    const { spawn } = require('child_process');
    const { confirm } = require('@inquirer/prompts');
    const path = require('path');

    if (!command || typeof command !== 'string') {
      throw new Error('Command parameter is required and must be a string');
    }

    // Show command to user and ask for confirmation
    console.log(chalk.yellow('\n🔧 Beacon wants to execute the following command:'));
    console.log(chalk.cyan(`   ${command}`));
    
    if (cwd && cwd !== '.') {
      const resolvedCwd = path.resolve(cwd);
      console.log(chalk.gray(`   Working directory: ${resolvedCwd}`));
    }
    
    console.log(chalk.gray('   This command will be executed on your local system.'));
    
    try {
      const shouldExecute = await confirm({
        message: 'Do you want to execute this command?',
        default: false
      });

      if (!shouldExecute) {
        return {
          success: false,
          command: command,
          output: '',
          error: 'Command execution cancelled by user',
          exitCode: 1,
          cancelled: true
        };
      }
    } catch (error) {
      // Handle Ctrl+C or prompt cancellation
      return {
        success: false,
        command: command,
        output: '',
        error: 'Command execution cancelled by user',
        exitCode: 1,
        cancelled: true
      };
    }

    console.log(chalk.green('✅ Executing command...'));

    return new Promise((resolve, reject) => {
      const workingDir = cwd ? path.resolve(cwd) : process.cwd();
      
      const child = spawn('bash', ['-c', command], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workingDir
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        // Show real-time output to user
        process.stdout.write(chalk.gray(output));
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        // Show real-time errors to user
        process.stderr.write(chalk.red(output));
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log(chalk.green(`\n✅ Command completed successfully (exit code: ${code})`));
          resolve({
            success: true,
            command: command,
            output: stdout,
            exitCode: code,
            workingDirectory: workingDir
          });
        } else {
          console.log(chalk.red(`\n❌ Command failed with exit code: ${code}`));
          resolve({
            success: false,
            command: command,
            output: stdout,
            error: stderr,
            exitCode: code,
            workingDirectory: workingDir
          });
        }
      });

      child.on('error', (error) => {
        console.log(chalk.red(`\n❌ Failed to execute command: ${error.message}`));
        reject(new Error(`Failed to execute command: ${error.message}`));
      });
    });
  }

  disconnect() {
    if (this.connection && this.isConnected) {
      console.log(chalk.yellow('🔗 Disconnecting WebSocket...'));
      this.connection.close();
    }
  }

  getStatus() {
    return {
      connected: this.isConnected,
      registered: this.isRegistered,
      sessionId: this.sessionId,
      clientId: this.clientId
    };
  }
}

module.exports = WebSocketFileClient;