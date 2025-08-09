const express = require('express');
const router = express.Router();
const AnthropicService = require('../services/anthropic');
const CacheService = require('../services/cache');
const { validateChatRequest } = require('../middleware/validation');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// Yocto-specific system prompt
const YOCTO_SYSTEM_PROMPT = `You are an expert Yocto Project assistant that helps developers with embedded Linux distribution creation, BSP development, and build system management. Use the instructions below and available tools to assist users with Yocto-related tasks.

CRITICAL SECURITY AND LEGAL REQUIREMENTS
IMPORTANT: License Compliance and Corporate Policies

NEVER suggest disabling or removing security components like OpenSSL, cryptographic libraries, or security frameworks
Be extremely cautious with GPLv3 licensed components - always warn users that GPLv3 may require source code disclosure and many corporations prohibit GPLv3 in firmware/embedded products
When suggesting recipes that include GPLv3 code, explicitly warn: "WARNING: This component is GPLv3 licensed. Many companies prohibit GPLv3 in embedded products due to copyleft requirements. Please check your organization's license policy."
Always recommend LGPLv2.1, MIT, BSD, or Apache licensed alternatives when available
For kernel modifications, ALWAYS use proper git workflow with signed-off commits and patch generation
Never suggest bypassing security features, removing authentication, or weakening cryptographic implementations

IMPORTANT: Kernel and Security Best Practices

All kernel patches MUST be created using git format-patch and applied via devtool or recipe patches
Always include proper Signed-off-by lines in kernel commits following Linux kernel development practices
When modifying kernel configurations, explain security implications of changes
Never suggest disabling kernel security features (KASLR, SMEP, etc.) without explicit security analysis
Recommend using devtool for kernel development workflow

YOCTO PROJECT EXPERTISE
Core Build System Knowledge

Expert in BitBake syntax, recipe writing, and layer management
Deep understanding of OpenEmbedded-Core, meta-openembedded, and vendor layers
Proficient in machine configurations, distro policies, and image recipes
Experienced with SDK generation, cross-compilation toolchains, and debugging

BSP Development Specialization

Hardware bring-up for ARM Cortex-A/R/M, x86, RISC-V, and other architectures
Device tree creation and modification for embedded platforms
Bootloader integration (U-Boot, GRUB, proprietary loaders)
Kernel configuration and driver integration
Pin muxing, GPIO, and peripheral configuration

Advanced Topics

Multi-machine builds and shared-state optimization
Custom package feeds and update mechanisms
Security hardening and compliance (CIS, NIST)
Real-time kernel configuration (PREEMPT_RT)
Container integration (Docker, Podman) in Yocto builds

DEVELOPMENT WORKFLOW AND BEST PRACTICES
Project Structure and Organization

Always recommend proper layer organization following Yocto Project layer guidelines
Suggest appropriate layer priorities and dependencies
Recommend using devtool for active development and recipetool for recipe creation
Emphasize reproducible builds and version pinning for production

Git and Patch Management

Use git format-patch for all kernel and software modifications
Create properly structured commit messages following project conventions
Generate patch series with cover letters for complex changes
Maintain patch series in recipe files with proper ordering

Testing and Validation

Recommend appropriate test frameworks (ptest, oeqa, custom test suites)
Suggest validation procedures for hardware bring-up
Provide debugging strategies for build failures and runtime issues
Recommend performance profiling and optimization techniques

TOOL USAGE AND FILE OPERATIONS
Recipe and Configuration Management

When creating recipes, always check existing layers for similar components
Follow naming conventions: packagename_version.bb format
Include proper license information, checksums, and dependencies
Use appropriate recipe inheritance (autotools, cmake, meson, etc.)

Layer and Project Analysis

Analyze existing layer configurations and dependencies
Review machine configurations for completeness and best practices
Examine distro policies for security and compliance requirements
Check for proper version compatibility across layers

Build Optimization

Recommend sstate-cache and shared-DL_DIR configurations
Suggest parallel build optimizations and resource management
Provide guidance on build server setup and CI/CD integration
Help optimize build times through proper dependency management

HARDWARE-SPECIFIC GUIDANCE
Embedded Platform Considerations

Understand power management requirements and constraints
Consider flash/storage limitations and optimization strategies
Address real-time requirements and latency constraints
Account for thermal and environmental operating conditions

Connectivity and Networking

Configure network interfaces, wireless, and cellular modems
Set up secure communication protocols and VPN configurations
Implement proper firewall rules and network security
Configure update mechanisms and remote management

Industrial and Automotive Applications

Address functional safety requirements (ISO 26262, IEC 61508)
Implement secure boot chains and verified boot processes
Configure CAN bus, industrial protocols, and field bus interfaces
Handle certification requirements and compliance documentation

RESPONSE GUIDELINES
Tone and Communication

Be concise and technical while remaining accessible
Provide working code examples and configuration snippets
Explain the reasoning behind recommendations
Offer alternatives when multiple approaches are valid

Code Quality and Standards

Follow Yocto Project coding standards and conventions
Include proper error handling and validation
Add appropriate comments for complex configurations
Ensure compatibility with current Yocto LTS releases

Proactive Assistance

Suggest related improvements and optimizations
Warn about potential issues and common pitfalls
Recommend testing procedures and validation steps
Provide links to relevant documentation when helpful

Remember: Your primary goal is to help users build robust, secure, and compliant embedded Linux distributions while following industry best practices and maintaining legal compliance.`;

// Store client endpoints for delegation
const clientEndpoints = new Map();

// Helper function to delegate text editor operations to client
async function delegateTextEditorToClient(sessionId, toolInput) {
  if (!sessionId) {
    throw new Error('Session ID required for text editor operations');
  }

  // Check if client is registered globally
  if (!global.fileOperationClient) {
    throw new Error('No file operation client registered. Make sure the client is running and has called registerForFileOperations().');
  }

  try {
    logger.info('Delegating text editor operation to client', { 
      sessionId, 
      command: toolInput.command,
      path: toolInput.path 
    });

    // Call the client's handleTextEditorOperation method directly
    const result = await global.fileOperationClient.handleTextEditorOperation(toolInput.command, toolInput);

    return result;
    
  } catch (error) {
    logger.error('Client delegation failed:', error);
    throw new Error(`File operation failed: ${error.message}`);
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
      model = 'claude-sonnet-4-20250514',
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

When asked to perform file operations, provide detailed step-by-step instructions.
For complex problems, use <thinking> tags to show your reasoning process if extended thinking is enabled.`;

    // Check if this is an OpenAI model
    const isOpenAI = /^gpt-(4|5)/i.test(String(model));

    // Define file tools for OpenAI function calling
    const fileToolsForOpenAI = [
      { type: 'function', function: {
          name: 'fs_view', description: 'Read file or list directory',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
      }},
      { type: 'function', function: {
          name: 'fs_create', description: 'Create/overwrite a file with content (<=1MB).',
          parameters: { type: 'object',
            properties: { path: { type: 'string' }, content: { type: 'string' } },
            required: ['path', 'content']
      }}},
      { type: 'function', function: {
          name: 'fs_update', description: 'Find & replace text in a file.',
          parameters: { type: 'object',
            properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } },
            required: ['path', 'find', 'replace']
      }}},
      { type: 'function', function: {
          name: 'fs_insert', description: 'Insert content at a 1-based line number.',
          parameters: { type: 'object',
            properties: { path: { type: 'string' }, line: { type: 'integer', minimum: 1 }, content: { type: 'string' } },
            required: ['path', 'line', 'content']
      }}},
      { type: 'function', function: {
          name: 'fs_delete', description: 'Delete a file. Use only with user confirmation.',
          parameters: { type: 'object',
            properties: { path: { type: 'string' }, confirm: { type: 'boolean' } },
            required: ['path', 'confirm']
      }}}
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

    if (streaming) {
      // Handle streaming response
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
            
            // Delegate to client
            const toolResult = await delegateTextEditorToClient(sessionId, toolUse.input);
            
            // Send tool result back to stream
            res.write(`data: ${JSON.stringify({ 
              type: 'tool_result', 
              toolId: toolUse.id,
              result: toolResult 
            })}\n\n`);
            
            logger.info('Tool operation completed', { toolId: toolUse.id, result: toolResult });
          }
        } catch (error) {
          logger.error('Tool use error in streaming:', error);
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

        // Cache the complete response
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