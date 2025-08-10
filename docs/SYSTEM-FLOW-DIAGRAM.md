# Beacon System Flow Diagram

## High-Level Architecture

```mermaid
graph TB
    User[👤 User] --> CLI[🖥️ Beacon CLI]
    CLI --> Proxy[🌐 Proxy Server :3001]
    Proxy --> Claude[🤖 Anthropic Claude API]
    CLI --> LocalFS[💾 Local File System]
    Proxy --> Logs[📊 Winston Logs]
    
    subgraph "CLI Process"
        CLI --> APIClient[API Client]
        APIClient --> LocalFile[Local File Service]
        APIClient --> Prompts[Inquirer Prompts]
    end
    
    subgraph "Proxy Server"
        Proxy --> ChatRoutes[Chat Routes]
        Proxy --> FileRoutes[File Routes]
        Proxy --> BatchRoutes[Batch Routes]
        Proxy --> Cache[Response Cache]
        ChatRoutes --> AnthropicService[Anthropic Service]
    end
    
    subgraph "File Operations"
        LocalFile --> Create[📄 Create]
        LocalFile --> Read[📖 Read]
        LocalFile --> Update[✏️ Update]
        LocalFile --> Delete[🗑️ Delete]
    end
```

## Detailed Connection Flow

### 1. CLI Startup & WebSocket Registration

```mermaid
sequenceDiagram
    participant U as User
    participant CLI as Beacon CLI
    participant API as ApiClient
    participant WSC as WebSocket Client
    participant PS as Proxy Server
    participant WSH as WebSocket Handler
    
    U->>CLI: beacon "create yocto project"
    CLI->>API: new ApiClient()
    API->>API: Generate sessionId
    API->>WSC: new WebSocketFileClient(serverUrl, sessionId)
    API->>WSC: connect()
    WSC->>PS: WebSocket connection request
    PS->>WSH: Accept WebSocket connection
    WSH->>WSC: Connection established
    WSC->>WSH: Send registration message
    WSH->>WSH: Store client connection mapping
    WSH->>WSC: Registration success
    WSC->>API: Connection & registration confirmed
    CLI->>PS: Health check (/health)
    PS->>CLI: Server status OK
```

### 2. Chat Request Processing

```mermaid
sequenceDiagram
    participant CLI as Beacon CLI
    participant API as ApiClient
    participant PS as Proxy Server
    participant AS as AnthropicService
    participant Claude as Claude API
    participant Cache as Cache Service
    
    CLI->>API: sendMessage(message, options)
    API->>API: buildChatRequest()
    API->>PS: POST /api/chat
    Note over PS: Headers: x-session-id, Content-Type
    
    PS->>Cache: Check cache (if enabled)
    alt Cache Hit
        Cache->>PS: Cached response
        PS->>API: Return cached result
    else Cache Miss
        PS->>AS: createMessage(requestData)
        AS->>Claude: POST /v1/messages
        Claude->>AS: AI response
        AS->>PS: Processed response
        PS->>Cache: Store in cache
    end
    
    PS->>API: JSON response
    API->>CLI: Formatted response
    CLI->>U: Display result
```

### 3. Streaming Response Flow

```mermaid
sequenceDiagram
    participant CLI as Beacon CLI
    participant API as ApiClient
    participant PS as Proxy Server
    participant AS as AnthropicService
    participant Claude as Claude API
    
    CLI->>API: chatStream(requestData)
    API->>PS: POST /api/chat (streaming: true)
    Note over PS: Response headers: text/event-stream
    
    PS->>AS: createStreamingMessage()
    AS->>Claude: POST /v1/messages (stream: true)
    
    loop Streaming chunks
        Claude->>AS: Stream chunk
        AS->>PS: Process chunk
        
        alt Text chunk
            PS->>API: data: {"type":"text","content":"..."}
            API->>CLI: Write to stdout
        else Thinking chunk
            PS->>API: data: {"type":"thinking","content":"..."}
            API->>CLI: Display thinking (gray text)
        else Tool use chunk
            PS->>API: data: {"type":"tool_use","toolId":"..."}
            Note over API: Process tool delegation
        end
    end
    
    Claude->>AS: Stream end
    AS->>PS: Final data with usage stats
    PS->>API: data: {"type":"end","usage":{...}}
    API->>CLI: Complete stream processing
```

### 4. WebSocket-Based File Operation Delegation

```mermaid
sequenceDiagram
    participant Claude as Claude API
    participant PS as Proxy Server
    participant WSH as WebSocket Handler
    participant WS as WebSocket Connection
    participant CLI as CLI WebSocket Client
    participant LFS as LocalFileService
    participant FS as File System
    
    Note over Claude: AI decides to use file operation tool
    Claude->>PS: Tool use: fs_view/fs_create/fs_update
    PS->>WSH: delegateFileOperation(sessionId, operation, params)
    WSH->>WSH: Check client connection
    WSH->>WS: Send operation request with operationId
    WS->>CLI: WebSocket message: file_operation
    
    CLI->>CLI: handleFileOperation(data)
    alt View operation
        CLI->>LFS: readFile(path)
        LFS->>FS: Read file content
        FS->>LFS: File content
        LFS->>CLI: File data
    else Create operation
        CLI->>LFS: createFile(path, content)
        LFS->>FS: Write new file
        FS->>LFS: Success confirmation
        LFS->>CLI: Creation result
    else String replace operation
        CLI->>LFS: stringReplace(path, oldStr, newStr)
        LFS->>FS: Read, replace, write
        FS->>LFS: Update confirmation
        LFS->>CLI: Replace result
    else Insert operation
        CLI->>LFS: insertAtLine(path, text, line)
        LFS->>FS: Insert text at line
        FS->>LFS: Insert confirmation
        LFS->>CLI: Insert result
    end
    
    CLI->>WS: Send operation_result with operationId
    WS->>WSH: Receive result
    WSH->>PS: Return operation result
    PS->>Claude: Continue with tool result
    Claude->>PS: Final AI response
    PS->>CLI: Complete response via HTTP
```

### 5. Yocto Project Creation Flow

```mermaid
sequenceDiagram
    participant U as User
    participant CLI as Beacon CLI
    participant API as ApiClient
    participant PS as Proxy Server
    participant LFS as LocalFileService
    participant FS as File System
    participant Git as Git Repositories
    
    U->>CLI: beacon "create yocto project for raspberry pi"
    CLI->>CLI: isProjectCreationRequest() = true
    CLI->>CLI: Interactive prompts (machine, release, etc.)
    
    CLI->>API: generateYoctoProject(config)
    API->>PS: POST /api/chat (with project generation prompt)
    
    PS->>Claude: Create project with tools
    
    loop File creation operations
        Claude->>PS: Use text_editor tool
        PS->>API: Delegate file operation
        API->>LFS: Create project files
        LFS->>FS: Write files (setup.sh, README.md, configs)
        FS->>LFS: Confirm creation
        LFS->>API: File created
        API->>PS: Tool result
        PS->>Claude: Continue generation
    end
    
    Claude->>PS: Project generation complete
    PS->>API: Final response
    API->>CLI: Project created
    
    CLI->>FS: executeRepositorySetup()
    FS->>Git: Clone Yocto repositories
    Git->>FS: Repository files
    FS->>CLI: Setup complete
    
    CLI->>U: ✅ Project ready!
```

### 6. Error Handling & Retry Logic

```mermaid
sequenceDiagram
    participant CLI as Beacon CLI
    participant API as ApiClient
    participant PS as Proxy Server
    participant RL as Rate Limiter
    
    CLI->>API: makeRequest()
    
    loop Retry attempts (max 3)
        API->>PS: HTTP request
        
        alt Rate limited (429)
            PS->>RL: Check rate limit
            RL->>PS: Rate limit exceeded
            PS->>API: 429 Too Many Requests
            API->>API: wait(retryDelay * 2^attempt)
        else Connection refused
            PS--xAPI: ECONNREFUSED
            API->>API: wait(retryDelay * 2^attempt)
        else Success
            PS->>API: 200 OK response
            break
        else Client error (4xx)
            PS->>API: 4xx Client Error
            break No retry for client errors
        end
    end
    
    alt All retries failed
        API->>CLI: throw Error with helpful message
        CLI->>U: ❌ Error: Cannot connect to proxy server
    else Success
        API->>CLI: Return response
        CLI->>U: Display result
    end
```

## System Components Detail

### CLI Application (Node.js)
- **Entry Point**: `cli/index.js`
- **Main Class**: `BeaconYoctoCLI`
- **Key Features**:
  - Commander.js for CLI parsing
  - Inquirer prompts for interactivity
  - Chalk for colored output
  - Ora for loading spinners

### API Client Layer
- **File**: `cli/services/api-client.js`
- **Responsibilities**:
  - HTTP communication with proxy
  - Retry logic and error handling
  - File operation delegation
  - Streaming response handling

### Proxy Server (Express.js)
- **Entry Point**: `server/index.js`
- **Middleware Stack**:
  1. Helmet (security headers)
  2. CORS (cross-origin requests)
  3. Rate limiting (100 req/min per IP)
  4. Request logging
  5. JSON parsing (10MB limit)

### Route Handlers
- **Chat Routes** (`/api/chat`): AI interactions
- **File Routes** (`/api/files`): File operations
- **Batch Routes** (`/api/batch`): Multiple operations
- **Cache Routes** (`/api/cache`): Cache management

### Local File Service
- **File**: `cli/services/local-file-service.js`
- **Safety Features**:
  - Path traversal protection
  - File size validation
  - Permission checking
  - Error handling

## Data Flow Patterns

### 1. Request/Response Pattern
- CLI → API Client → Proxy Server → Anthropic API
- Synchronous for simple requests
- JSON-based communication

### 2. Streaming Pattern
- Server-Sent Events (SSE) from proxy
- Real-time text and thinking display
- Tool use processing during stream

### 3. Delegation Pattern
- Proxy server delegates file operations to CLI
- Uses global client registration
- Direct filesystem access from CLI

### 4. Caching Pattern
- Response-level caching in proxy
- Key-based cache invalidation
- 1-hour default TTL

## Security & Reliability

### Connection Security
- CORS configuration for allowed origins
- Rate limiting per IP address
- Request size limits (10MB)
- Security headers via Helmet.js

### Error Recovery
- Exponential backoff retry logic
- Graceful degradation for network issues
- Detailed error logging and reporting

### File Operation Safety
- Sandboxed to CLI process only
- Path validation and traversal protection
- No server-side file system access

This architecture provides a robust, secure, and scalable foundation for the Beacon AI-powered Yocto development assistant.