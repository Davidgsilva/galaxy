const axios = require('axios');
const chalk = require('chalk');

class ApiClient {
  constructor() {
    this.proxyUrl = process.env.BEACON_PROXY_URL || 'http://localhost:3001';
    this.timeout = 60000; // 60 seconds
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 second
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
          console.log(chalk.yellow(`⚠️  Request failed, retrying in ${this.retryDelay}ms (attempt ${attempt}/${this.retryAttempts})`));
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
          'Accept': 'text/event-stream'
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
}

module.exports = ApiClient;