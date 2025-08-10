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
        costPer1kTokens: { input: 1.25, output: 10.0 },
        tokenParam: 'max_completion_tokens',
        supportsTemperature: false,
        supportsStreaming: false
      },
      'gpt-5-mini': {
        name: 'gpt-5-mini',
        maxTokens: 16384,
        contextWindow: 256000,
        costPer1kTokens: { input: 0.25, output: 2.0 },
        tokenParam: 'max_completion_tokens',
        supportsTemperature: false,
        supportsStreaming: false
      },
      'gpt-5-nano': {
        name: 'gpt-5-nano',
        maxTokens: 8192,
        contextWindow: 128000,
        costPer1kTokens: { input: 0.05, output: 0.40 },
        tokenParam: 'max_completion_tokens',
        supportsTemperature: false,
        supportsStreaming: false
      },
      'gpt-4o': {
        name: 'gpt-4o',
        maxTokens: 4096,
        contextWindow: 128000,
        costPer1kTokens: { input: 0.0025, output: 0.01 },
        tokenParam: 'max_tokens',
        supportsTemperature: true,
        supportsStreaming: true
      },
      'gpt-4o-mini': {
        name: 'gpt-4o-mini',
        maxTokens: 16384,
        contextWindow: 128000,
        costPer1kTokens: { input: 0.00015, output: 0.0006 },
        tokenParam: 'max_tokens',
        supportsTemperature: true,
        supportsStreaming: true
      },
      'gpt-4-turbo': {
        name: 'gpt-4-turbo',
        maxTokens: 4096,
        contextWindow: 128000,
        costPer1kTokens: { input: 0.01, output: 0.03 },
        tokenParam: 'max_tokens',
        supportsTemperature: true,
        supportsStreaming: true
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
        messages: messages
      };

      // Use correct token limit parameter depending on model config
      const tokenParamKeyMsg = modelConfig.tokenParam || (String(requestData.model || '').startsWith('gpt-5') ? 'max_completion_tokens' : 'max_tokens');
      apiRequest[tokenParamKeyMsg] = requestData.max_tokens;

      // Only include temperature for models that support it (exclude gpt-5*)
      const isGpt5Msg = String(requestData.model || '').startsWith('gpt-5');
      if (!isGpt5Msg && requestData.temperature != null) {
        apiRequest.temperature = requestData.temperature;
      }

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

      // Validate model
      if (!this.models[requestData.model]) {
        throw new Error(`Unsupported model: ${requestData.model}`);
      }
      const modelConfig = this.models[requestData.model];

      // Ensure max_tokens doesn't exceed model limits
      requestData.max_tokens = Math.min(
        requestData.max_tokens || modelConfig.maxTokens,
        modelConfig.maxTokens
      );

      // Map messages format from Anthropic to OpenAI
      const messages = this.mapMessagesToOpenAI(requestData.messages, requestData.system);

      const apiRequest = {
        model: requestData.model,
        messages: messages
      };

      // Use correct token limit parameter depending on model family
      const tokenParamKeyStream = modelConfig.tokenParam || (String(requestData.model || '').startsWith('gpt-5')
        ? 'max_completion_tokens'
        : 'max_tokens');
      apiRequest[tokenParamKeyStream] = requestData.max_tokens;

      // Only include temperature for models that support it (exclude gpt-5*)
      const isGpt5Stream = String(requestData.model || '').startsWith('gpt-5');
      if (!isGpt5Stream && requestData.temperature != null) {
        apiRequest.temperature = requestData.temperature;
      }

      // Add tools if provided
      if (requestData.tools && requestData.tools.length > 0) {
        apiRequest.tools = this.mapToolsToOpenAI(requestData.tools);
        if (requestData.tool_choice) {
          apiRequest.tool_choice = requestData.tool_choice;
        }
      }

      // Create a custom event emitter to handle streaming or fallback
      const streamEmitter = new EventEmitter();

      const cfg = this.models[requestData.model];

      // If model doesn't support streaming, fall back to single non-streaming call,
      // but emit events in the same shape as streaming.
      if (cfg && cfg.supportsStreaming === false) {
        // Perform the non-streaming call asynchronously and return the emitter immediately
        (async () => {
          try {
            const resp = await this.client.chat.completions.create(apiRequest);
            const msg = resp.choices?.[0]?.message || {};
            const text = msg.content || '';
            const toolCallsRaw = msg.tool_calls || [];
            const toolCalls = Array.isArray(toolCallsRaw)
              ? toolCallsRaw.map(tc => ({
                  id: tc.id,
                  name: tc.function?.name,
                  arguments: tc.function?.arguments
                }))
              : [];
            const duration = Date.now() - startTime;

            if (text) {
              streamEmitter.emit('text', text);
            }
            streamEmitter.emit('end', {
              fullText: text,
              usage: {
                input_tokens: resp.usage?.prompt_tokens || 0,
                output_tokens: resp.usage?.completion_tokens || 0
              },
              duration,
              tool_calls: toolCalls
            });
          } catch (err) {
            logger.error('Non-streaming fallback error:', err);
            streamEmitter.emit('error', err);
          }
        })();
        return streamEmitter;
      }

      // Otherwise, stream as usual
      const stream = await this.client.chat.completions.create({ ...apiRequest, stream: true });

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
        // Pass through tool messages and assistant tool_calls when present
        if (message.role === 'tool') {
          openAIMessages.push({
            role: 'tool',
            content: message.content,
            tool_call_id: message.tool_call_id
          });
          continue;
        }

        if (message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
          openAIMessages.push({
            role: 'assistant',
            content: message.content || null,
            tool_calls: message.tool_calls
          });
          continue;
        }

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