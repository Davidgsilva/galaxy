# 🚀 Beacon - AI-Powered Yocto Project Assistant

Beacon is an intelligent CLI tool designed specifically for embedded developers working with Yocto Project builds across different silicon platforms. It leverages Claude AI (Sonnet 4/Opus 4) to automate and streamline the complex process of setting up custom Linux distributions for embedded hardware.

## ✨ Key Features

### 🧠 **AI-Powered Intelligence**
- **Yocto Project Expert**: Deep knowledge of BitBake, OpenEmbedded, and BSP development
- **Hardware-Aware**: Understands silicon vendor requirements and board specifications
- **License Compliance**: Automatic GPLv3 detection and corporate policy enforcement
- **Security-First**: Built-in security best practices and vulnerability awareness

### 💾 **Silicon Platform Support**
- **Tier 1**: NXP i.MX, AMD/Xilinx Zynq, Texas Instruments, Broadcom, Intel
- **500+ Development Boards**: Comprehensive hardware specification database
- **BSP Integration**: Automatic layer detection and compatibility checking
- **Vendor Tools**: Integration with platform-specific development tools

### 🔧 **Core Capabilities**
- **Project Initialization**: AI-guided setup with silicon-specific recommendations
- **Recipe Generation**: BitBake-compliant recipes with license compliance
- **Build Debugging**: Intelligent error diagnosis and automated fixes
- **Machine Configuration**: Hardware-aware BSP and device tree generation
- **Layer Management**: Automatic dependency resolution and compatibility

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/beacon-yocto/beacon-cli.git
cd beacon-cli

# Install dependencies
npm install

# Initialize configuration
npm run setup

# Start proxy server
npm start

# Use CLI (in another terminal)
npx beacon --help
```

### Basic Usage

```bash
# Interactive project setup
beacon init --interactive

# Quick machine-specific initialization  
beacon init --board="imx8mp-evk" --silicon="nxp" --features="qt5,wifi,canbus"

# Recipe creation with AI assistance
beacon recipe --create "opencv-cuda" --type="library"

# Interactive chat with Yocto expert
beacon chat --context --thinking

# Build debugging
beacon debug --logs --recipe="my-custom-app"

# License compliance check
beacon recipe --license-check "gstreamer-recipe"

# Silicon platform information
beacon silicon --show nxp --boards
```

## 📋 Commands Reference

### Project Management
```bash
beacon init [options]              # Initialize new Yocto project
beacon config [options]            # Configuration management
beacon doctor                      # System health check
beacon analyze [options]           # Project analysis
```

### Hardware & BSP
```bash
beacon silicon [options]           # Silicon platform information
beacon machine [options]           # Machine configuration management
beacon layer [options]             # Layer and BSP operations
```

### Development
```bash
beacon recipe [options]            # Recipe generation and management
beacon build [options]             # Build management and optimization
beacon debug [options]             # Build debugging and troubleshooting
```

### Security & Compliance
```bash
beacon security [options]          # Security analysis and hardening
beacon recipe --license-check      # License compliance checking
```

### Interactive Features
```bash
beacon chat [options]              # Interactive AI assistant
beacon                             # Start interactive mode
```

## 🏗️ Architecture

### CLI Application (Node.js)
- **Commander.js**: Robust command-line interface
- **Interactive Setup**: Guided project initialization
- **Context Awareness**: Automatic Yocto project detection
- **Real-time Feedback**: Progress indicators and streaming responses

### Proxy Server (Node.js/Express)
- **Anthropic API Integration**: Claude Sonnet 4 & Opus 4 models
- **Advanced Features**: Prompt caching, extended thinking, streaming
- **Security**: Rate limiting, input validation, CORS policies
- **Performance**: Connection pooling, request deduplication

### AI Integration
- **Specialized System Prompts**: Yocto Project expertise embedded
- **License Compliance**: Automatic GPLv3 detection and warnings
- **Security Best Practices**: Kernel security, secure boot, cryptography
- **Hardware Intelligence**: Silicon-specific recommendations

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

## 🌐 Silicon Platform Coverage

### Tier 1 Support (Primary Focus)
- **NXP i.MX Series**: i.MX6, i.MX8M Mini/Nano/Plus, i.MX8MP, i.MX9
- **AMD/Xilinx Zynq**: UltraScale+, Versal, MPSoCs with FPGA fabric
- **Texas Instruments**: AM335x, AM57xx, AM64x, AM62x series
- **Broadcom**: Raspberry Pi SoCs, BCM2711, BCM2835 family
- **Intel/Altera**: x86/x64 embedded, Cyclone V SoC, Arria 10

### Architecture Support
- **ARM Cortex-A**: A53, A55, A72, A78 (32-bit and 64-bit)
- **ARM Cortex-R**: Real-time applications
- **ARM Cortex-M**: Microcontroller integration
- **x86/x64**: Intel Atom, Core series for embedded
- **RISC-V**: SiFive, Andes, custom implementations

## 📊 Industry Applications

### Automotive
- **ISO 26262 Compliance**: Functional safety requirements
- **CAN-FD Support**: Automotive networking protocols
- **ADAS Platforms**: Advanced driver assistance systems
- **Infotainment**: Qt5/6 multimedia frameworks

### Industrial IoT
- **IEC 61508 Compliance**: Industrial safety standards
- **Fieldbus Protocols**: Modbus, PROFINET, EtherCAT
- **Edge Computing**: Container support, OTA updates
- **Predictive Maintenance**: ML/AI acceleration

### Medical Devices
- **FDA Compliance**: Medical device software standards
- **Real-time Kernels**: PREEMPT_RT for critical timing
- **Security Hardening**: HIPAA compliance features
- **Wireless Connectivity**: Bluetooth Medical, WiFi

## 🔧 Development Workflow

### 1. Project Initialization
```bash
# Start with interactive setup
beacon init --interactive

# Or specify requirements directly
beacon init --board="imx8mp-evk" --silicon="nxp" --features="qt5,security,realtime"
```

### 2. Recipe Development
```bash
# Create new recipe with AI assistance
beacon recipe --create "sensor-driver" --type="kernel-module"

# Analyze existing recipe for compliance
beacon recipe --analyze "my-application" --license-check
```

### 3. Build & Debug
```bash
# Optimize build configuration
beacon build --optimize --parallel=8

# Debug build failures with AI
beacon debug --error="do_compile failed" --recipe="problematic-package"
```

### 4. Security & Compliance
```bash
# Run security audit
beacon security --scan --compliance=cis

# Check license compliance across project
beacon analyze --licenses --report
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run Yocto-specific tests
npm run test:yocto

# Lint code
npm run lint

# Build for production
npm run build
```

## 📚 Documentation

- [**Getting Started Guide**](docs/getting-started.md)
- [**API Reference**](docs/api-reference.md)
- [**Silicon Platform Guide**](docs/silicon-platforms.md)
- [**License Compliance**](docs/license-compliance.md)
- [**Security Best Practices**](docs/security.md)
- [**Troubleshooting**](docs/troubleshooting.md)

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
```bash
git clone https://github.com/beacon-yocto/beacon-cli.git
cd beacon-cli
npm install
npm run dev
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Yocto Project Community**: For the incredible embedded Linux framework
- **Silicon Vendors**: NXP, Xilinx, TI, Broadcom, Intel for hardware support
- **Anthropic**: For Claude AI capabilities that power Beacon
- **OpenEmbedded Community**: For the foundational build system

## 📞 Support

- **Documentation**: https://beacon-yocto.github.io/docs
- **Issues**: https://github.com/beacon-yocto/beacon-cli/issues
- **Discussions**: https://github.com/beacon-yocto/beacon-cli/discussions
- **Discord**: https://discord.gg/beacon-yocto

---

**Built with ❤️ for the Embedded Linux Community**

*Beacon makes Yocto Project development accessible, secure, and efficient for teams of all sizes.*