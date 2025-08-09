const OpenAI = require('openai');
const winston = require('winston');
const EventEmitter = require('events');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

class OpenAIService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Model configurations
    this.models = {
      'gpt-5': {
        name: 'gpt-5',
        maxTokens: 16384,
        contextWindow: 256000,
        costPer1kTokens: { input: 1.25, output: 10.0 }
      },
      'gpt-5-mini': {
        name: 'gpt-5-mini',
        maxTokens: 16384,
        contextWindow: 256000,
        costPer1kTokens: { input: 0.25, output: 2.0 }
      },
      'gpt-5-nano': {
        name: 'gpt-5-nano',
        maxTokens: 8192,
        contextWindow: 128000,
        costPer1kTokens: { input: 0.05, output: 0.40 }
      },
      'gpt-4o': {
        name: 'gpt-4o',
        maxTokens: 4096,
        contextWindow: 128000,
        costPer1kTokens: { input: 0.0025, output: 0.01 }
      },
      'gpt-4o-mini': {
        name: 'gpt-4o-mini',
        maxTokens: 16384,
        contextWindow: 128000,
        costPer1kTokens: { input: 0.00015, output: 0.0006 }
      },
      'gpt-4-turbo': {
        name: 'gpt-4-turbo',
        maxTokens: 4096,
        contextWindow: 128000,
        costPer1kTokens: { input: 0.01, output: 0.03 }
      }
    };
  }

  /**
   * Create a message with the OpenAI API
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

      logger.info('Creating OpenAI message', {
        model: requestData.model,
        maxTokens: requestData.max_tokens,
        temperature: requestData.temperature,
        messageCount: requestData.messages?.length || 0
      });

      // Map messages format from Anthropic to OpenAI
      const messages = this.mapMessagesToOpenAI(requestData.messages, requestData.system);

      const apiRequest = {
        model: requestData.model,
        messages: messages,
        max_tokens: requestData.max_tokens,
        temperature: requestData.temperature || 0.1
      };

      // Add tools if provided (map from Anthropic format to OpenAI function calling)
      if (requestData.tools && requestData.tools.length > 0) {
        apiRequest.tools = this.mapToolsToOpenAI(requestData.tools);
        if (requestData.tool_choice) {
          apiRequest.tool_choice = requestData.tool_choice;
        }
      }

      const response = await this.client.chat.completions.create(apiRequest);

      const duration = Date.now() - startTime;
      
      logger.info('OpenAI response received', {
        model: response.model,
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        duration: `${duration}ms`
      });

      // Map response format to match Anthropic format
      return {
        model: response.model,
        usage: {
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: response.usage?.completion_tokens || 0
        },
        content: this.mapOpenAIResponseContent(response.choices[0].message),
        tool_calls: response.choices[0].message.tool_calls || null
      };

    } catch (error) {
      logger.error('OpenAI API error:', {
        error: error.message,
        status: error.status,
        type: error.type
      });

      // Handle specific OpenAI errors
      if (error.status === 400) {
        throw new Error(`Invalid request: ${error.message}`);
      } else if (error.status === 401) {
        throw new Error('Invalid API key');
      } else if (error.status === 403) {
        throw new Error('Insufficient permissions');
      } else if (error.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      } else if (error.status >= 500) {
        throw new Error('OpenAI service temporarily unavailable');
      }

      throw error;
    }
  }

  /**
   * Create a streaming message with the OpenAI API
   */
  async createStreamingMessage(requestData) {
    try {
      const startTime = Date.now();
      
      logger.info('Creating streaming OpenAI message', {
        model: requestData.model,
        maxTokens: requestData.max_tokens,
        temperature: requestData.temperature,
        messageCount: requestData.messages?.length || 0
      });

      // Map messages format from Anthropic to OpenAI
      const messages = this.mapMessagesToOpenAI(requestData.messages, requestData.system);

      const apiRequest = {
        model: requestData.model,
        messages: messages,
        max_tokens: requestData.max_tokens,
        temperature: requestData.temperature || 0.1,
        stream: true
      };

      // Add tools if provided
      if (requestData.tools && requestData.tools.length > 0) {
        apiRequest.tools = this.mapToolsToOpenAI(requestData.tools);
        if (requestData.tool_choice) {
          apiRequest.tool_choice = requestData.tool_choice;
        }
      }

      const stream = await this.client.chat.completions.create(apiRequest);

      // Create a custom event emitter to handle streaming
      const streamEmitter = new EventEmitter();

      let fullText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let currentToolCall = null;
      let toolCalls = [];

      (async () => {
        try {
          for await (const chunk of stream) {
            const choice = chunk.choices[0];
            if (!choice) continue;

            const delta = choice.delta;

            // Handle text content
            if (delta.content) {
              const text = delta.content;
              fullText += text;
              streamEmitter.emit('text', text);
            }

            // Handle tool calls
            if (delta.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                if (toolCall.index !== undefined) {
                  // Initialize or get existing tool call
                  if (!toolCalls[toolCall.index]) {
                    toolCalls[toolCall.index] = {
                      id: toolCall.id || '',
                      name: '',
                      arguments: ''
                    };
                    currentToolCall = toolCalls[toolCall.index];
                  } else {
                    currentToolCall = toolCalls[toolCall.index];
                  }

                  // Update tool call data
                  if (toolCall.id) {
                    currentToolCall.id = toolCall.id;
                  }
                  if (toolCall.function?.name) {
                    currentToolCall.name = toolCall.function.name;
                  }
                  if (toolCall.function?.arguments) {
                    currentToolCall.arguments += toolCall.function.arguments;
                  }

                  // Emit tool use event when we have complete name
                  if (currentToolCall.name && !currentToolCall.emitted) {
                    streamEmitter.emit('tool_use', {
                      name: currentToolCall.name,
                      arguments: currentToolCall.arguments
                    });
                    currentToolCall.emitted = true;
                  }
                }
              }
            }

            // Handle stream completion
            if (choice.finish_reason) {
              // Extract usage if available (OpenAI sometimes provides it in streaming)
              if (chunk.usage) {
                inputTokens = chunk.usage.prompt_tokens || 0;
                outputTokens = chunk.usage.completion_tokens || 0;
              }

              const duration = Date.now() - startTime;
              
              logger.info('Streaming response completed', {
                model: requestData.model,
                inputTokens,
                outputTokens,
                duration: `${duration}ms`,
                textLength: fullText.length
              });

              streamEmitter.emit('end', {
                fullText,
                usage: { input_tokens: inputTokens, output_tokens: outputTokens },
                duration,
                tool_calls: toolCalls.length > 0 ? toolCalls : null
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
      logger.error('OpenAI streaming error:', error);
      throw error;
    }
  }

  /**
   * Map messages from Anthropic format to OpenAI format
   */
  mapMessagesToOpenAI(messages, system) {
    const openAIMessages = [];

    // Add system message if provided
    if (system) {
      openAIMessages.push({
        role: 'system',
        content: system
      });
    }

    // Map user/assistant messages
    if (messages) {
      for (const message of messages) {
        openAIMessages.push({
          role: message.role,
          content: message.content
        });
      }
    }

    return openAIMessages;
  }

  /**
   * Map tools from Anthropic format to OpenAI function calling format
   */
  mapToolsToOpenAI(tools) {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema
      }
    }));
  }

  /**
   * Map OpenAI response content to Anthropic-like format
   */
  mapOpenAIResponseContent(message) {
    const content = [];

    if (message.content) {
      content.push({
        type: 'text',
        text: message.content
      });
    }

    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: (() => { try { return JSON.parse(toolCall.function.arguments || '{}') } catch { return {} } })()
        });
      }
    }

    return content;
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

module.exports = new OpenAIService();