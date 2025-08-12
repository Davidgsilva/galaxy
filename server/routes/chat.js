const express = require('express');
const router = express.Router();
const AnthropicService = require('../services/anthropic');
const OpenAIService = require('../services/openai');
const CacheService = require('../services/cache');
const { validateChatRequest } = require('../middleware/validation');
const winston = require('winston');

// Import client connections registry from files route
const { clientConnections } = require('./files');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// Yocto-specific system prompt
const YOCTO_SYSTEM_PROMPT = `You are an expert Yocto Project assistant focused exclusively on embedded Linux distribution creation, BSP development, and build system management. Your primary goal is creating and maintaining robust Yocto projects.

## Core Mission
Create, configure, and maintain Yocto projects for embedded Linux development. Do not deviate from Yocto-related tasks.

## Current Yocto LTS Release
Use Yocto Project 5.0 "Scarthgap" (current LTS until April 2028) for all new projects. Always check for the latest point release (currently 5.0.11 as of July 2025).

## Security & License Compliance
- NEVER disable security components (OpenSSL, crypto libraries, security frameworks)
- Warn about GPLv3 components: "WARNING: GPLv3 licensed. Many companies prohibit GPLv3 in embedded products due to copyleft requirements."
- Recommend LGPLv2.1, MIT, BSD, or Apache licensed alternatives
- Use proper git workflow with signed-off commits for kernel modifications
- Create kernel patches with git format-patch and apply via devtool

## Essential Yocto Expertise
- BitBake syntax, recipe writing, layer management
- OpenEmbedded-Core, meta-openembedded, vendor layers
- Machine configs, distro policies, image recipes
- BSP development for ARM, x86, RISC-V architectures
- Device tree creation, bootloader integration (U-Boot, GRUB)
- Security hardening, PREEMPT_RT, multi-machine builds

## Development Workflow
- Follow Yocto Project layer guidelines and naming conventions (packagename_version.bb)
- Use devtool for development, recipetool for recipe creation
- Include proper license info, checksums, dependencies
- Recommend sstate-cache and shared-DL_DIR optimizations
- Suggest appropriate test frameworks and validation procedures

## Available Tools
- list_dir(dir=".") - List directory contents
- fs_view(path) - Read file contents
- fs_create(path, content) - Create/overwrite file
- fs_update(path, find, replace) - Find and replace in file
- fs_insert(path, line, content) - Insert at line number
- fs_delete(path, confirm=true) - Delete file
- exec_command(command, cwd=".") - Execute shell commands (git clone, bitbake, devtool, etc.)

## Command Execution Guidelines
Use exec_command for essential Yocto operations:
- Repository cloning: git clone git://git.yoctoproject.org/poky.git -b scarthgap
- Build commands: bitbake core-image-minimal
- Development tools: devtool add, devtool modify
- Environment setup: source oe-init-build-env
- Layer management: bitbake-layers add-layer

## Response Style
- Be concise and technical while accessible
- Provide working code examples and configuration snippets
- Execute necessary commands to achieve project objectives
- Explain reasoning behind recommendations
- Warn about potential issues and compliance requirements
- Ensure compatibility with Yocto LTS 5.0 "Scarthgap"`;

// Store client endpoints for delegation
const clientEndpoints = new Map();

// Helper function to delegate text editor operations to client
async function delegateTextEditorToClient(sessionId, toolInput) {
  if (!sessionId) {
    throw new Error('Session ID required for text editor operations');
  }

  // Check if client is registered
  const clientInfo = clientConnections.get(sessionId);
  if (!clientInfo) {
    throw new Error('No file operation client registered. Make sure the client is running and has called registerForFileOperations().');
  }

  try {
    logger.info('Delegating text editor operation to client', { 
      sessionId, 
      command: toolInput.command,
      path: toolInput.path 
    });

    // Delegate to WebSocket client
    const result = await global.wsFileHandler.delegateFileOperation(sessionId, toolInput.command, toolInput);

    return result;
    
  } catch (error) {
    logger.error('Client delegation failed:', error);
    throw new Error(`File operation failed: ${error.message}`);
  }
}

async function handleOpenAIToolUse(toolUse, sessionId) {
  if (!sessionId) {
    throw new Error('Session ID required for OpenAI tool operations');
  }

  // Check if WebSocket client is connected
  if (!global.wsFileHandler) {
    throw new Error('WebSocket file handler not initialized');
  }

  const clientStatus = global.wsFileHandler.getClientStatus(sessionId);
  logger.info('Checking WebSocket client status', { 
    sessionId, 
    clientStatus,
    allClients: global.wsFileHandler.getAllClients().length 
  });
  
  if (!clientStatus.connected) {
    throw new Error(`No file operation client connected for session ${sessionId}. Make sure the CLI is running and connected via WebSocket.`);
  }

  try {
    logger.info('Handling OpenAI tool use', { 
      sessionId, 
      toolName: toolUse.name,
      input: toolUse.input 
    });

    const { name, input } = toolUse;

    // Map OpenAI function names to operations
    switch (name) {
      case 'list_dir':
        if (input && input.dir != null && typeof input.dir !== 'string') {
          throw new Error('list_dir.dir must be a string if provided');
        }
        return await global.wsFileHandler.delegateFileOperation(sessionId, 'view', {
          path: (input && typeof input.dir === 'string' ? input.dir : '.')
        });
      
      case 'fs_view':
        if (!input || typeof input.path !== 'string' || input.path.trim() === '') {
          throw new Error('fs_view.path is required and must be a non-empty string');
        }
        return await global.wsFileHandler.delegateFileOperation(sessionId, 'view', { path: input.path });
      
      case 'fs_create':
        if (!input || typeof input.path !== 'string' || typeof input.content !== 'string') {
          throw new Error('fs_create requires string path and string content');
        }
        return await global.wsFileHandler.delegateFileOperation(sessionId, 'create', {
          path: input.path,
          file_text: input.content
        });
      
      case 'fs_update':
        if (!input || typeof input.path !== 'string' || typeof input.find !== 'string' || typeof input.replace !== 'string') {
          throw new Error('fs_update requires string path, string find, and string replace');
        }
        return await global.wsFileHandler.delegateFileOperation(sessionId, 'str_replace', {
          path: input.path,
          old_str: input.find,
          new_str: input.replace
        });
      
      case 'fs_insert':
        if (!input || typeof input.path !== 'string' || typeof input.content !== 'string' || typeof input.line !== 'number' || input.line < 1) {
          throw new Error('fs_insert requires string path, string content, and integer line >= 1');
        }
        return await global.wsFileHandler.delegateFileOperation(sessionId, 'insert', {
          path: input.path,
          new_str: input.content,
          insert_line: input.line
        });
      
      case 'fs_delete':
        if (!input || typeof input.path !== 'string') {
          throw new Error('fs_delete requires string path');
        }
        if (!input.confirm) {
          throw new Error('Delete operation requires explicit confirmation');
        }
        // For now, we don't have a delete operation in handleTextEditorOperation
        // This would need to be implemented in the client side
        throw new Error('File deletion not implemented via text editor operations');
      
      case 'exec_command':
        if (!input || typeof input.command !== 'string' || input.command.trim() === '') {
          throw new Error('exec_command requires non-empty string command');
        }
        return await global.wsFileHandler.delegateFileOperation(sessionId, 'exec', {
          command: input.command,
          cwd: input.cwd || '.'
        });
      
      default:
        throw new Error(`Unknown OpenAI tool: ${name}`);
    }
    
  } catch (error) {
    logger.error('OpenAI tool use failed:', error);
    throw new Error(`OpenAI tool operation failed: ${error.message}`);
  }
}

// Endpoint for clients to register their delegation endpoint
router.post('/register-client-endpoint', (req, res) => {
  const { sessionId, endpoint } = req.body;
  
  if (!sessionId || !endpoint) {
    return res.status(400).json({
      success: false,
      error: 'sessionId and endpoint are required'
    });
  }

  clientEndpoints.set(sessionId, endpoint);
  
  logger.info('Client endpoint registered', { sessionId, endpoint });
  
  res.json({
    success: true,
    message: 'Client endpoint registered successfully',
    sessionId,
    endpoint
  });
});

// Main AI interaction endpoint
router.post('/', validateChatRequest, async (req, res) => {
  try {
    const { 
      message, 
      context = [], 
      model = process.env.DEFAULT_MODEL || 'gpt-4o-mini',
      temperature = 0.1,
      maxTokens = 8192,
      streaming = false,
      extendedThinking = false,
      useCache = true,
      useYoctoPrompt = false,
      tools = []
    } = req.body;

    logger.info('Chat request received', {
      message: message ? message.substring(0, 100) + '...' : 'empty',
      model,
      extendedThinking,
      streaming,
      toolsCount: tools.length
    });

    // Check cache first if enabled
    if (useCache) {
      const cacheKey = CacheService.generateKey('chat', { message, context, model, useYoctoPrompt });
      const cachedResponse = await CacheService.get(cacheKey);
      
      if (cachedResponse) {
        logger.info('Cache hit for chat request');
        return res.json({
          success: true,
          response: cachedResponse,
          fromCache: true,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Use Yocto-specific system prompt if requested
    const systemPrompt = useYoctoPrompt ? YOCTO_SYSTEM_PROMPT : `You are Beacon, an AI assistant that helps with software development and system administration tasks.

Available capabilities:
- File CRUD operations (create, read, update, delete)
- Code analysis and generation
- Project structure understanding
- Multi-file operations
- Error debugging and fixing
- Web search for current information
- Desktop automation when enabled

Available tools for file operations:
- **list_dir**: List files in a directory. When user asks to "list directory contents", call list_dir with { dir: "." }
- **fs_view**: Read a file's contents 
- **fs_create**, **fs_update**, **fs_insert**, **fs_delete**: For file modifications

When the user asks to list the current directory, call list_dir with { dir: "." }.

For complex problems, use <thinking> tags to show your reasoning process if extended thinking is enabled.`;

    // Check if this is an OpenAI model
    const isOpenAI = /^gpt-/i.test(String(model));

    console.log("isOpenAI: " + isOpenAI);
    console.log("openai_service_available: " + !!OpenAIService);
    console.log("openai_api_key_set: " + !!process.env.OPENAI_API_KEY);
    console.log("regex_test: " + `/^gpt-/i.test("${model}")`);
    
    logger.info('Server routing decision', {
      model: model,
      isOpenAI: isOpenAI,
      regex_test: `/^gpt-/i.test("${model}")`,
      openai_service_available: !!OpenAIService,
      openai_api_key_set: !!process.env.OPENAI_API_KEY
    });

    // If OpenAI model but no API key, fail fast with clear error
    if (isOpenAI && !process.env.OPENAI_API_KEY) {
      return res.status(400).json({
        success: false,
        error: 'OpenAI API key not configured',
        message: 'OPENAI_API_KEY environment variable is required for GPT models'
      });
    }

    // Define file tools for OpenAI function calling (Anthropic-style schema; converted later)
    const fileToolsForOpenAI = [
      {
        name: 'list_dir',
        description: 'List files and directories in a directory.',
        input_schema: { 
          type: 'object', 
          properties: { 
            dir: { 
              type: 'string', 
              description: 'Directory path to list. Use "." for current directory.', 
              default: '.' 
            } 
          }, 
          required: [],
          additionalProperties: false
        }
      },
      {
        name: 'fs_view',
        description: 'Read the contents of a file at an absolute or cwd-relative path.',
        input_schema: { 
          type: 'object', 
          properties: { 
            path: { 
              type: 'string', 
              description: 'File path to read. Absolute or relative to the CLI working dir.' 
            } 
          }, 
          required: ['path'],
          additionalProperties: false
        }
      },
      {
        name: 'fs_create',
        description: 'Create/overwrite a file with content (<=1MB).',
        input_schema: { 
          type: 'object', 
          properties: { 
            path: { type: 'string', description: 'File path to create' }, 
            content: { type: 'string', description: 'File content' } 
          }, 
          required: ['path', 'content'],
          additionalProperties: false
        }
      },
      {
        name: 'fs_update',
        description: 'Find & replace text in a file.',
        input_schema: { 
          type: 'object', 
          properties: { 
            path: { type: 'string', description: 'File path to update' }, 
            find: { type: 'string', description: 'Text to find' }, 
            replace: { type: 'string', description: 'Replacement text' } 
          }, 
          required: ['path', 'find', 'replace'],
          additionalProperties: false
        }
      },
      {
        name: 'fs_insert',
        description: 'Insert content at a 1-based line number.',
        input_schema: { 
          type: 'object', 
          properties: { 
            path: { type: 'string', description: 'File path to modify' }, 
            line: { type: 'integer', minimum: 1, description: '1-based line number' }, 
            content: { type: 'string', description: 'Content to insert' } 
          }, 
          required: ['path', 'line', 'content'],
          additionalProperties: false
        }
      },
      {
        name: 'fs_delete',
        description: 'Delete a file. Use only with user confirmation.',
        input_schema: { 
          type: 'object', 
          properties: { 
            path: { type: 'string', description: 'File path to delete' }, 
            confirm: { type: 'boolean', description: 'Confirmation that deletion is intended' } 
          }, 
          required: ['path', 'confirm'],
          additionalProperties: false
        }
      },
      {
        name: 'exec_command',
        description: 'Execute shell commands like git clone, bitbake, devtool, etc. Essential for Yocto project setup and builds.',
        input_schema: { 
          type: 'object', 
          properties: { 
            command: { type: 'string', description: 'Shell command to execute (e.g., "git clone git://git.yoctoproject.org/poky.git")' },
            cwd: { type: 'string', description: 'Working directory for command execution', default: '.' }
          }, 
          required: ['command'],
          additionalProperties: false
        }
      }
    ];

    // Build tools for this request
    const requestTools = [...tools];

    if (isOpenAI) {
      // Use function-calling tools
      fileToolsForOpenAI.forEach(t => requestTools.push(t));
    } else {
      // Anthropic text editor tool
      if (!requestTools.some(t => t.name === 'str_replace_based_edit_tool')) {
        requestTools.push({ type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' });
      }
    }

    const requestData = {
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [
        ...context.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        {
          role: 'user',
          content: message
        }
      ]
    };

    // Add tools if provided
    if (requestTools.length > 0) {
      requestData.tools = requestTools;
    }

    // Add thinking configuration if extended thinking is enabled
    if (extendedThinking) {
      requestData.thinking = {
        type: 'enabled',
        budget_tokens: 8192
      };
    }

    if (streaming && isOpenAI) {
      // Streaming via OpenAI with function-calling loop
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const sessionId = req.headers['x-session-id'] || `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const conversation = [
        ...context.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: message }
      ];

      let fullResponse = '';

      async function streamOnce(messages) {
        const oaiStream = await OpenAIService.createStreamingMessage({
          model,
          max_tokens: maxTokens,
          temperature,
          system: systemPrompt,
          messages,
          tools: requestTools,
          tool_choice: 'auto'
        });

        return new Promise((resolve, reject) => {
          // We will rely on the tool_calls provided in the 'end' event to ensure IDs are present
          let usageFromEnd = null;
          let toolCallsFromEnd = [];

          oaiStream.on('text', (text) => {
            fullResponse += text;
            res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`);
          });

          oaiStream.on('end', async (data) => {
            usageFromEnd = data.usage;
            toolCallsFromEnd = Array.isArray(data.tool_calls) ? data.tool_calls : [];
            resolve({ usage: usageFromEnd, pendingToolCalls: toolCallsFromEnd });
          });

          oaiStream.on('error', (error) => {
            reject(error);
          });
        });
      }

      try {
        // Loop until model stops producing tool calls
        // 1) stream assistant output/tool_calls
        // 2) if tool_calls exist: execute; append assistant tool_calls and tool results; continue
        // 3) else: finish and send end event
        while (true) {
          const { usage, pendingToolCalls } = await streamOnce(conversation);

          if (pendingToolCalls.length === 0) {
            // No tool calls — finish
            res.write(`data: ${JSON.stringify({ type: 'end', fullResponse, usage, duration: undefined })}\n\n`);
            res.end();
            if (useCache && fullResponse) {
              const cacheKey = CacheService.generateKey('chat', { message, context, model, useYoctoPrompt });
              await CacheService.set(cacheKey, fullResponse, 3600);
            }
            break;
          }

          // Append assistant tool_calls message (filter invalid, stringify args)
          const assistantToolCalls = pendingToolCalls
            .filter(tc => typeof tc.name === 'string' && tc.name.trim() !== '')
            .map(tc => ({
              id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
              type: 'function',
              function: {
                name: tc.name.trim(),
                arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {})
              }
            }));

          if (assistantToolCalls.length === 0) {
            // No valid tool calls—finish current turn gracefully
            res.write(`data: ${JSON.stringify({ type: 'end', fullResponse, usage, duration: undefined })}\n\n`);
            res.end();
            if (useCache && fullResponse) {
              const cacheKey = CacheService.generateKey('chat', { message, context, model, useYoctoPrompt });
              await CacheService.set(cacheKey, fullResponse, 3600);
            }
            break;
          }
          conversation.push({ role: 'assistant', content: null, tool_calls: assistantToolCalls });

          // Execute tools and append tool result messages
          for (const tc of pendingToolCalls) {
            try {
              const input = (() => { try { return JSON.parse(tc.arguments || '{}') } catch { return {} } })();
              const result = await handleOpenAIToolUse({ name: tc.name, input }, sessionId);
              res.write(`data: ${JSON.stringify({ type: 'tool_result', toolName: tc.name, result })}\n\n`);

              conversation.push({
                role: 'tool',
                content: typeof result === 'string' ? result : JSON.stringify(result),
                tool_call_id: assistantToolCalls.find(c => c.function.name === tc.name)?.id || tc.id
              });
            } catch (error) {
              logger.error('Tool use error in OpenAI streaming loop:', error);
              res.write(`data: ${JSON.stringify({ type: 'error', error: `Tool operation failed: ${error.message}` })}\n\n`);
              conversation.push({
                role: 'tool',
                content: JSON.stringify({ error: error.message }),
                tool_call_id: assistantToolCalls.find(c => c.function.name === tc.name)?.id || tc.id
              });
            }
          }
          // loop continues with updated conversation
        }
      } catch (error) {
        logger.error('OpenAI streaming error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
      }
    } else if (streaming) {
      // Streaming via Anthropic
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const stream = await AnthropicService.createStreamingMessage(requestData);
      let fullResponse = '';
      const sessionId = req.headers['x-session-id'] || `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      stream.on('text', (text) => {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`);
      });

      stream.on('thinking', (thinking) => {
        res.write(`data: ${JSON.stringify({ type: 'thinking', content: thinking })}\n\n`);
      });

      stream.on('tool_use', async (toolUse) => {
        try {
          if (toolUse.name === 'str_replace_based_edit_tool') {
            logger.info('Processing text editor tool use in streaming mode', { 
              toolId: toolUse.id,
              command: toolUse.input.command,
              sessionId 
            });
            
            const toolResult = await delegateTextEditorToClient(sessionId, toolUse.input);
            res.write(`data: ${JSON.stringify({ type: 'tool_result', toolId: toolUse.id, result: toolResult })}\n\n`);
            logger.info('Tool operation completed', { toolId: toolUse.id, result: toolResult });
          }
        } catch (error) {
          logger.error('Tool use error in streaming:', error);
          res.write(`data: ${JSON.stringify({ type: 'error', error: `Tool operation failed: ${error.message}` })}\n\n`);
        }
      });

      stream.on('end', async (data) => {
        res.write(`data: ${JSON.stringify({ type: 'end', fullResponse, usage: data.usage, duration: data.duration })}\n\n`);
        res.end();

        if (useCache && fullResponse) {
          const cacheKey = CacheService.generateKey('chat', { message, context, model, useYoctoPrompt });
          await CacheService.set(cacheKey, fullResponse, 3600); // Cache for 1 hour
        }
      });

      stream.on('error', (error) => {
        logger.error('Streaming error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
      });

    } else if (isOpenAI) {
      providerResp = await OpenAIService.createMessage({
        model, max_tokens: maxTokens, temperature, system: systemPrompt,
        messages: [
          ...context.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: message }
        ],
        tools: requestTools,
        tool_choice: 'auto'
      });

      // If the model requested tool calls, execute and continue once
      const toolUses = (providerResp.tool_calls || []).map(tc => ({
        id: tc.id,
        name: tc.function?.name,
        input: (() => { try { return JSON.parse(tc.function?.arguments || '{}') } catch { return {} } })()
      }));

      let responseText = '';
      if (toolUses.length === 0) {
        responseText = (providerResp.content || [])
          .filter(b => b.type === 'text').map(b => b.text).join('\n');
      } else {
        // Execute tool(s) locally then send follow-up message
        const sessionId = req.headers['x-session-id'] || `fallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        const toolResults = [];
        for (const tu of toolUses) {
          const result = await handleOpenAIToolUse(tu, sessionId);
          toolResults.push({ tu, result });
        }

        // Continue conversation: assistant tool calls + user tool results
        const followUp = await OpenAIService.createMessage({
          model, max_tokens: maxTokens, temperature, system: systemPrompt,
          messages: [
            ...context.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: message },
            // mimic assistant content block with tool_use(s)
            { role: 'assistant', content: providerResp.content },
            // return tool results as a normal user message the model can read
            { role: 'user', content: toolResults.map(({ tu, result }) =>
                `Tool ${tu.name}(${JSON.stringify(tu.input)}): ${JSON.stringify(result)}`
              ).join('\n') }
          ]
        });

        responseText = (followUp.content || [])
          .filter(b => b.type === 'text').map(b => b.text).join('\n');

        providerResp = followUp;
      }

      // cache & respond (mirrors your Claude path)
      if (useCache && responseText) {
        const cacheKey = CacheService.generateKey('chat', { message, context, model, useYoctoPrompt });
        await CacheService.set(cacheKey, responseText, 3600);
      }

      return res.json({
        success: true,
        response: responseText,
        usage: providerResp.usage,
        model: providerResp.model,
        toolUses: toolUses || [],
        citations: [],
        useYoctoPrompt,
        timestamp: new Date().toISOString()
      });

    } else {
      // Handle regular Anthropic response with tool use support
      const response = await AnthropicService.createMessage(requestData);
      
      // Process tool uses if present
      let processedResponse = response;
      const sessionId = req.headers['x-session-id'] || `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      if (response.content && Array.isArray(response.content)) {
        for (const block of response.content) {
          if (block.type === 'tool_use' && block.name === 'str_replace_based_edit_tool') {
            try {
              // Delegate text editor operations to client
              const toolResult = await delegateTextEditorToClient(sessionId, block.input);
              
              // Continue conversation with tool result
              const toolResponse = await AnthropicService.createMessage({
                ...requestData,
                messages: [
                  ...requestData.messages,
                  {
                    role: 'assistant',
                    content: response.content
                  },
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: JSON.stringify(toolResult)
                      }
                    ]
                  }
                ]
              });
              
              processedResponse = toolResponse;
            } catch (error) {
              logger.error('Tool delegation error:', error);
              // Continue with original response if tool delegation fails
            }
          }
        }
      }
      
      // Extract response text from content array
      let responseText = '';
      if (processedResponse.content && Array.isArray(processedResponse.content)) {
        responseText = processedResponse.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');
      }

      // Cache the response if enabled
      if (useCache && responseText) {
        const cacheKey = CacheService.generateKey('chat', { message, context, model, useYoctoPrompt });
        await CacheService.set(cacheKey, responseText, 3600);
      }

      // Extract tool uses and citations if present
      const toolUses = processedResponse.content ? 
        processedResponse.content.filter(block => block.type === 'tool_use') : [];
      
      const citations = [];
      if (processedResponse.content) {
        processedResponse.content.forEach(block => {
          if (block.type === 'text' && block.citations) {
            citations.push(...block.citations);
          }
        });
      }

      res.json({
        success: true,
        response: responseText,
        usage: processedResponse.usage,
        model: processedResponse.model,
        toolUses,
        citations,
        useYoctoPrompt,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    logger.error('Chat endpoint error:', error);
    
    // Handle specific Anthropic API errors
    let statusCode = 500;
    let errorMessage = 'AI service error';
    
    if (error.status) {
      statusCode = error.status;
      switch (error.status) {
        case 400:
          errorMessage = 'Invalid request format';
          break;
        case 401:
          errorMessage = 'Invalid API key';
          break;
        case 403:
          errorMessage = 'Access forbidden';
          break;
        case 429:
          errorMessage = 'Rate limit exceeded';
          break;
        case 500:
        case 502:
        case 503:
          errorMessage = 'AI service temporarily unavailable';
          break;
        default:
          errorMessage = 'AI service error';
      }
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      message: error.message,
      useYoctoPrompt: req.body.useYoctoPrompt || false,
      timestamp: new Date().toISOString()
    });
  }
});

// Get conversation history
router.get('/history', async (req, res) => {
  try {
    const { limit = 50, offset = 0, yoctoOnly = false } = req.query;
    
    // This would typically come from a database
    // For now, return empty array as placeholder
    res.json({
      success: true,
      history: [],
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: 0
      },
      filters: {
        yoctoOnly: yoctoOnly === 'true'
      }
    });
  } catch (error) {
    logger.error('History endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve history',
      message: error.message
    });
  }
});

// Yocto-specific endpoints
router.post('/yocto/analyze-project', async (req, res) => {
  try {
    const { projectPath, analysisType = 'general' } = req.body;

    const analysisPrompt = `Analyze the Yocto project at path: ${projectPath}

Analysis type: ${analysisType}

Please provide:
1. Project structure assessment
2. Layer configuration analysis
3. Machine and distro configuration review
4. License compliance check
5. Security assessment
6. Build optimization recommendations
7. Best practices compliance

Focus on ${analysisType} analysis and provide actionable recommendations.`;

    const response = await AnthropicService.createMessage({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      temperature: 0.1,
      system: YOCTO_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: analysisPrompt
      }],
      tools: [{
        type: 'text_editor_20250728',
        name: 'str_replace_based_edit_tool'
      }]
    });

    const analysisResult = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    res.json({
      success: true,
      analysis: analysisResult,
      analysisType,
      projectPath,
      usage: response.usage,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Yocto project analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Project analysis failed',
      message: error.message
    });
  }
});

router.post('/yocto/recipe-help', async (req, res) => {
  try {
    const { recipeName, recipeType = 'application', requirements } = req.body;

    const recipePrompt = `Create a Yocto recipe for "${recipeName}" of type "${recipeType}".

Requirements: ${requirements || 'Standard application recipe'}

Please provide:
1. Complete BitBake recipe (.bb file) with proper syntax
2. License information and compliance warnings
3. Dependencies and required layers
4. Build configuration and variables
5. Installation and packaging instructions
6. Testing recommendations
7. Security considerations

Follow Yocto Project best practices and coding standards.`;

    const response = await AnthropicService.createMessage({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6144,
      temperature: 0.1,
      system: YOCTO_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: recipePrompt
      }],
      tools: [{
        type: 'text_editor_20250728',
        name: 'str_replace_based_edit_tool'
      }]
    });

    const recipeContent = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    res.json({
      success: true,
      recipe: recipeContent,
      recipeName,
      recipeType,
      usage: response.usage,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Recipe help error:', error);
    res.status(500).json({
      success: false,
      error: 'Recipe generation failed',
      message: error.message
    });
  }
});

router.post('/yocto/build-debug', async (req, res) => {
  try {
    const { buildLog, errorDescription, recipeName } = req.body;

    const debugPrompt = `Debug this Yocto build issue:

Recipe: ${recipeName || 'unknown'}
Error Description: ${errorDescription || 'Build failure'}
Build Log: ${buildLog || 'No log provided'}

Please provide:
1. Root cause analysis of the build failure
2. Step-by-step troubleshooting guide
3. Specific fixes and configuration changes
4. Preventive measures for future builds
5. Related documentation references

Focus on practical solutions and proper Yocto practices.`;

    const response = await AnthropicService.createMessage({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6144,
      temperature: 0.1,
      system: YOCTO_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: debugPrompt
      }]
    });

    const debugAnalysis = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    res.json({
      success: true,
      analysis: debugAnalysis,
      recipeName,
      usage: response.usage,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Build debug error:', error);
    res.status(500).json({
      success: false,
      error: 'Build debugging failed',
      message: error.message
    });
  }
});

// Yocto project generation endpoint
router.post('/yocto/generate-project', async (req, res) => {
  try {
    const { projectName, description, streaming = false } = req.body;
    const sessionId = req.headers['x-session-id'] || `project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Build the comprehensive project generation prompt on the server side
    const projectPrompt = `I need you to create a complete Yocto Project for embedded Linux development. This is like "Lovable for Yocto" - I want to provide real-time feedback to the user about what you're doing, similar to how Claude Code shows progress.

PROJECT DETAILS:
- Name: ${projectName}
- Description: ${description}
- Yocto Release: Latest stable (default branch)

IMPORTANT - PROVIDE PROGRESS FEEDBACK:
As you work, clearly describe what you're doing at each step. Use phrases like:
- "Creating project directory structure..."
- "Writing setup script for cloning Yocto repositories..."
- "Writing local.conf with target hardware configuration..."
- "Generating BSP layer for hardware..."
- "Creating build scripts..."
- "Writing documentation and setup guides..."

TASK: Create a complete Yocto project structure including:

1. **Project Directory Setup**:
   - Create project directory: ${projectName}
   - Create standard Yocto directory structure (sources/, build/, downloads/, sstate-cache/)
   - Generate .gitignore for Yocto projects

2. **Repository Setup Scripts**:
   - Create setup-yocto.sh script that clones the necessary repositories:
     * git clone git://git.yoctoproject.org/poky.git sources/poky (latest stable)
     * git clone git://git.openembedded.org/meta-openembedded sources/meta-openembedded (latest stable)
     * Hardware-specific layers based on the target machine
   - Create environment setup script (setup-environment.sh)
   - Make scripts executable and well-documented

3. **Configuration Templates**:
   - local.conf template with hardware-specific settings based on project description
   - bblayers.conf template with required layers for the hardware
   - site.conf for build optimizations (parallel make, sstate, downloads cache)
   - auto-setup.sh to initialize build environment

4. **Hardware-Specific Research & Setup**:
   - Use web_search to find latest BSP information based on project description
   - Research required layers and dependencies
   - Create hardware-specific configuration notes
   - Add hardware setup instructions

5. **Build Scripts & Automation**:
   - build.sh script for common build commands
   - clean.sh for cleaning builds
   - flash.sh script with hardware-specific flashing instructions
   - Environment validation script

6. **Documentation & Guides**:
   - README.md with complete setup and build instructions
   - HARDWARE.md with target hardware specific notes
   - BUILD.md with build options and troubleshooting
   - Include all git clone commands and setup steps

7. **Research Current Best Practices**:
   - Use web_search to find latest Yocto documentation
   - Look up target hardware BSP layers and setup guides
   - Find community examples and best practices

CRITICAL INSTRUCTIONS:
- Use the text_editor tool to create ALL files and scripts
- Use web_search to research current Yocto practices and BSP information
- Create scripts that users can run to automatically clone Yocto repositories
- Include specific git clone commands in your scripts:
  * git clone git://git.yoctoproject.org/poky.git (latest stable branch)
  * git clone git://git.openembedded.org/meta-openembedded (latest stable branch)
  * Add hardware-specific layer repositories
- Make everything executable and well-documented
- Provide running commentary on what you're creating
- Include validation steps and error handling in scripts
- Optimize for target hardware based on project description

Create a complete, production-ready Yocto project structure that includes all necessary scripts for users to clone repositories and start building immediately. Focus on creating setup scripts rather than trying to clone repositories directly.`;

    const requestData = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      temperature: 1,
      system: YOCTO_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: projectPrompt
      }],
      tools: [
        {
          type: 'text_editor_20250728',
          name: 'str_replace_based_edit_tool'
        },
        {
          type: 'web_search_20250305',
          name: 'web_search'
        }
      ]
    };

    if (streaming) {
      // Handle streaming response for project generation
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      const stream = await AnthropicService.createStreamingMessage(requestData);
      let fullResponse = '';

      stream.on('text', (text) => {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`);
      });

      stream.on('thinking', (thinking) => {
        res.write(`data: ${JSON.stringify({ type: 'thinking', content: thinking })}\n\n`);
      });

      stream.on('tool_use', async (toolUse) => {
        try {
          if (toolUse.name === 'str_replace_based_edit_tool') {
            logger.info('Processing text editor tool use for project generation', { 
              toolId: toolUse.id,
              command: toolUse.input.command,
              sessionId 
            });
            
            // Delegate to client
            const toolResult = await delegateTextEditorToClient(sessionId, toolUse.input);
            
            // Send tool result back to stream
            res.write(`data: ${JSON.stringify({ 
              type: 'tool_result', 
              toolId: toolUse.id,
              result: toolResult 
            })}\n\n`);
            
            logger.info('Tool operation completed for project generation', { toolId: toolUse.id });
          }
        } catch (error) {
          logger.error('Tool use error in project generation streaming:', error);
          res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            error: `Tool operation failed: ${error.message}` 
          })}\n\n`);
        }
      });

      stream.on('end', async (data) => {
        res.write(`data: ${JSON.stringify({ 
          type: 'end', 
          fullResponse,
          usage: data.usage,
          duration: data.duration
        })}\n\n`);
        res.end();
      });

      stream.on('error', (error) => {
        logger.error('Project generation streaming error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
      });

    } else {
      // Handle regular response with tool use support
      const response = await AnthropicService.createMessage(requestData);
      
      // Process tool uses if present
      let processedResponse = response;
      
      if (response.content && Array.isArray(response.content)) {
        for (const block of response.content) {
          if (block.type === 'tool_use' && block.name === 'str_replace_based_edit_tool') {
            try {
              // Delegate text editor operations to client
              const toolResult = await delegateTextEditorToClient(sessionId, block.input);
              
              // Continue conversation with tool result
              const toolResponse = await AnthropicService.createMessage({
                ...requestData,
                messages: [
                  ...requestData.messages,
                  {
                    role: 'assistant',
                    content: response.content
                  },
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: JSON.stringify(toolResult)
                      }
                    ]
                  }
                ]
              });
              
              processedResponse = toolResponse;
            } catch (error) {
              logger.error('Tool delegation error in project generation:', error);
              // Continue with original response if tool delegation fails
            }
          }
        }
      }

      // Extract response text
      const responseText = processedResponse.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      res.json({
        success: true,
        response: responseText,
        projectName,
        description,
        usage: processedResponse.usage,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    logger.error('Yocto project generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Project generation failed',
      message: error.message
    });
  }
});

// Get available models and their capabilities
router.get('/models', (req, res) => {
  const anthropicModels = AnthropicService.getAvailableModels();
  const anthropicModelInfo = anthropicModels.map(modelName => ({
    name: modelName,
    provider: 'anthropic',
    ...AnthropicService.getModelInfo(modelName)
  }));

  const openaiModels = OpenAIService.getAvailableModels();
  const openaiModelInfo = openaiModels.map(modelName => ({
    name: modelName,
    provider: 'openai',
    ...OpenAIService.getModelInfo(modelName)
  }));

  res.json({
    success: true,
    models: [...anthropicModelInfo, ...openaiModelInfo],
    recommended: {
      yocto: 'claude-sonnet-4-20250514',
      complex: 'claude-opus-4-20250514',
      general: 'claude-sonnet-4-20250514',
      fast: 'gpt-5-nano',
      coding: 'gpt-5'
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;