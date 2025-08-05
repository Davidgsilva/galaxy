const Anthropic = require('@anthropic-ai/sdk');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

class AnthropicService {
  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }

    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Model configurations
    this.models = {
      'claude-sonnet-4-20250514': {
        name: 'claude-sonnet-4-20250514',
        maxTokens: 8192,
        contextWindow: 200000,
        costPer1kTokens: { input: 0.003, output: 0.015 }
      },
      'claude-opus-4-20250514': {
        name: 'claude-opus-4-20250514',
        maxTokens: 4096,
        contextWindow: 200000,
        costPer1kTokens: { input: 0.015, output: 0.075 }
      }
    };
  }

  /**
   * Create a message with the Anthropic API
   */
  async createMessage(requestData) {
    try {
      const startTime = Date.now();
      
      // Validate model
      if (!this.models[requestData.model]) {
        throw new Error(`Unsupported model: ${requestData.model}`);
      }

      // Ensure max_tokens doesn't exceed model limits
      const modelConfig = this.models[requestData.model];
      requestData.max_tokens = Math.min(
        requestData.max_tokens || modelConfig.maxTokens,
        modelConfig.maxTokens
      );

      logger.info('Creating Anthropic message', {
        model: requestData.model,
        maxTokens: requestData.max_tokens,
        temperature: requestData.temperature,
        messageCount: requestData.messages?.length || 0
      });

      const apiRequest = {
        model: requestData.model,
        max_tokens: requestData.max_tokens,
        temperature: requestData.temperature || 0.1,
        system: requestData.system,
        messages: requestData.messages
      };

      // Add tools if provided
      if (requestData.tools && requestData.tools.length > 0) {
        apiRequest.tools = requestData.tools;
      }

      // Add thinking configuration if provided
      if (requestData.thinking) {
        apiRequest.thinking = requestData.thinking;
      }

      const response = await this.client.messages.create(apiRequest);

      const duration = Date.now() - startTime;
      
      logger.info('Anthropic response received', {
        model: response.model,
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
        duration: `${duration}ms`
      });

      return response;

    } catch (error) {
      logger.error('Anthropic API error:', {
        error: error.message,
        status: error.status,
        type: error.type
      });

      // Handle specific Anthropic errors
      if (error.status === 400) {
        throw new Error(`Invalid request: ${error.message}`);
      } else if (error.status === 401) {
        throw new Error('Invalid API key');
      } else if (error.status === 403) {
        throw new Error('Insufficient permissions');
      } else if (error.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      } else if (error.status >= 500) {
        throw new Error('Anthropic service temporarily unavailable');
      }

      throw error;
    }
  }

  /**
   * Create a streaming message with the Anthropic API
   */
  async createStreamingMessage(requestData) {
    try {
      const startTime = Date.now();
      
      logger.info('Creating streaming Anthropic message', {
        model: requestData.model,
        maxTokens: requestData.max_tokens,
        temperature: requestData.temperature,
        messageCount: requestData.messages?.length || 0
      });

      const apiRequest = {
        ...requestData,
        stream: true
      };

      const stream = await this.client.messages.create(apiRequest);

      // Create a custom event emitter to handle streaming
      const EventEmitter = require('events');
      const streamEmitter = new EventEmitter();

      let fullText = '';
      let fullThinking = '';
      let inputTokens = 0;
      let outputTokens = 0;

      (async () => {
        try {
          for await (const chunk of stream) {
            if (chunk.type === 'message_start') {
              inputTokens = chunk.message.usage?.input_tokens || 0;
            } else if (chunk.type === 'content_block_start') {
              // Handle different content block types
              if (chunk.content_block?.type === 'thinking') {
                // Thinking block started
              } else if (chunk.content_block?.type === 'text') {
                // Text block started
              }
            } else if (chunk.type === 'content_block_delta') {
              if (chunk.delta?.type === 'thinking_delta') {
                const thinking = chunk.delta?.thinking || '';
                fullThinking += thinking;
                streamEmitter.emit('thinking', thinking);
              } else if (chunk.delta?.type === 'text_delta') {
                const text = chunk.delta?.text || '';
                fullText += text;
                streamEmitter.emit('text', text);
              }
            } else if (chunk.type === 'message_delta') {
              outputTokens = chunk.usage?.output_tokens || 0;
            } else if (chunk.type === 'message_stop') {
              const duration = Date.now() - startTime;
              
              logger.info('Streaming response completed', {
                model: requestData.model,
                inputTokens,
                outputTokens,
                duration: `${duration}ms`,
                textLength: fullText.length,
                thinkingLength: fullThinking.length
              });

              streamEmitter.emit('end', {
                fullText,
                fullThinking,
                usage: { input_tokens: inputTokens, output_tokens: outputTokens },
                duration
              });
            }
          }
        } catch (error) {
          logger.error('Streaming error:', error);
          streamEmitter.emit('error', error);
        }
      })();

      return streamEmitter;

    } catch (error) {
      logger.error('Anthropic streaming error:', error);
      throw error;
    }
  }

  /**
   * Get model information
   */
  getModelInfo(modelName) {
    return this.models[modelName] || null;
  }

  /**
   * Get available models
   */
  getAvailableModels() {
    return Object.keys(this.models);
  }

  /**
   * Calculate estimated cost for a request
   */
  calculateEstimatedCost(modelName, inputTokens, outputTokens = 0) {
    const model = this.models[modelName];
    if (!model) return null;

    const inputCost = (inputTokens / 1000) * model.costPer1kTokens.input;
    const outputCost = (outputTokens / 1000) * model.costPer1kTokens.output;
    
    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: 'USD'
    };
  }
}

module.exports = new AnthropicService();