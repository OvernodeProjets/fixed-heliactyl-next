const axios = require('axios');

class PterodactylClientModule {
  constructor(apiUrl, apiKey) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async getServerDetails(serverId, includeEgg = false, includeSubusers = false) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/client/servers/${serverId}`, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        params: {
          include: [
            ...(includeEgg ? ['egg'] : []),
            ...(includeSubusers ? ['subusers'] : [])
          ].join(',')
        }
      });
      return response.data;
    } catch (error) {
      // If server doesn't exist (404), return null
      if (error.response?.status === 404) {
        console.log(`Server ${serverId} not found (404)`);
        return null;
      }
      console.error('Error fetching server details:', error);
      throw error;
    }
  }

  async getWebSocketCredentials(serverId) {
    try {
      const response = await axios.get(`${this.apiUrl}/api/client/servers/${serverId}/websocket`, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
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
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );
      console.log(`Power action '${action}' executed for server ${serverId}`);
      return response.data;
    } catch (error) {
      // If server doesn't exist (404), return null instead of throwing
      if (error.response?.status === 404) {
        console.log(`Server ${serverId} not found (404), cannot execute power action '${action}'`);
        return null;
      }
      console.error(`Error executing power action '${action}' for server ${serverId}:`, error.message);
      throw error;
    }
  }
}

module.exports = PterodactylClientModule;
