const axios = require('axios');
const https = require('https');

class ProxmoxAPI {
  constructor(apiUrl, apiToken) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.apiToken = apiToken;
  }

  /**
   * Get headers for API requests
   * Proxmox API Token format: USER@REALM!TOKENID=SECRET
   */
  getHeaders() {
    return {
      'Accept': 'application/json',
      'Authorization': `PVEAPIToken=${this.apiToken}`
    };
  }

  /**
   * Make a request to Proxmox API
   */
  async request(method, endpoint, data = null) {
    try {
      const url = `${this.apiUrl}/api2/json${endpoint}`;
      const config = {
        method,
        url,
        headers: this.getHeaders(),
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);

      // Proxmox API returns data in response.data.data
      return response.data.data || response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`Proxmox API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      throw new Error(`Proxmox API Request Failed: ${error.message}`);
    }
  }

  /**
   * Get VM details by ID (format: node/vmid)
   */
  async getVM(node, vmid) {
    try {
      const endpoint = `/nodes/${node}/qemu/${vmid}/status/current`;
      return await this.request('GET', endpoint);
    } catch (error) {
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get VM configuration
   */
  async getVMConfig(node, vmid) {
    try {
      const endpoint = `/nodes/${node}/qemu/${vmid}/config`;
      return await this.request('GET', endpoint);
    } catch (error) {
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get VM status (running, stopped, etc.)
   */
  async getVMStatus(node, vmid) {
    try {
      const data = await this.getVM(node, vmid);
      return data ? data.status : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get VM statistics (CPU, RAM usage)
   */
  async getVMStats(node, vmid) {
    try {
      const endpoint = `/nodes/${node}/qemu/${vmid}/status/current`;
      const data = await this.request('GET', endpoint);
      return {
        cpu: data.cpu || 0,
        memory: data.mem || 0,
        maxmem: data.maxmem || 0,
        disk: data.disk || 0,
        maxdisk: data.maxdisk || 0,
        status: data.status || 'unknown',
        uptime: data.uptime || 0
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Start a VM
   */
  async startVM(node, vmid) {
    try {
      const endpoint = `/nodes/${node}/qemu/${vmid}/status/start`;
      return await this.request('POST', endpoint);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Shutdown a VM (graceful shutdown)
   */
  async shutdownVM(node, vmid) {
    try {
      const endpoint = `/nodes/${node}/qemu/${vmid}/status/shutdown`;
      return await this.request('POST', endpoint);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Stop a VM (force stop)
   */
  async stopVM(node, vmid) {
    try {
      const endpoint = `/nodes/${node}/qemu/${vmid}/status/stop`;
      return await this.request('POST', endpoint);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Restart a VM
   */
  async restartVM(node, vmid) {
    try {
      const endpoint = `/nodes/${node}/qemu/${vmid}/status/reboot`;
      return await this.request('POST', endpoint);
    } catch (error) {
      throw error;
    }
  }

  /**
   * List all nodes
   */
  async listNodes() {
    try {
      const endpoint = '/nodes';
      return await this.request('GET', endpoint);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check if a VM exists (node/vmid format expected in vmid param)
   */
  async checkVMExists(node, vmid) {
    try {
      const vm = await this.getVM(node, vmid);
      return vm !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get VM name from config
   */
  async getVMName(node, vmid) {
    try {
      const config = await this.getVMConfig(node, vmid);
      return config ? (config.name || `VM ${vmid}`) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if VM uses Cloud Init
   */
  async checkCloudInit(node, vmid) {
    try {
      const config = await this.getVMConfig(node, vmid);
      if (!config) return false;

      return !!(
        config.cipassword ||
        config.ciuser ||
        config.cicustom
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Update Cloud Init password
   */
  async updateCloudInitPassword(node, vmid, password) {
    try {
      const endpoint = `/nodes/${node}/qemu/${vmid}/config`;
      const data = {
        cipassword: password
      };

      return await this.request('PUT', endpoint, data);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get Cloud Init configuration (IP, user, etc.)
   */
  async getCloudInitConfig(node, vmid) {
    try {
      const config = await this.getVMConfig(node, vmid);
      if (!config) return null;

      return {
        user: config.ciuser || 'root',
        ipconfig0: config.ipconfig0 || null,
        ipconfig1: config.ipconfig1 || null,
        nameserver: config.nameserver || null,
        searchdomain: config.searchdomain || null,
        sshkeys: config.sshkeys ? true : false,
        hasCloudInit: !!(config.ciuser || config.cipassword || config.ipconfig0)
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse IP from ipconfig string (e.g., "ip=192.168.1.100/24,gw=192.168.1.1")
   */
  parseIPFromConfig(ipconfig) {
    if (!ipconfig) return null;

    if (ipconfig.includes('dhcp')) {
      return { type: 'dhcp', ip: null, gateway: null };
    }

    const ipMatch = ipconfig.match(/ip=([^,\/]+)/);
    const gwMatch = ipconfig.match(/gw=([^,]+)/);
    const cidrMatch = ipconfig.match(/ip=[^\/]+\/(\d+)/);

    return {
      type: 'static',
      ip: ipMatch ? ipMatch[1] : null,
      gateway: gwMatch ? gwMatch[1] : null,
      cidr: cidrMatch ? cidrMatch[1] : null
    };
  }

  /**
   * Get network interfaces from QEMU Guest Agent
   * Requires qemu-guest-agent to be installed and running in the VM
   */
  async getAgentNetworkInfo(node, vmid) {
    try {
      const endpoint = `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`;
      const data = await this.request('GET', endpoint);

      if (!data || !data.result) return null;

      const interfaces = [];
      for (const iface of data.result) {
        if (iface.name === 'lo') continue;

        const ipAddresses = [];
        if (iface['ip-addresses']) {
          for (const addr of iface['ip-addresses']) {
            ipAddresses.push({
              type: addr['ip-address-type'],
              address: addr['ip-address'],
              prefix: addr.prefix
            });
          }
        }

        interfaces.push({
          name: iface.name,
          hwaddr: iface['hardware-address'] || null,
          ipAddresses
        });
      }

      return interfaces;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get OS information from QEMU Guest Agent
   */
  async getAgentOSInfo(node, vmid) {
    try {
      const endpoint = `/nodes/${node}/qemu/${vmid}/agent/get-osinfo`;
      const data = await this.request('GET', endpoint);

      if (!data || !data.result) return null;

      return {
        name: data.result.name || 'Unknown',
        version: data.result.version || '',
        prettyName: data.result['pretty-name'] || data.result.name || 'Unknown',
        kernelVersion: data.result['kernel-version'] || '',
        kernelRelease: data.result['kernel-release'] || '',
        machine: data.result.machine || ''
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get full VM details combining config, stats, and network info
   */
  async getVMFullDetails(node, vmid) {
    try {
      const [config, stats, cloudInit, agentNetwork, osInfo] = await Promise.all([
        this.getVMConfig(node, vmid),
        this.getVMStats(node, vmid),
        this.getCloudInitConfig(node, vmid),
        this.getAgentNetworkInfo(node, vmid).catch(() => null),
        this.getAgentOSInfo(node, vmid).catch(() => null)
      ]);

      if (!config) return null;

      const cores = config.cores || 1;
      const sockets = config.sockets || 1;
      const vcpus = cores * sockets;
      const memory = config.memory || 0;

      let primaryIP = null;
      let ipv6 = null;

      if (agentNetwork && agentNetwork.length > 0) {
        for (const iface of agentNetwork) {
          for (const addr of iface.ipAddresses) {
            if (addr.type === 'ipv4' && !primaryIP && !addr.address.startsWith('127.')) {
              primaryIP = addr.address;
            }
            if (addr.type === 'ipv6' && !ipv6 && !addr.address.startsWith('fe80') && !addr.address.startsWith('::1')) {
              ipv6 = addr.address;
            }
          }
        }
      }

      if (!primaryIP && cloudInit && cloudInit.ipconfig0) {
        const parsed = this.parseIPFromConfig(cloudInit.ipconfig0);
        if (parsed && parsed.ip) {
          primaryIP = parsed.ip;
        }
      }

      let storageSize = 0;
      const diskKeys = Object.keys(config).filter(k =>
        k.match(/^(scsi|virtio|ide|sata)\d+$/) && !config[k].includes('cloudinit')
      );

      for (const key of diskKeys) {
        const diskConfig = config[key];
        const sizeMatch = diskConfig.match(/size=(\d+)([GMT])/);
        if (sizeMatch) {
          let size = parseInt(sizeMatch[1]);
          const unit = sizeMatch[2];
          if (unit === 'T') size *= 1024;
          if (unit === 'M') size /= 1024;
          storageSize += size; // in GB
        }
      }

      let osName = 'Unknown';
      const osFromTags = this.parseOSFromTags(config.tags);

      if (osFromTags) {
        osName = osFromTags;
      } else if (config.ostype) {
        const osTypes = {
          'l26': 'Linux',
          'l24': 'Linux',
          'win11': 'Windows 11',
          'win10': 'Windows 10',
          'win8': 'Windows 8',
          'win7': 'Windows 7',
          'wxp': 'Windows XP',
          'other': 'Other'
        };
        osName = osTypes[config.ostype] || config.ostype;
      }

      return {
        name: config.name || `VM ${vmid}`,
        vmid,
        node,

        status: stats?.status || 'unknown',
        uptime: stats?.uptime || 0,

        vcpus,
        cores,
        sockets,
        memory: memory,
        maxMemory: stats?.maxmem || memory * 1024 * 1024,
        usedMemory: stats?.memory || 0,

        storageSize,
        maxDisk: stats?.maxdisk || 0,
        usedDisk: stats?.disk || 0,

        cpuUsage: stats?.cpu || 0,

        ipAddress: primaryIP,
        ipv6Address: ipv6,
        networkInterfaces: agentNetwork,

        cloudInit: cloudInit ? {
          user: cloudInit.user,
          hasSSHKeys: cloudInit.sshkeys,
          enabled: cloudInit.hasCloudInit
        } : null,

        os: osName,
        tags: config.tags || '',

        boot: config.boot || '',
        machine: config.machine || '',
        bios: config.bios || 'seabios'
      };
    } catch (error) {
      console.error('Error getting VM full details:', error.message);
      return null;
    }
  }

  /**
   * Parse OS name and version from VM tags
   * Tags format: "ubuntu-24.04" -> "Ubuntu 24.04"
   * Supports: ubuntu, debian, centos, rocky, alma, fedora, windows, arch, etc.
   */
  parseOSFromTags(tags) {
    if (!tags) return null;

    const tagList = tags.split(/[,;]/).map(t => t.trim().toLowerCase());

    const osMapping = {
      'ubuntu': 'Ubuntu',
      'debian': 'Debian',
      'centos': 'CentOS',
      'rocky': 'Rocky Linux',
      'almalinux': 'AlmaLinux',
      'alma': 'AlmaLinux',
      'fedora': 'Fedora',
      'rhel': 'Red Hat Enterprise Linux',
      'windows': 'Windows',
      'win': 'Windows',
      'arch': 'Arch Linux',
      'manjaro': 'Manjaro',
      'opensuse': 'openSUSE',
      'suse': 'SUSE',
      'kali': 'Kali Linux',
      'mint': 'Linux Mint',
      'pop': 'Pop!_OS',
      'elementary': 'elementary OS',
      'zorin': 'Zorin OS',
      'proxmox': 'Proxmox VE',
      'freebsd': 'FreeBSD',
      'openbsd': 'OpenBSD',
      'netbsd': 'NetBSD'
    };

    for (const tag of tagList) {
      for (const [key, displayName] of Object.entries(osMapping)) {
        if (tag.startsWith(key)) {
          const versionMatch = tag.match(new RegExp(`^${key}[\\-_]?(.*)$`));
          if (versionMatch && versionMatch[1]) {
            let version = versionMatch[1]
              .replace(/^[\\-_]/, '')
              .replace(/[\\-_]/g, ' ')
              .trim();

            if (version) {
              return `${displayName} ${version}`;
            }
          }
          return displayName;
        }
      }
    }

    return null;
  }

  /**
   * Get RRD (Round Robin Database) data for graphs
   * Timeframe options: hour, day, week, month, year
   * CF (Consolidation Function): AVERAGE, MAX
   */
  async getRRDData(node, vmid, timeframe = 'hour', cf = 'AVERAGE') {
    try {
      const endpoint = `/nodes/${node}/qemu/${vmid}/rrddata`;
      const data = await this.request('GET', `${endpoint}?timeframe=${timeframe}&cf=${cf}`);

      if (!data || !Array.isArray(data)) return null;

      const result = {
        timestamps: [],
        cpu: [],
        memory: [],
        memoryMax: [],
        disk: [],
        diskMax: [],
        netIn: [],
        netOut: [],
        diskRead: [],
        diskWrite: []
      };

      for (const point of data) {
        if (point.time) {
          result.timestamps.push(point.time * 1000);
          result.cpu.push((point.cpu || 0) * 100);
          result.memory.push(point.mem || 0);
          result.memoryMax.push(point.maxmem || 0);
          result.disk.push(point.disk || 0);
          result.diskMax.push(point.maxdisk || 0);
          result.netIn.push(point.netin || 0);
          result.netOut.push(point.netout || 0);
          result.diskRead.push(point.diskread || 0);
          result.diskWrite.push(point.diskwrite || 0);
        }
      }

      return result;
    } catch (error) {
      console.error('Error fetching RRD data:', error.message);
      return null;
    }
  }
}

module.exports = ProxmoxAPI;



