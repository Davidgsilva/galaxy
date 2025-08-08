# Beacon API Documentation

## Overview

Beacon is an AI-powered CLI tool for Yocto Project embedded development. The system consists of:

1. **CLI Client** (`cli/index.js`) - Node.js command-line interface
2. **Proxy Server** (`server/index.js`) - Express.js API server
3. **Local File Service** - Direct filesystem operations
4. **Anthropic AI Integration** - Claude AI for assistance

## Architecture Flow

```
┌─────────────────┐    HTTP/JSON     ┌─────────────────┐    API Calls    ┌─────────────┐
│   Beacon CLI    │ ──────────────>  │  Proxy Server   │ ──────────────> │  Anthropic  │
│                 │                  │  (Port 3001)    │                 │   Claude    │
│ • User Input    │                  │                 │                 │             │
│ • Local Files   │                  │ • Rate Limiting │                 │             │
│ • Streaming     │                  │ • Usage Logging │                 │             │
│ • File Ops      │ <──────────────  │ • Tool Routing  │                 │             │
└─────────────────┘                  └─────────────────┘                 └─────────────┘
         │                                     │
         ▼                                     ▼
┌─────────────────┐                  ┌─────────────────┐
│ Local File      │                  │    Winston      │
│ Service         │                  │   Logging       │
│                 │                  │                 │
│ • Direct I/O    │                  │ • error.log     │
│ • Path Safety   │                  │ • usage.log     │
│ • Validation    │                  │ • combined.log  │
└─────────────────┘                  └─────────────────┘
```

## Core API Endpoints

### Base URL
- Development: `http://localhost:3001`
- Production: Set via `BEACON_PROXY_URL` environment variable

### Authentication
- Session-based using `x-session-id` header
- No API keys required for CLI client

---

## 🗣️ Chat API

### POST `/api/chat`
Primary AI interaction endpoint for conversational assistance.

**Request Body:**
```json
{
  "message": "string",           // User input message
  "context": "array",            // Previous conversation context
  "model": "string",             // AI model (default: claude-sonnet-4-20250514)
  "temperature": "number",       // AI creativity (0.0-1.0, default: 0.1)
  "maxTokens": "number",         // Response length limit (default: 8192)
  "streaming": "boolean",        // Enable streaming response (default: false)
  "extendedThinking": "boolean", // Enable thinking mode (default: false)
  "useCache": "boolean",         // Use response caching (default: true)
  "useYoctoPrompt": "boolean",   // Use Yocto-specific system prompt
  "tools": "array"               // Available tools for AI
}
```

**Response (Non-streaming):**
```json
{
  "success": true,
  "response": "AI response text",
  "usage": {
    "input_tokens": 150,
    "output_tokens": 300
  },
  "model": "claude-sonnet-4-20250514",
  "toolUses": [],
  "citations": [],
  "timestamp": "2025-01-01T12:00:00Z"
}
```

**Response (Streaming):**
Server-Sent Events with following event types:
```json
{ "type": "text", "content": "response chunk" }
{ "type": "thinking", "content": "AI thinking process" }
{ "type": "tool_use", "toolId": "id", "name": "tool_name", "input": {...} }
{ "type": "tool_result", "toolId": "id", "result": {...} }
{ "type": "end", "fullResponse": "complete response", "usage": {...} }
{ "type": "error", "error": "error message" }
```

### GET `/api/chat/history`
Retrieve conversation history.

**Query Parameters:**
- `limit` (number): Number of entries (default: 50)
- `offset` (number): Pagination offset (default: 0)  
- `yoctoOnly` (boolean): Filter Yocto-specific conversations

**Response:**
```json
{
  "success": true,
  "history": [],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 0
  }
}
```

### GET `/api/chat/models`
List available AI models and their capabilities.

**Response:**
```json
{
  "success": true,
  "models": [
    {
      "name": "claude-sonnet-4-20250514",
      "context_window": 200000,
      "max_output": 8192,
      "supports_tools": true
    }
  ],
  "recommended": {
    "yocto": "claude-sonnet-4-20250514",
    "complex": "claude-opus-4-20250514",
    "general": "claude-sonnet-4-20250514"
  }
}
```

---

## 🍳 Yocto-Specific Endpoints

### POST `/api/chat/yocto/analyze-project`
Analyze Yocto project structure and configuration.

**Request Body:**
```json
{
  "projectPath": "/path/to/yocto/project",
  "analysisType": "general" | "security" | "compliance" | "performance"
}
```

**Response:**
```json
{
  "success": true,
  "analysis": "Detailed project analysis text",
  "analysisType": "general",
  "projectPath": "/path/to/yocto/project",
  "usage": {...},
  "timestamp": "2025-01-01T12:00:00Z"
}
```

### POST `/api/chat/yocto/recipe-help`
Generate BitBake recipes with AI assistance.

**Request Body:**
```json
{
  "recipeName": "my-application",
  "recipeType": "application" | "library" | "kernel-module",
  "requirements": "Detailed recipe requirements"
}
```

**Response:**
```json
{
  "success": true,
  "recipe": "Complete BitBake recipe content",
  "recipeName": "my-application",
  "recipeType": "application",
  "usage": {...}
}
```

### POST `/api/chat/yocto/build-debug`
Debug BitBake build issues with AI analysis.

**Request Body:**
```json
{
  "buildLog": "BitBake build log content",
  "errorDescription": "Brief error description",
  "recipeName": "failing-recipe"
}
```

**Response:**
```json
{
  "success": true,
  "analysis": "Build failure analysis and solutions",
  "recipeName": "failing-recipe",
  "usage": {...}
}
```

---

## 📁 File Operations API

### POST `/api/files/register-client`
Register CLI client for file operation delegation.

**Request Body:**
```json
{
  "sessionId": "session_id",
  "clientId": "client_id"
}
```

### POST `/api/files/text-editor/:operation`
Execute text editor operations (delegated to CLI client).

**Headers:**
- `x-session-id`: Client session ID

**Supported Operations:**
- `view` - Read file or list directory
- `create` - Create new file
- `str_replace` - Replace text in file
- `insert` - Insert text at line

**Request Body (varies by operation):**
```json
{
  "path": "/path/to/file",
  "old_str": "text to replace",
  "new_str": "replacement text",
  "file_text": "file content",
  "insert_line": 10
}
```

### GET `/api/files/client-status/:sessionId`
Check client registration status.

---

## 🔧 System & Utility APIs

### GET `/health`
Server health check.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T12:00:00Z",
  "uptime": 3600.5,
  "version": "1.0.0"
}
```

### GET `/api/cache/status`
Cache status and statistics.

### POST `/api/cache/clear`
Clear response cache.

### POST `/api/batch`
Execute multiple operations in batch.

**Request Body:**
```json
{
  "operations": [
    {
      "type": "chat",
      "data": {...}
    }
  ]
}
```

---

## Error Handling

### HTTP Status Codes
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (invalid API key)
- `403` - Forbidden (access denied)
- `404` - Not Found (resource not found)
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error
- `502/503` - Service Unavailable

### Error Response Format
```json
{
  "success": false,
  "error": "Error title",
  "message": "Detailed error description",
  "timestamp": "2025-01-01T12:00:00Z"
}
```

---

## Rate Limiting

- **Limit**: 100 requests per 60 seconds per IP
- **Headers**: Standard rate limit headers included
- **Exceeded**: Returns 429 with retry-after header

---

## Logging & Monitoring

### Log Files
- `error.log` - Error-level events
- `combined.log` - All events
- `usage.log` - API usage metrics

### Usage Tracking
- Token consumption per request
- Model usage statistics
- Session-based metrics
- Duration tracking

### Log Format (JSON)
```json
{
  "level": "info",
  "message": "API_USAGE",
  "endpoint": "/api/chat",
  "method": "POST",
  "duration": 1250,
  "tokenUsage": {
    "input_tokens": 150,
    "output_tokens": 300
  },
  "model": "claude-sonnet-4-20250514",
  "sessionId": "session_123",
  "timestamp": "2025-01-01T12:00:00Z"
}
```

---

## Security Features

### Request Security
- Helmet.js security headers
- CORS configuration
- Request size limits (10MB)
- Rate limiting per IP

### Data Protection
- No persistent storage of conversations
- Temporary file operation caching
- Session-based client registration

### File Operation Safety
- Path traversal protection
- File size validation
- Permission checking
- Sandbox enforcement

---

## Configuration

### Environment Variables
```bash
# Server Configuration
PORT=3001
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000

# API Keys
ANTHROPIC_API_KEY=your-key-here

# Client Configuration
BEACON_PROXY_URL=http://localhost:3001
```

### CLI Options
```bash
beacon --help
  -s, --streaming        Enable streaming responses (default: true)
  -t, --thinking         Enable extended thinking mode
  -m, --model <model>    AI model to use
  --temperature <temp>   AI creativity level
  --proxy-url <url>      Proxy server URL
  -v, --verbose          Show detailed information
```

---

## Integration Examples

### Basic Chat Request
```javascript
const response = await fetch('http://localhost:3001/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-session-id': 'my-session-id'
  },
  body: JSON.stringify({
    message: "Help me create a BitBake recipe for nginx",
    useYoctoPrompt: true,
    streaming: false
  })
});

const result = await response.json();
console.log(result.response);
```

### Streaming Response
```javascript
const response = await fetch('http://localhost:3001/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream'
  },
  body: JSON.stringify({
    message: "Analyze my Yocto project",
    streaming: true
  })
});

const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = new TextDecoder().decode(value);
  const lines = chunk.split('\n');
  
  lines.forEach(line => {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      if (data.type === 'text') {
        console.log(data.content);
      }
    }
  });
}
```