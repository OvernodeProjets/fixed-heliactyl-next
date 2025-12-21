/**
 *      __         ___            __        __
 *     / /_  ___  / (_)___ ______/ /___  __/ /
 *    / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 *   / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
 *  /_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
 *                               /____/      
 * 
 *     Heliactyl Next 3.2.1-beta.1 (Avalanche)
 * 
 *     Location Service
 *     Dynamic location and node discovery from Pterodactyl API
 */

const NodeCache = require('node-cache');
const { getAppAPI } = require('./pterodactylSingleton.js');
const loadConfig = require('./config.js');
const settings = loadConfig('./config.toml');

// Cache with 60 second TTL
const locationCache = new NodeCache({ stdTTL: 60, checkperiod: 30 });

class LocationService {
  constructor() {
    this.AppAPI = getAppAPI();
  }

  /**
   * Get all locations with nodes and dynamic capacity
   * Uses cache to avoid excessive API calls
   */
  async getLocations() {
    const cacheKey = 'dynamic_locations';
    const cached = locationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Fetch locations and nodes basic list from Pterodactyl
      const [locationsResponse, nodesListResponse] = await Promise.all([
        this.AppAPI.listLocations(1, 100),
        this.AppAPI.listNodes(1, 100)
      ]);

      const locations = locationsResponse.data || [];
      const nodesBasic = nodesListResponse.data || [];

      // Fetch full details + allocations for each node in parallel
      const nodesWithData = await Promise.all(
        nodesBasic.map(async (nodeBasic) => {
          try {
            const nodeId = nodeBasic.attributes.id;
            
            // Run in parallel for each node
            const [detailsResponse, allocationsResponse] = await Promise.all([
                this.AppAPI.getNodeDetails(nodeId, ['servers', 'location']),
                this.AppAPI.getNodeAllocations(nodeId)
            ]);

            const nodeDetails = detailsResponse.attributes; // attributes from details
            const servers = detailsResponse.attributes.relationships?.servers?.data || [];
            const allocations = allocationsResponse.data || [];

            // Combine into a structure _buildLocationData expects
            // We use the detailed attributes which should contain relationships
            return {
              attributes: nodeDetails,
              allocations: allocations, // Explicitly passed
              servers: servers // Explicitly passed
            };
          } catch (error) {
            console.warn(`[LocationService] Failed to fetch data for node ${nodeBasic.attributes.id}:`, error.message);
            // Return basic info if details fail, to avoid breaking everything
            return { 
                attributes: nodeBasic.attributes, 
                allocations: [], 
                servers: [] 
            };
          }
        })
      );

      // Group nodes by location and calculate capacity
      const result = this._buildLocationData(locations, nodesWithData);

      // Cache the result
      locationCache.set(cacheKey, result);

      return result;
    } catch (error) {
      console.error('[LocationService] Error fetching locations:', error.message);
      throw error;
    }
  }

  /**
   * Build location data structure with nodes and capacity
   */
  _buildLocationData(locations, nodes) {
    const locationMap = {};

    // Initialize locations from Pterodactyl data
    for (const loc of locations) {
      const attrs = loc.attributes;
      locationMap[attrs.id] = {
        id: attrs.id,
        name: attrs.long || attrs.short,
        short: attrs.short,
        country: attrs.short, // Can be overridden by config
        region: attrs.short,
        flag: this._getDefaultFlag(attrs.short),
        nodes: [],
        totalCapacity: 0,
        usedCapacity: 0,
        availableCapacity: 0,
        totalDisk: 0,
        usedDisk: 0,
        availableDisk: 0
      };
    }

    // Add nodes to their locations and calculate capacity
    for (const node of nodes) {
      const attrs = node.attributes;
      const locationId = attrs.location_id;

      if (!locationMap[locationId]) {
        console.warn(`[LocationService] Node ${attrs.name} references unknown location ${locationId}`);
        continue;
      }

      // Calculate capacity from allocations
      // data is now passed explicitly from getLocations
      const allocations = node.allocations || [];
      const servers = node.servers || [];
      
      const totalAllocations = allocations.length;
      const usedAllocations = allocations.filter(a => a.attributes.assigned).length;
      const availableAllocations = totalAllocations - usedAllocations;

      // Calculate disk usage
      // Pterodactyl node disk is in MB
      const nodeDisk = attrs.disk * (1 + (attrs.disk_overallocate || 0) / 100); 
      const usedNodeDisk = servers.reduce((acc, server) => acc + (server.attributes.limits.disk || 0), 0);
      const availableNodeDisk = Math.max(0, nodeDisk - usedNodeDisk);

      const nodeData = {
        id: attrs.id,
        name: attrs.name,
        fqdn: attrs.fqdn,
        memory: attrs.memory,
        disk: nodeDisk,
        usedDisk: usedNodeDisk,
        availableDisk: availableNodeDisk,
        totalAllocations,
        usedAllocations,
        availableAllocations,
        serverCount: servers.length,
        maintenanceMode: attrs.maintenance_mode
      };

      locationMap[locationId].nodes.push(nodeData);
      locationMap[locationId].totalCapacity += totalAllocations;
      locationMap[locationId].usedCapacity += usedAllocations;
      locationMap[locationId].availableCapacity += availableAllocations;
      locationMap[locationId].totalDisk += nodeDisk;
      locationMap[locationId].usedDisk += usedNodeDisk;
      locationMap[locationId].availableDisk += availableNodeDisk;
    }

    // Merge with static config overrides if they exist
    const staticLocations = settings.api?.client?.locations || {};
    for (const [configId, configData] of Object.entries(staticLocations)) {
      const locId = parseInt(configId);
      if (locationMap[locId]) {
        // Override with static config values if provided
        if (configData.name) locationMap[locId].name = configData.name;
        if (configData.country) locationMap[locId].country = configData.country;
        if (configData.flag) locationMap[locId].flag = configData.flag;
        if (configData.region) locationMap[locId].region = configData.region;
        if (configData.cpu) locationMap[locId].cpu = configData.cpu;
        if (configData.storage) locationMap[locId].storage = configData.storage;
      }
    }

    return locationMap;
  }

  /**
   * Get default flag URL based on location code
   */
  _getDefaultFlag(code) {
    const flagMap = {
      'fr': 'https://cdn-icons-png.flaticon.com/512/197/197560.png',
      'us': 'https://cdn-icons-png.flaticon.com/512/197/197484.png',
      'de': 'https://cdn-icons-png.flaticon.com/512/197/197571.png',
      'uk': 'https://cdn-icons-png.flaticon.com/512/197/197374.png',
      'gb': 'https://cdn-icons-png.flaticon.com/512/197/197374.png',
      'ca': 'https://cdn-icons-png.flaticon.com/512/197/197430.png',
      'au': 'https://cdn-icons-png.flaticon.com/512/197/197507.png',
      'jp': 'https://cdn-icons-png.flaticon.com/512/197/197604.png',
      'sg': 'https://cdn-icons-png.flaticon.com/512/197/197496.png',
      'nl': 'https://cdn-icons-png.flaticon.com/512/197/197441.png',
      'pl': 'https://cdn-icons-png.flaticon.com/512/197/197529.png'
    };
    const lowerCode = (code || '').toLowerCase().substring(0, 2);
    return flagMap[lowerCode] || 'https://cdn-icons-png.flaticon.com/512/197/197484.png';
  }

  /**
   * Get capacity for a specific node
   */
  async getNodeCapacity(nodeId) {
    const locations = await this.getLocations();
    for (const loc of Object.values(locations)) {
      const node = loc.nodes.find(n => n.id === nodeId);
      if (node) {
        return {
          total: node.totalAllocations,
          used: node.usedAllocations,
          available: node.availableAllocations
        };
      }
    }
    return null;
  }

  /**
   * Clear the cache (useful after server creation/deletion)
   */
  clearCache() {
    locationCache.flushAll();
    console.log('[LocationService] Cache cleared');
  }
}

// Singleton instance
let instance = null;

function getLocationService() {
  if (!instance) {
    instance = new LocationService();
    console.log('[LocationService] Service initialized');
  }
  return instance;
}

module.exports = { LocationService, getLocationService };
