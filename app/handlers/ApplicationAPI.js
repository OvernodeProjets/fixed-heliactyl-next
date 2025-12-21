const axios = require('axios');
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");

class PterodactylApplicationModule {
  constructor(apiUrl, apiKey) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.debug = settings?.pterodactyl?.debug || false;
  }

  getHeaders() {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }

  logError(message, error) {
    if (this.debug) {
      console.error(message, error.response?.data || error.message);
    }
  }

  // ==================== USERS ====================
  
  async listUsers({ page = 1, perPage = 100, ...extraParams } = {}) {
    try {
      const params = {
        page,
        per_page: perPage,
        ...extraParams,
      };

      const response = await axios.get(`${this.apiUrl}/api/application/users`, {
        headers: this.getHeaders(),
        params,
      });

      return response.data;
    } catch (error) {
      this.logError('Error listing users:', error);
      throw error;
    }
  }

  async getUserDetails(userId, include = []) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/application/users/${userId}`, {
        headers: this.getHeaders(),
        params: { include: include.join(',') }
      });
      return response.data;
    } catch (error) {
      this.logError('Error fetching user details:', error);
      throw error;
    }
  }

  async getUserByExternalId(externalId) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/application/users/external/${externalId}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error fetching user by external ID:', error);
      throw error;
    }
  }

  async createUser(userData) {
    try {
      const response = await axios.post(`${this.apiUrl}/api/application/users`, userData, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error creating user:', error);
      throw error;
    }
  }

  async updateUser(userId, userData) {
    try {
      const response = await axios.patch(`${this.apiUrl}/api/application/users/${userId}`, userData, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error updating user:', error);
      throw error;
    }
  }

  async deleteUser(userId) {
    try {
      const response = await axios.delete(`${this.apiUrl}/api/application/users/${userId}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error deleting user:', error);
      throw error;
    }
  }

  // ==================== SERVERS ====================

  async listServers(page = 1, perPage = 50, filters = {}) {
    try {
      const params = { page, per_page: perPage };
      
      if (filters.include) params.include = filters.include;
      if (filters.filter) params.filter = filters.filter;
      if (filters.sort) params.sort = filters.sort;

      const response = await axios.get(`${this.apiUrl}/api/application/servers`, {
        headers: this.getHeaders(),
        params
      });
      return response.data;
    } catch (error) {
      this.logError('Error listing servers:', error);
      throw error;
    }
  }

  async getServerDetails(serverId, include = []) {
    try {
      const params = include.length > 0 ? { include: include.join(',') } : {};
      const response = await axios.get(`${this.apiUrl}/api/application/servers/${serverId}`, {
        headers: this.getHeaders(),
        params
      });
      return response.data;
    } catch (error) {
      this.logError('Error fetching server details:', error);
      throw error;
    }
  }

  async getServerByExternalId(externalId) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/application/servers/external/${externalId}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error fetching server by external ID:', error);
      throw error;
    }
  }

  async createServer(serverData) {
    try {
      const response = await axios.post(`${this.apiUrl}/api/application/servers`, serverData, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error creating server:', error);
      throw error;
    }
  }

  async updateServerDetails(serverId, serverData) {
    try {
      const response = await axios.patch(`${this.apiUrl}/api/application/servers/${serverId}/details`, serverData, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error updating server details:', error);
      throw error;
    }
  }

  async updateServerBuild(serverId, buildData) {
    try {
      const response = await axios.patch(`${this.apiUrl}/api/application/servers/${serverId}/build`, buildData, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error updating server build:', error);
      throw error;
    }
  }

  async updateServerStartup(serverId, startupData) {
    try {
      const response = await axios.patch(`${this.apiUrl}/api/application/servers/${serverId}/startup`, startupData, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error updating server startup:', error);
      throw error;
    }
  }

  async suspendServer(serverId) {
    try {
      const response = await axios.post(`${this.apiUrl}/api/application/servers/${serverId}/suspend`, {}, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error suspending server:', error);
      throw error;
    }
  }

  async unsuspendServer(serverId) {
    try {
      const response = await axios.post(`${this.apiUrl}/api/application/servers/${serverId}/unsuspend`, {}, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error unsuspending server:', error);
      throw error;
    }
  }

  async reinstallServer(serverId) {
    try {
      const response = await axios.post(`${this.apiUrl}/api/application/servers/${serverId}/reinstall`, {}, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error reinstalling server:', error);
      throw error;
    }
  }

  async deleteServer(serverId, force = false) {
    try {
      const response = await axios.delete(`${this.apiUrl}/api/application/servers/${serverId}${force ? '/force' : ''}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error deleting server:', error);
      throw error;
    }
  }

  // ==================== NODES ====================

  async listNodes(page = 1, perPage = 50, include = []) {
    try {
      const params = { page, per_page: perPage };
      if (include.length > 0) {
        params.include = include.join(',');
      }
      const response = await axios.get(`${this.apiUrl}/api/application/nodes`, {
        headers: this.getHeaders(),
        params
      });
      return response.data;
    } catch (error) {
      this.logError('Error listing nodes:', error);
      throw error;
    }
  }

  async getNodeDetails(nodeId, include = []) {
    try {
      const params = {};
      if (include.length > 0) {
        params.include = include.join(',');
      }
      const response = await axios.get(`${this.apiUrl}/api/application/nodes/${nodeId}`, {
        headers: this.getHeaders(),
        params
      });
      return response.data;
    } catch (error) {
      this.logError('Error fetching node details:', error);
      throw error;
    }
  }

  async createNode(nodeData) {
    try {
      const response = await axios.post(`${this.apiUrl}/api/application/nodes`, nodeData, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error creating node:', error);
      throw error;
    }
  }

  async updateNode(nodeId, nodeData) {
    try {
      const response = await axios.patch(`${this.apiUrl}/api/application/nodes/${nodeId}`, nodeData, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error updating node:', error);
      throw error;
    }
  }

  async deleteNode(nodeId) {
    try {
      const response = await axios.delete(`${this.apiUrl}/api/application/nodes/${nodeId}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error deleting node:', error);
      throw error;
    }
  }

  async getNodeAllocations(nodeId, page = 1, perPage = 1000) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/application/nodes/${nodeId}/allocations`, {
        headers: this.getHeaders(),
        params: { page, per_page: perPage }
      });
      return response.data;
    } catch (error) {
      this.logError('Error fetching node allocations:', error);
      throw error;
    }
  }

  // ==================== LOCATIONS ====================

  async listLocations(page = 1, perPage = 50) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/application/locations`, {
        headers: this.getHeaders(),
        params: { page, per_page: perPage }
      });
      return response.data;
    } catch (error) {
      this.logError('Error listing locations:', error);
      throw error;
    }
  }

  async getLocationDetails(locationId) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/application/locations/${locationId}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error fetching location details:', error);
      throw error;
    }
  }

  async createLocation(locationData) {
    try {
      const response = await axios.post(`${this.apiUrl}/api/application/locations`, locationData, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error creating location:', error);
      throw error;
    }
  }

  async updateLocation(locationId, locationData) {
    try {
      const response = await axios.patch(`${this.apiUrl}/api/application/locations/${locationId}`, locationData, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error updating location:', error);
      throw error;
    }
  }

  async deleteLocation(locationId) {
    try {
      const response = await axios.delete(`${this.apiUrl}/api/application/locations/${locationId}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error deleting location:', error);
      throw error;
    }
  }

  // ==================== NESTS ====================

  async listNests(page = 1, perPage = 50) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/application/nests`, {
        headers: this.getHeaders(),
        params: { page, per_page: perPage }
      });
      return response.data;
    } catch (error) {
      this.logError('Error listing nests:', error);
      throw error;
    }
  }

  async getNestDetails(nestId, include = []) {
    try {
      const params = include.length > 0 ? { include: include.join(',') } : {};
      const response = await axios.get(`${this.apiUrl}/api/application/nests/${nestId}`, {
        headers: this.getHeaders(),
        params
      });
      return response.data;
    } catch (error) {
      this.logError('Error fetching nest details:', error);
      throw error;
    }
  }

  async listEggs(nestId, page = 1, perPage = 50) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/application/nests/${nestId}/eggs`, {
        headers: this.getHeaders(),
        params: { page, per_page: perPage }
      });
      return response.data;
    } catch (error) {
      this.logError('Error listing eggs:', error);
      throw error;
    }
  }

  async getEggDetails(nestId, eggId) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/application/nests/${nestId}/eggs/${eggId}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error fetching egg details:', error);
      throw error;
    }
  }

  // ==================== DATABASES ====================

  async listServerDatabases(serverId) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/application/servers/${serverId}/databases`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error listing server databases:', error);
      throw error;
    }
  }

  async getDatabaseDetails(serverId, databaseId) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/application/servers/${serverId}/databases/${databaseId}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error fetching database details:', error);
      throw error;
    }
  }

  async createDatabase(serverId, databaseData) {
    try {
      const response = await axios.post(`${this.apiUrl}/api/application/servers/${serverId}/databases`, databaseData, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error creating database:', error);
      throw error;
    }
  }

  async resetDatabasePassword(serverId, databaseId) {
    try {
      const response = await axios.post(`${this.apiUrl}/api/application/servers/${serverId}/databases/${databaseId}/reset-password`, {}, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error resetting database password:', error);
      throw error;
    }
  }

  async deleteDatabase(serverId, databaseId) {
    try {
      const response = await axios.delete(`${this.apiUrl}/api/application/servers/${serverId}/databases/${databaseId}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      this.logError('Error deleting database:', error);
      throw error;
    }
  }
}

module.exports = PterodactylApplicationModule;