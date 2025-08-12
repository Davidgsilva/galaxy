const axios = require('axios');
const chalk = require('chalk');
const LocalFileService = require('./local-file-service');
const WebSocketFileClient = require('./websocket-client');

class ApiClient {
  constructor() {
    this.proxyUrl = process.env.BEACON_PROXY_URL || 'http://localhost:3001';
    this.timeout = 60000; // 60 seconds
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 second
    this.localFileService = new LocalFileService();
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.wsClient = null;
  }

  setProxyUrl(url) {
    this.proxyUrl = url;
  }


  async makeRequest(endpoint, data, options = {}) {
    const config = {
      method: options.method || 'POST',
      url: `${this.proxyUrl}${endpoint}`,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': this.sessionId,
        ...options.headers
      },
      ...options
    };

    if (data && (config.method === 'POST' || config.method === 'PUT')) {
      config.data = data;
    }

    let lastError;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await axios(config);
        return response.data;
      } catch (error) {
        lastError = error;
        
        // Don't retry on client errors (4xx)
        if (error.response && error.response.status >= 400 && error.response.status < 500) {
          break;
        }

        if (attempt < this.retryAttempts) {
          // console.log(chalk.yellow(`⚠️  Request failed, retrying in ${this.retryDelay}ms (attempt ${attempt}/${this.retryAttempts})`));
          await this.sleep(this.retryDelay);
          this.retryDelay *= 2; // Exponential backoff
        }
      }
    }

    // Handle different error types
    if (lastError.code === 'ECONNREFUSED') {
      throw new Error('Cannot connect to proxy server. Make sure it\'s running on ' + this.proxyUrl);
    } else if (lastError.code === 'ETIMEDOUT') {
      throw new Error('Request timed out. The operation may have been too complex.');
    } else if (lastError.response) {
      const errorData = lastError.response.data;
      throw new Error(errorData.message || errorData.error || 'Request failed');
    } else {
      throw new Error(lastError.message || 'Unknown network error');
    }
  }

  async chat(requestData) {
    try {
      return await this.makeRequest('/api/chat', requestData);
    } catch (error) {
      throw new Error(`Chat request failed: ${error.message}`);
    }
  }

  async chatStream(requestData, customCallback = null) {
    try {
      return new Promise((resolve, reject) => {
        let fullResponse = '';
        let fullThinking = '';
        let usage = null;
        let isThinking = false;
        
        this.streamingChat(
          { ...requestData, streaming: true },
          (data) => {
            if (data.type === 'thinking') {
              if (!isThinking) {
                if (!customCallback) {
                  // console.log('\n✻ Thinking…');
                  // console.log();
                }
                isThinking = true;
              }
              if (customCallback) {
                // Don't show thinking in UI for now, but could be added later
                fullThinking += data.content;
              } else {
                process.stdout.write(chalk.gray(data.content));
                fullThinking += data.content;
              }
            } else if (data.type === 'text') {
              if (isThinking) {
                if (!customCallback) {
                  // console.log('\n');
                }
                isThinking = false;
              }
              
              if (customCallback) {
                customCallback(data.content);
              } else {
                process.stdout.write(data.content);
              }
              fullResponse += data.content;
            } else if (data.type === 'end') {
              usage = data.usage;
            }
          },
          () => {
            resolve({ response: fullResponse, thinking: fullThinking, usage });
          },
          (error) => {
            reject(new Error(`Streaming chat failed: ${error.message}`));
          }
        );
      });
    } catch (error) {
      throw new Error(`Chat stream failed: ${error.message}`);
    }
  }

  async createFile(filePath, content, prompt) {
    try {
      return await this.makeRequest('/api/files/create', {
        filePath,
        content,
        prompt,
        operation: 'create'
      });
    } catch (error) {
      throw new Error(`File creation failed: ${error.message}`);
    }
  }

  async readFile(filePath, analyze = null) {
    try {
      return await this.makeRequest('/api/files/read', {
        filePath,
        operation: 'read',
        analyze
      }, { method: 'GET' });
    } catch (error) {
      throw new Error(`File read failed: ${error.message}`);
    }
  }

  async updateFile(filePath, instruction, content = null) {
    try {
      return await this.makeRequest('/api/files/update', {
        filePath,
        instruction,
        content,
        operation: 'update'
      });
    } catch (error) {
      throw new Error(`File update failed: ${error.message}`);
    }
  }

  async deleteFile(filePath) {
    try {
      return await this.makeRequest('/api/files/delete', {
        filePath,
        operation: 'delete'
      });
    } catch (error) {
      throw new Error(`File deletion failed: ${error.message}`);
    }
  }

  async batch(operations) {
    try {
      return await this.makeRequest('/api/batch', {
        operations
      });
    } catch (error) {
      throw new Error(`Batch operation failed: ${error.message}`);
    }
  }

  async getCacheStatus() {
    try {
      return await this.makeRequest('/api/cache/status', null, { method: 'GET' });
    } catch (error) {
      throw new Error(`Cache status request failed: ${error.message}`);
    }
  }

  async clearCache() {
    try {
      return await this.makeRequest('/api/cache/clear', null, { method: 'POST' });
    } catch (error) {
      throw new Error(`Cache clear request failed: ${error.message}`);
    }
  }

  async searchWeb(query, options = {}) {
    try {
      return await this.makeRequest('/api/web-search', {
        query,
        ...options
      });
    } catch (error) {
      throw new Error(`Web search failed: ${error.message}`);
    }
  }

  async executeComputerAction(action, params = {}) {
    try {
      return await this.makeRequest('/api/computer', {
        action,
        ...params
      });
    } catch (error) {
      throw new Error(`Computer action failed: ${error.message}`);
    }
  }

  async getHealth() {
    try {
      return await this.makeRequest('/health', null, { method: 'GET' });
    } catch (error) {
      throw new Error(`Health check failed: ${error.message}`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Streaming helper methods
  async createStreamingRequest(endpoint, data, onData, onEnd, onError) {
    try {
      const response = await axios({
        method: 'POST',
        url: `${this.proxyUrl}${endpoint}`,
        data,
        responseType: 'stream',
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'x-session-id': this.sessionId
        }
      });

      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        lines.forEach(line => {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              onData(data);
            } catch (e) {
              // Ignore malformed JSON chunks
            }
          }
        });
      });

      response.data.on('end', onEnd);
      response.data.on('error', onError);

      return response.data;

    } catch (error) {
      onError(error);
    }
  }

  async streamRequest(endpoint, data) {
    const events = [];
    return new Promise((resolve, reject) => {
      this.createStreamingRequest(
        endpoint,
        data,
        (evt) => {
          try {
            events.push(evt);
          } catch (_) {
            // ignore push errors
          }
        },
        () => resolve({ success: true, events }),
        (err) => reject(err)
      );
    });
  }

  async streamingChat(requestData, onData, onEnd, onError) {
    return this.createStreamingRequest('/api/chat', requestData, onData, onEnd, onError);
  }

  // Tool integration helpers
  buildToolsForRequest(options = {}) {
    const tools = [];

    // Always include text editor for file operations
    tools.push({
      type: 'text_editor_20250728',
      name: 'str_replace_based_edit_tool'
    });

    if (options.webSearch) {
      tools.push({
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: options.webSearchLimit || 5,
        ...(options.allowedDomains && { allowed_domains: options.allowedDomains }),
        ...(options.blockedDomains && { blocked_domains: options.blockedDomains }),
        ...(options.userLocation && { user_location: options.userLocation })
      });
    }

    if (options.computerUse) {
      tools.push({
        type: 'computer_20250124',
        name: 'computer',
        display_width_px: options.displayWidth || 1024,
        display_height_px: options.displayHeight || 768,
        display_number: options.displayNumber || 1
      });
    }

    return tools;
  }

  // Advanced request building
  buildChatRequest(message, options = {}) {
    const request = {
      message,
      model: options.model || 'claude-sonnet-4-20250514',
      temperature: options.temperature || 0.1,
      maxTokens: options.maxTokens || 4096,
      streaming: options.streaming || false,
      extendedThinking: options.extendedThinking || false,
      useCache: options.useCache !== false, // Default to true
      context: options.context || [],
      tools: this.buildToolsForRequest(options)
    };

    // Add thinking configuration if extended thinking is enabled
    if (options.extendedThinking && options.thinkingBudget) {
      request.thinking = {
        type: 'enabled',
        budget_tokens: options.thinkingBudget
      };
    }

    return request;
  }

  // Utility methods for handling responses
  extractToolResults(response) {
    if (!response.content || !Array.isArray(response.content)) {
      return [];
    }

    return response.content
      .filter(block => block.type === 'tool_use')
      .map(block => ({
        id: block.id,
        name: block.name,
        input: block.input
      }));
  }

  extractCitations(response) {
    if (!response.content || !Array.isArray(response.content)) {
      return [];
    }

    const citations = [];
    response.content.forEach(block => {
      if (block.type === 'text' && block.citations) {
        citations.push(...block.citations);
      }
    });

    return citations;
  }

  formatUsageStats(usage) {
    const stats = {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
    };

    if (usage.server_tool_use) {
      stats.webSearchRequests = usage.server_tool_use.web_search_requests || 0;
    }

    return stats;
  }


  // File operation delegation handler (used by server)
  async handleTextEditorOperation(operation, args) {
    try {
      // console.log(chalk.yellow(`🔧 Executing file operation: ${operation} on ${args.path || 'unknown'}`));

      switch (operation) {
        case 'view':
          return await this.handleView(args.path);
        
        case 'str_replace':
          return await this.handleStrReplace(args.path, args.old_str, args.new_str);
        
        case 'create':
          return await this.handleCreate(args.path, args.file_text || '');
        
        case 'insert':
          return await this.handleInsert(args.path, args.new_str, args.insert_line);
        
        default:
          throw new Error(`Unknown text editor operation: ${operation}`);
      }
    } catch (error) {
      // console.log(chalk.red(`❌ File operation failed: ${error.message}`));
      throw error;
    }
  }

  async handleView(filePath) {
    const result = await this.localFileService.readFile(filePath);
    
    if (result.success && result.files?.[0]) {
      const file = result.files[0];
      return `File: ${filePath}\nLines: ${file.content.split('\n').length}\nSize: ${file.size} bytes\n\nContent:\n${file.content}`;
    } else {
      // Try as directory
      const dirResult = await this.localFileService.listDirectory(filePath);
      if (dirResult.success) {
        const itemsText = dirResult.items.map(item => `${item.type === 'directory' ? '📁' : '📄'} ${item.name}`).join('\n');
        return `Directory: ${filePath}\nItems: ${dirResult.totalItems}\n\nContents:\n${itemsText}`;
      }
    }
    
    throw new Error('File or directory not found');
  }

  async handleStrReplace(filePath, oldStr, newStr) {
    // Read current content
    const readResult = await this.localFileService.readFile(filePath);
    if (!readResult.success) {
      throw new Error('File not found');
    }

    const currentContent = readResult.files[0].content;
    
    // Check if old string exists
    if (!currentContent.includes(oldStr)) {
      throw new Error('String not found in file');
    }

    // Check for multiple occurrences
    const occurrences = (currentContent.match(new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (occurrences > 1) {
      throw new Error(`String appears ${occurrences} times in file. Please be more specific.`);
    }

    // Replace content
    const newContent = currentContent.replace(oldStr, newStr);
    const updateResult = await this.localFileService.updateFile(filePath, newContent);

    if (updateResult.success) {
      const linesChanged = newContent.split('\n').length - currentContent.split('\n').length;
      return `Text replaced successfully in ${filePath}.\nLines changed: ${linesChanged}\nCharacters changed: ${newContent.length - currentContent.length}`;
    } else {
      throw new Error('Failed to update file');
    }
  }

  async handleCreate(filePath, fileText) {
    const result = await this.localFileService.createFile(filePath, fileText);
    
    if (result.success) {
      return `File created successfully: ${filePath}\nSize: ${fileText.length} bytes\nLines: ${fileText.split('\n').length}`;
    } else {
      throw new Error('Failed to create file');
    }
  }

  async handleInsert(filePath, newStr, insertLine) {
    // Read current content
    const readResult = await this.localFileService.readFile(filePath);
    if (!readResult.success) {
      throw new Error('File not found');
    }

    const currentContent = readResult.files[0].content;
    const lines = currentContent.split('\n');

    // Validate insert line
    if (insertLine < 0 || insertLine > lines.length) {
      throw new Error(`Invalid line number: ${insertLine}. File has ${lines.length} lines.`);
    }

    // Insert new content
    lines.splice(insertLine, 0, newStr);
    const newContent = lines.join('\n');

    const updateResult = await this.localFileService.updateFile(filePath, newContent);

    if (updateResult.success) {
      return `Content inserted successfully at line ${insertLine} in ${filePath}.\nNew total lines: ${lines.length}`;
    } else {
      throw new Error('Failed to update file');
    }
  }


  // Yocto project generation with streaming support
  async generateYoctoProject(data) {
    try {
      const { projectName, description, streaming = true } = data;
      
      if (streaming) {
        return await this.streamRequest('/api/chat/yocto/generate-project', {
          projectName,
          description,
          streaming: true
        });
      } else {
        const response = await this.makeRequest('/api/chat/yocto/generate-project', {
          projectName,
          description,
          streaming: false
        });
        return response;
      }
    } catch (error) {
      throw new Error(`Yocto project generation failed: ${error.message}`);
    }
  }

  // Register this client with the server for file operations via WebSocket
  async registerForFileOperations() {
    try {
      // console.log(chalk.blue('🔗 Initializing WebSocket connection for file operations...'));
      
      this.wsClient = new WebSocketFileClient(this.proxyUrl, this.sessionId);
      await this.wsClient.connect();
      
      // Wait a moment for connection and registration
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const status = this.wsClient.getStatus();
      if (status.connected && status.registered) {
        // console.log(chalk.green('✅ WebSocket file operations client ready'));
        return true;
      } else {
        // console.log(chalk.red('❌ WebSocket registration failed'));
        return false;
      }
    } catch (error) {
      // console.log(chalk.red('❌ WebSocket setup failed:', error.message));
      return false;
    }
  }

  // Cleanup WebSocket connection
  disconnect() {
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
    }
  }
}

module.exports = ApiClient;