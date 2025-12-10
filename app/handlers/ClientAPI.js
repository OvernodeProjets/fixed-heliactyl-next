const axios = require('axios');
const NodeCache = require('node-cache');

// Cache for server details with 30 second TTL
const serverCache = new NodeCache({ stdTTL: 30, checkperiod: 60 });

class PterodactylClientModule {
  constructor(apiUrl, apiKey) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  /**
   * Get common headers for API requests
   */
  _getHeaders() {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  /**
   * Make a generic request to the Pterodactyl Client API
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
   * @param {string} path - Endpoint path (e.g., '/api/client/servers/mv834/power')
   * @param {Object} [data] - Request body
   * @param {Object} [params] - Query parameters
   * @param {string} [responseType] - Response type (default: 'json')
   * @returns {Promise<any>} Response data
   */
  async request(method, path, data = null, params = null, responseType = 'json') {
    try {
      const url = `${this.apiUrl}${path}`;
      const headers = this._getHeaders();
      
      const config = {
        method,
        url,
        headers,
        params,
        responseType
      };

      if (data) {
        config.data = data;
      }
      
      // Override content type if data is NOT JSON (e.g. plain text for file write)
      if (headers['Content-Type'] === 'application/json' && typeof data === 'string') {
           headers['Content-Type'] = 'text/plain';
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      if (error.response) {
          throw new Error(`Pterodactyl API Error [${error.response.status}]: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Get server details with caching
   * @param {string} serverId - Server identifier
   * @param {boolean} includeEgg - Include egg data
   * @param {boolean} includeSubusers - Include subusers data
   * @param {boolean} bypassCache - Force fresh fetch
   */
  async getServerDetails(serverId, includeEgg = false, includeSubusers = false, bypassCache = false) {
    const cacheKey = `server-${serverId}-${includeEgg}-${includeSubusers}`;
    
    // Check cache first (unless bypassed)
    if (!bypassCache) {
      const cached = serverCache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    try {
      const response = await axios.get(`${this.apiUrl}/api/client/servers/${serverId}`, {
        headers: this._getHeaders(),
        params: {
          include: [
            ...(includeEgg ? ['egg'] : []),
            ...(includeSubusers ? ['subusers'] : [])
          ].join(',')
        }
      });
      
      // Cache the result
      serverCache.set(cacheKey, response.data);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`Server ${serverId} not found (404)`);
        // Cache null result for 10 seconds to avoid hammering API
        serverCache.set(cacheKey, null, 10);
        return null;
      }
      console.error('Error fetching server details:', error);
      throw error;
    }
  }

  /**
   * Invalidate cache for a specific server
   */
  invalidateServerCache(serverId) {
    const keys = serverCache.keys().filter(k => k.startsWith(`server-${serverId}`));
    keys.forEach(k => serverCache.del(k));
  }

  async getWebSocketCredentials(serverId) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/client/servers/${serverId}/websocket`, {
        headers: this._getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching WebSocket credentials:', error);
      throw error;
    }
  }

  async executePowerAction(serverId, action) {
    try {
      // First check if the server exists
      const serverDetails = await this.getServerDetails(serverId);
      if (!serverDetails) {
        console.log(`Server ${serverId} not found, cannot execute power action '${action}'`);
        return null;
      }

      const response = await axios.post(
        `${this.apiUrl}/api/client/servers/${serverId}/power`,
        { signal: action },
        { headers: this._getHeaders() }
      );
      console.log(`Power action '${action}' executed for server ${serverId}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`Server ${serverId} not found (404), cannot execute power action '${action}'`);
        return null;
      }
      console.error(`Error executing power action '${action}' for server ${serverId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return serverCache.getStats();
  }
}

module.exports = PterodactylClientModule;
