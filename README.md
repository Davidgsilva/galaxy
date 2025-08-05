# 🚀 Beacon - AI-Powered Yocto Project Assistant

Beacon is a conversational AI CLI tool for embedded Linux developers, like "Lovable for Yocto Project". Chat with an AI expert to build custom Linux distributions, debug BitBake issues, create recipes, and manage embedded development workflows. Powered by Claude AI with deep Yocto Project expertise.

## ✨ Key Features

### 💬 **Conversational Interface**
- **Chat-Only CLI**: Simple interface like `claude` or `gemini` - just ask questions
- **Natural Language**: Describe what you need in plain English
- **Real-time Streaming**: Get responses as they're generated
- **File Operations**: Read, write, and modify local files through conversation

### 🧠 **Yocto Project Expertise**
- **BitBake & OpenEmbedded**: Deep knowledge of build systems and recipes
- **BSP Development**: Machine configurations, device trees, kernel customization
- **License Compliance**: Automatic GPLv3 detection and corporate policy warnings
- **Security Best Practices**: Kernel hardening, secure boot, cryptography guidance

### 🔧 **Development Capabilities**
- **Recipe Creation**: Generate BitBake recipes with proper syntax and dependencies
- **Build Debugging**: Intelligent error diagnosis and step-by-step fixes
- **Layer Management**: Understand dependencies and compatibility
- **Hardware Agnostic**: Works with any embedded platform or architecture

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/beacon-yocto/beacon-cli.git
cd beacon-cli

# Install dependencies
npm install

# Start the proxy server (in one terminal)
npm start

# Use the CLI (in another terminal)
beacon "Help me create a Qt5 recipe for ARM64"
```

### Basic Usage

```bash
# Ask questions directly (like Claude CLI)
beacon "Create a BitBake recipe for OpenCV with CUDA support"
beacon "Help me debug this do_compile error in my kernel module"
beacon "Set up WiFi drivers for i.MX8MP board"
beacon "Optimize my Yocto build for faster compilation"

# Interactive chat mode
beacon
> How do I add CAN bus support to my embedded Linux?
> Create a machine configuration for my custom ARM board
> What's the best way to handle GPLv3 compliance?
> exit

# Get help
beacon help
beacon --help
```

## 💬 Chat Interface

### Simple Conversational Commands
```bash
# Single message (like claude CLI)
beacon "your question or request"

# Interactive mode
beacon

# Show help
beacon help
```

### Options
```bash
-s, --streaming        # Enable real-time streaming (default: true)
-t, --thinking         # Enable extended AI thinking
-m, --model <model>    # Choose AI model (default: claude-sonnet-4)
--temperature <temp>   # AI creativity level (0.0-1.0)
--proxy-url <url>      # Proxy server URL
-v, --verbose          # Show detailed information
```

### Example Conversations
```bash
# Recipe Development
beacon "Create a recipe for nginx with SSL support"
beacon "Add systemd service integration to my recipe"

# Build Issues
beacon "My BitBake build fails with 'do_compile' error"
beacon "How do I fix missing dependencies in my layer?"

# BSP Development
beacon "Generate device tree entries for SPI interface"
beacon "Create machine config for custom ARM Cortex-A53 board"

# License & Security
beacon "Check my recipe for GPL compliance issues"
beacon "Add security hardening to my kernel configuration"
```

## 🏗️ Architecture

```
┌─────────────┐    HTTP/JSON    ┌──────────────┐    API Calls    ┌─────────────┐
│   Beacon    │ ──────────────> │ Proxy Server │ ──────────────> │  Anthropic  │
│  CLI Tool   │                 │ (Node.js)    │                 │   Claude    │
└─────────────┘                 └──────────────┘                 └─────────────┘
```

### CLI Application (Node.js)
- **Simple Chat Interface**: Like `claude` or `gemini` CLI tools
- **Streaming Responses**: Real-time text output as AI generates responses
- **File Operations**: Text editor tool for reading/writing local files
- **Context Management**: Maintains conversation history

### Proxy Server (Node.js/Express)
- **Anthropic API Integration**: Claude Sonnet 4 with text editor capabilities
- **Yocto Expertise**: Specialized system prompts for embedded Linux
- **Security**: Rate limiting, input validation, CORS policies
- **Performance**: Caching, streaming, error handling

### AI Capabilities
- **Text Editor Tool**: Can create, read, update, delete local files
- **Yocto Specialization**: Deep BitBake, OpenEmbedded, BSP knowledge
- **License Compliance**: Automatic GPLv3 detection and warnings
- **Security Best Practices**: Kernel hardening, secure boot guidance

## 🔒 Security & Compliance

### License Compliance
- **GPLv3 Detection**: Automatic identification and corporate warnings
- **Alternative Suggestions**: MIT, BSD, Apache alternatives provided
- **Corporate Policies**: Configurable license approval workflows
- **Audit Trails**: Complete license compliance reporting

### Security Features
- **Kernel Security**: KASLR, SMEP, signed commits enforcement
- **Secure Boot**: Chain of trust and verified boot processes
- **Input Validation**: Protection against path traversal and injection
- **API Security**: Rate limiting, authentication, secure headers

## 🌐 Platform & Architecture Support

### Hardware Agnostic Design
Beacon works with **any embedded platform** - just describe your hardware in conversation:

```bash
beacon "I have a custom ARM Cortex-A78 board with WiFi and CAN"
beacon "Help me configure Yocto for RISC-V processor"
beacon "Set up build for x86-64 industrial gateway"
```

### Common Platforms Beacon Knows
- **ARM**: Cortex-A/R/M series, custom SoCs
- **x86/x64**: Intel Atom, Core, embedded processors
- **RISC-V**: SiFive, Andes, custom implementations
- **Vendor SoCs**: NXP i.MX, TI AM/DM, Xilinx Zynq, Broadcom, Qualcomm
- **Development Boards**: Raspberry Pi, BeagleBone, evaluation kits

### Industry Applications
- **Automotive**: ADAS, infotainment, ECUs, telematics
- **Industrial IoT**: Gateways, PLCs, HMIs, sensors
- **Medical Devices**: Patient monitors, diagnostic equipment
- **Consumer Electronics**: Smart home, wearables, appliances

## 💡 What Beacon Can Help With

### Recipe Development
- Create BitBake recipes with proper syntax and dependencies
- Add license information and compliance checking
- Integrate systemd services, kernel modules, applications
- Handle complex build requirements and patches

### Build System Management
- Debug BitBake errors and build failures
- Optimize build performance and caching
- Manage layer dependencies and compatibility
- Configure machine and distro settings

### BSP & Kernel Development
- Create machine configurations for custom hardware
- Generate device tree entries and modifications
- Configure kernel features and drivers
- Set up bootloader integration (U-Boot, GRUB)

### Security & Compliance
- Detect GPLv3 licenses and suggest alternatives
- Implement security hardening and best practices
- Configure secure boot and cryptographic features
- Ensure compliance with industry standards

## 🔧 Development Workflow

### 1. Start the Server
```bash
# Terminal 1: Start proxy server
npm start
```

### 2. Chat with Beacon
```bash
# Terminal 2: Ask questions naturally
beacon "I need to create a Yocto project for automotive ECU"
beacon "Help me set up Qt5 with CAN bus support"
beacon "My build fails with missing dependencies"
```

### 3. File Operations
```bash
# Beacon can read/write files through conversation
beacon "Look at my local.conf and suggest optimizations"
beacon "Create a BitBake recipe for my sensor driver"
beacon "Fix the syntax errors in my machine configuration"
```

### 4. Interactive Development
```bash
# Start interactive chat session
beacon
> Create a recipe for OpenSSL with hardware acceleration
> Add systemd integration to this recipe
> Check for license compliance issues
> Generate unit tests for my embedded application
> exit
```

## 🧪 Development

```bash
# Development mode (auto-restart server)
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Check server health
curl http://localhost:3001/health
```

## 🔧 Configuration

### Environment Setup
Create a `.env` file with your Anthropic API key:
```bash
ANTHROPIC_API_KEY=your-api-key-here
```

### Server Configuration
The proxy server runs on port 3001 by default. Configure with environment variables:
```bash
PORT=3001                    # Server port
ALLOWED_ORIGINS=*           # CORS origins
NODE_ENV=development        # Environment
```

## 🚨 Limitations

- **Requires Network**: Needs internet connection for AI responses
- **API Costs**: Uses Anthropic Claude API (paid service)
- **Local Files Only**: Text editor tool works with local filesystem
- **No Build Execution**: Provides guidance but doesn't run BitBake builds

## 🤝 Contributing

```bash
git clone https://github.com/beacon-yocto/beacon-cli.git
cd beacon-cli
npm install
npm run dev  # Start development server
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Yocto Project Community**: For the incredible embedded Linux framework
- **Silicon Vendors**: NXP, Xilinx, TI, Broadcom, Intel for hardware support
- **Anthropic**: For Claude AI capabilities that power Beacon
- **OpenEmbedded Community**: For the foundational build system

## 📞 Support

- **Issues**: Report bugs and feature requests
- **Discussions**: Ask questions and share experiences
- **Examples**: See common use cases and workflows

---

**Built with ❤️ for the Embedded Linux Community**

*"Lovable for Yocto" - Chat with AI to build embedded Linux distributions faster and easier.*