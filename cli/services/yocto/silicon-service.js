const fs = require('fs-extra');
const path = require('path');

class SiliconService {
  constructor() {
    this.platformsPath = path.join(__dirname, '../../../data/silicon/platforms.json');
    this.platformsData = null;
    this.loadPlatforms();
  }

  async loadPlatforms() {
    try {
      if (await fs.pathExists(this.platformsPath)) {
        const data = await fs.readJson(this.platformsPath);
        this.platformsData = data;
      } else {
        console.warn('Silicon platforms database not found');
        this.platformsData = { platforms: {}, meta_layers: {}, yocto_releases: {} };
      }
    } catch (error) {
      console.error('Error loading silicon platforms:', error.message);
      this.platformsData = { platforms: {}, meta_layers: {}, yocto_releases: {} };
    }
  }

  /**
   * Get information about a specific silicon platform
   */
  getPlatformInfo(vendorName) {
    if (!this.platformsData?.platforms) {
      return null;
    }

    const vendor = vendorName.toLowerCase();
    return this.platformsData.platforms[vendor] || null;
  }

  /**
   * Get all supported silicon platforms
   */
  getAllPlatforms() {
    if (!this.platformsData?.platforms) {
      return [];
    }

    return Object.entries(this.platformsData.platforms).map(([key, platform]) => ({
      id: key,
      name: platform.name,
      description: platform.description,
      website: platform.website,
      architectures: platform.architectures,
      seriesCount: Object.keys(platform.series || {}).length,
      machineCount: this.getMachineCountForPlatform(platform)
    }));
  }

  /**
   * Get supported machines for a platform
   */
  getSupportedMachines(vendorName = null) {
    if (!this.platformsData?.platforms) {
      return [];
    }

    const machines = [];
    const platforms = vendorName 
      ? { [vendorName]: this.platformsData.platforms[vendorName.toLowerCase()] }
      : this.platformsData.platforms;

    for (const [vendorKey, platform] of Object.entries(platforms)) {
      if (!platform || !platform.series) continue;

      for (const [seriesKey, series] of Object.entries(platform.series)) {
        if (!series.machines) continue;

        for (const [machineKey, machine] of Object.entries(series.machines)) {
          machines.push({
            id: machineKey,
            name: machine.name,
            vendor: platform.name,
            vendorKey,
            series: series.name,
            seriesKey,
            soc: machine.soc,
            architecture: series.architecture,
            cores: machine.cores,
            frequency: machine.frequency,
            memory: machine.memory,
            features: machine.features || [],
            description: `${machine.name} - ${machine.soc} (${series.architecture})`
          });
        }
      }
    }

    return machines.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get detailed machine information
   */
  getMachineInfo(machineName) {
    if (!this.platformsData?.platforms) {
      return null;
    }

    for (const [vendorKey, platform] of Object.entries(this.platformsData.platforms)) {
      for (const [seriesKey, series] of Object.entries(platform.series || {})) {
        const machine = series.machines?.[machineName];
        if (machine) {
          return {
            ...machine,
            vendor: platform.name,
            vendorKey,
            series: series.name,
            seriesKey,
            arch: series.architecture,
            layers: [machine.bsp_layer, ...(platform.layers ? Object.keys(platform.layers) : [])],
            compliance: platform.compliance || {},
            vendorTools: platform.vendor_tools || []
          };
        }
      }
    }

    return null;
  }

  /**
   * Get BSP layer information for a platform
   */
  getBspLayers(vendorName) {
    const platform = this.getPlatformInfo(vendorName);
    if (!platform?.layers) {
      return [];
    }

    return Object.entries(platform.layers).map(([layerName, layerInfo]) => ({
      name: layerName,
      description: layerInfo.description,
      gitUrl: layerInfo.git_url,
      branches: layerInfo.branch_mapping || {},
      dependencies: layerInfo.dependencies || [],
      vendor: platform.name
    }));
  }

  /**
   * Get compatible Yocto releases for a platform
   */
  getCompatibleReleases(vendorName) {
    const platform = this.getPlatformInfo(vendorName);
    if (!platform?.layers) {
      return this.getAllYoctoReleases();
    }

    // Get releases supported by the main BSP layer
    const mainLayer = Object.values(platform.layers)[0];
    if (mainLayer?.branch_mapping) {
      const supportedReleases = Object.keys(mainLayer.branch_mapping);
      return this.getAllYoctoReleases().filter(release => 
        supportedReleases.includes(release.name)
      );
    }

    return this.getAllYoctoReleases();
  }

  /**
   * Get all Yocto releases
   */
  getAllYoctoReleases() {
    if (!this.platformsData?.yocto_releases) {
      return [];
    }

    return Object.entries(this.platformsData.yocto_releases).map(([name, release]) => ({
      name,
      version: release.version,
      status: release.status,
      releaseDate: release.release_date,
      lts: release.lts,
      supportUntil: release.support_until
    })).sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));
  }

  /**
   * Get recommended configuration for a machine
   */
  getRecommendedConfig(machineName, features = []) {
    const machineInfo = this.getMachineInfo(machineName);
    if (!machineInfo) {
      return null;
    }

    const config = {
      machine: machineName,
      distro: 'poky',
      layers: [
        'meta',
        'meta-poky',
        'meta-yocto-bsp'
      ],
      localConf: {
        MACHINE: machineName,
        DISTRO: 'poky'
      },
      bblayersConf: {
        layers: []
      }
    };

    // Add BSP layer
    if (machineInfo.bsp_layer) {
      config.layers.push(machineInfo.bsp_layer);
      config.bblayersConf.layers.push(`\${TOPDIR}/../meta-${machineInfo.bsp_layer.replace('meta-', '')}`);
    }

    // Add feature-specific layers and configurations
    features.forEach(feature => {
      switch (feature.toLowerCase()) {
        case 'qt':
        case 'qt5':
          config.layers.push('meta-qt5');
          config.localConf.DISTRO_FEATURES_append = ' qt5';
          break;
        case 'wifi':
          config.layers.push('meta-openembedded/meta-oe');
          config.localConf.DISTRO_FEATURES_append = ' wifi';
          config.localConf.IMAGE_INSTALL_append = ' iw wpa-supplicant';
          break;
        case 'bluetooth':
          config.layers.push('meta-openembedded/meta-oe');
          config.localConf.DISTRO_FEATURES_append = ' bluetooth';
          config.localConf.IMAGE_INSTALL_append = ' bluez5';
          break;
        case 'canbus':
          config.localConf.KERNEL_FEATURES_append = ' features/can/can.scc';
          config.localConf.IMAGE_INSTALL_append = ' can-utils';
          break;
        case 'security':
          config.layers.push('meta-security');
          config.localConf.DISTRO_FEATURES_append = ' security';
          break;
        case 'containers':
          config.layers.push('meta-virtualization');
          config.localConf.DISTRO_FEATURES_append = ' virtualization';
          config.localConf.IMAGE_INSTALL_append = ' docker';
          break;
        case 'realtime':
          config.layers.push('meta-realtime');
          config.localConf.PREFERRED_PROVIDER_virtual_kernel = 'linux-rt';
          break;
      }
    });

    // Architecture-specific optimizations
    if (machineInfo.arch === 'arm64') {
      config.localConf.DEFAULTTUNE = 'aarch64';
    } else if (machineInfo.arch === 'arm') {
      config.localConf.DEFAULTTUNE = 'armv7athf-neon';
    }

    // Memory-based optimizations
    if (machineInfo.memory && machineInfo.memory.includes('512MB')) {
      config.localConf.IMAGE_ROOTFS_SIZE = '2097152'; // 2GB
      config.localConf.IMAGE_OVERHEAD_FACTOR = '1.2';
    }

    return config;
  }

  /**
   * Detect hardware platform (placeholder - would use actual detection)
   */
  async detectHardware() {
    try {
      // This would implement actual hardware detection
      // For now, return a placeholder
      return {
        detected: false,
        reason: 'Hardware detection not implemented',
        suggestions: [
          'Check /proc/cpuinfo for processor information',
          'Look for device tree information in /proc/device-tree',
          'Check for vendor-specific files in /sys/firmware'
        ]
      };
    } catch (error) {
      return {
        detected: false,
        reason: error.message,
        suggestions: []
      };
    }
  }

  /**
   * Search machines by criteria
   */
  searchMachines(criteria = {}) {
    const machines = this.getSupportedMachines();
    
    return machines.filter(machine => {
      // Filter by vendor
      if (criteria.vendor && machine.vendorKey !== criteria.vendor.toLowerCase()) {
        return false;
      }

      // Filter by architecture
      if (criteria.architecture && machine.architecture !== criteria.architecture) {
        return false;
      }

      // Filter by features
      if (criteria.features && Array.isArray(criteria.features)) {
        const hasAllFeatures = criteria.features.every(feature => 
          machine.features.includes(feature.toLowerCase())
        );
        if (!hasAllFeatures) {
          return false;
        }
      }

      // Filter by core count
      if (criteria.minCores && machine.cores < criteria.minCores) {
        return false;
      }

      // Text search in name or description
      if (criteria.search) {
        const searchTerm = criteria.search.toLowerCase();
        const searchableText = `${machine.name} ${machine.description} ${machine.soc}`.toLowerCase();
        if (!searchableText.includes(searchTerm)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get vendor tools for a platform
   */
  getVendorTools(vendorName) {
    const platform = this.getPlatformInfo(vendorName);
    return platform?.vendor_tools || [];
  }

  /**
   * Get compliance standards for a platform
   */
  getComplianceInfo(vendorName) {
    const platform = this.getPlatformInfo(vendorName);
    return platform?.compliance || {};
  }

  /**
   * Generate machine configuration template
   */
  generateMachineConfig(machineName, customizations = {}) {
    const machineInfo = this.getMachineInfo(machineName);
    if (!machineInfo) {
      return null;
    }

    const config = `#@TYPE: Machine
#@NAME: ${machineInfo.name}
#@DESCRIPTION: Machine configuration for ${machineInfo.name}

MACHINEOVERRIDES =. "${machineName}:"

require conf/machine/include/${machineInfo.seriesKey}.inc

KERNEL_IMAGETYPE = "Image"
KERNEL_DEVICETREE = "${machineInfo.devicetree || `${machineName}.dtb`}"

SERIAL_CONSOLES = "115200;ttymxc0"
SERIAL_CONSOLES_CHECK = "\${SERIAL_CONSOLES}"

# Bootloader
PREFERRED_PROVIDER_virtual/bootloader = "${machineInfo.bootloader || 'u-boot'}"
PREFERRED_PROVIDER_u-boot = "${machineInfo.bootloader || 'u-boot'}"

# Default kernel
PREFERRED_PROVIDER_virtual/kernel = "linux-${machineInfo.vendorKey}"

# Machine features
MACHINE_FEATURES = "alsa bluetooth ethernet pci serial usbgadget usbhost vfat wifi"

# Extra features based on hardware capabilities
${machineInfo.features.includes('can') ? 'MACHINE_FEATURES += "can"' : ''}
${machineInfo.features.includes('4k-video') ? 'MACHINE_FEATURES += "screen"' : ''}
${machineInfo.gpu ? 'MACHINE_FEATURES += "gpu"' : ''}

# Image formats
IMAGE_FSTYPES = "tar.xz ext4 sdcard"

# Custom settings
${Object.entries(customizations).map(([key, value]) => `${key} = "${value}"`).join('\n')}
`;

    return {
      filename: `${machineName}.conf`,
      content: config,
      path: `conf/machine/${machineName}.conf`
    };
  }

  /**
   * Helper method to count machines for a platform
   */
  getMachineCountForPlatform(platform) {
    let count = 0;
    for (const series of Object.values(platform.series || {})) {
      count += Object.keys(series.machines || {}).length;
    }
    return count;
  }

  /**
   * Get platform statistics
   */
  getStatistics() {
    if (!this.platformsData?.platforms) {
      return {
        totalPlatforms: 0,
        totalMachines: 0,
        totalSeries: 0,
        architectures: [],
        vendors: []
      };
    }

    const platforms = this.platformsData.platforms;
    let totalMachines = 0;
    let totalSeries = 0;
    const architectures = new Set();
    const vendors = [];

    for (const [vendorKey, platform] of Object.entries(platforms)) {
      vendors.push({
        key: vendorKey,
        name: platform.name,
        description: platform.description
      });

      platform.architectures?.forEach(arch => architectures.add(arch));
      
      for (const series of Object.values(platform.series || {})) {
        totalSeries++;
        totalMachines += Object.keys(series.machines || {}).length;
      }
    }

    return {
      totalPlatforms: Object.keys(platforms).length,
      totalMachines,
      totalSeries,
      architectures: Array.from(architectures),
      vendors,
      yoctoReleases: Object.keys(this.platformsData.yocto_releases || {}).length
    };
  }

  /**
   * Validate machine configuration
   */
  validateMachineConfig(machineName, config = {}) {
    const machineInfo = this.getMachineInfo(machineName);
    if (!machineInfo) {
      return {
        valid: false,
        errors: [`Machine '${machineName}' not found in database`],
        warnings: []
      };
    }

    const errors = [];
    const warnings = [];

    // Check for required BSP layers
    if (!config.layers?.includes(machineInfo.bsp_layer)) {
      errors.push(`Missing required BSP layer: ${machineInfo.bsp_layer}`);
    }

    // Check architecture compatibility
    if (config.DEFAULTTUNE) {
      const archMap = {
        'arm': ['armv7', 'armv6', 'armv5'],
        'arm64': ['aarch64'],
        'x86_64': ['x86-64', 'core2-64']
      };
      
      const compatibleTunes = archMap[machineInfo.arch] || [];
      if (!compatibleTunes.some(tune => config.DEFAULTTUNE.includes(tune))) {
        warnings.push(`DEFAULTTUNE '${config.DEFAULTTUNE}' may not be optimal for ${machineInfo.arch} architecture`);
      }
    }

    // Check memory constraints
    if (machineInfo.memory && config.IMAGE_ROOTFS_SIZE) {
      const memoryMB = parseInt(machineInfo.memory.match(/(\d+)MB/)?.[1] || '0');
      const rootfsSizeMB = parseInt(config.IMAGE_ROOTFS_SIZE) / 1024;
      
      if (rootfsSizeMB > memoryMB * 0.8) {
        warnings.push(`IMAGE_ROOTFS_SIZE (${rootfsSizeMB}MB) is large relative to available memory (${memoryMB}MB)`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}

module.exports = SiliconService;