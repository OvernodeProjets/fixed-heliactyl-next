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
 *     WebSocket Connection Manager
 *     Manages persistent WebSocket connections to Pterodactyl
 */

const WebSocket = require('ws');
const axios = require('axios');

class WebSocketConnectionManager {
  constructor(apiUrl, apiKey, origin) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.origin = origin;
    
    // Map of serverId -> { socket, token, tokenExpiry, clients: Set<ws> }
    this.connections = new Map();
    
    // Token refresh buffer (refresh 1 minute before expiry)
    this.TOKEN_REFRESH_BUFFER_MS = 60 * 1000; // 1 minute
    
    // Token lifetime (10 minutes as per Pterodactyl docs)
    this.TOKEN_LIFETIME_MS = 10 * 60 * 1000;
    
    // Idle connection cleanup time (5 minutes after last client disconnects)
    this.IDLE_CLEANUP_MS = 5 * 60 * 1000;
    
    // Pending connection promises to prevent race conditions
    this.pendingConnections = new Map();
  }

  /**
   * Get or create a WebSocket connection to a Pterodactyl server
   * Connections are shared between users for the same server
   */
  async getOrCreateConnection(serverId) {
    // Return existing connection if available and healthy
    const existing = this.connections.get(serverId);
    if (existing && existing.socket && existing.socket.readyState === WebSocket.OPEN) {
      console.log(`[WSManager] Reusing existing connection for server ${serverId}`);
      return existing;
    }

    // Check if connection is already being established
    if (this.pendingConnections.has(serverId)) {
      console.log(`[WSManager] Waiting for pending connection for server ${serverId}`);
      return this.pendingConnections.get(serverId);
    }

    // Create new connection
    const connectionPromise = this._createConnection(serverId);
    this.pendingConnections.set(serverId, connectionPromise);
    
    try {
      const connection = await connectionPromise;
      this.pendingConnections.delete(serverId);
      return connection;
    } catch (error) {
      this.pendingConnections.delete(serverId);
      throw error;
    }
  }

  /**
   * Internal: Create a new WebSocket connection
   */
  async _createConnection(serverId) {
    console.log(`[WSManager] Creating new connection for server ${serverId}`);
    
    // Get WebSocket credentials from Pterodactyl
    const credentials = await this._getWebSocketCredentials(serverId);
    if (!credentials) {
      throw new Error(`Failed to get WebSocket credentials for server ${serverId}`);
    }

    const { token, socket: socketUrl } = credentials.data;
    const tokenExpiry = Date.now() + this.TOKEN_LIFETIME_MS;

    return new Promise((resolve, reject) => {
      // Pass the origin in the options if available
      const options = {};
      if (this.origin) {
        options.origin = this.origin;
      }
      
      const socket = new WebSocket(socketUrl, options);
      
      const connection = {
        socket,
        token,
        tokenExpiry,
        serverId,
        clients: new Set(),
        authenticated: false,
        idleTimer: null
      };

      socket.on('open', () => {
        console.log(`[WSManager] WebSocket connected for server ${serverId}`);
        // Send authentication
        socket.send(JSON.stringify({ event: 'auth', args: [token] }));
      });

      socket.on('message', (data) => {
        const message = JSON.parse(data.toString());
        this._handleMessage(serverId, message, connection);
      });

      socket.on('close', () => {
        console.log(`[WSManager] WebSocket closed for server ${serverId}`);
        this._handleClose(serverId);
      });

      socket.on('error', (error) => {
        console.error(`[WSManager] WebSocket error for server ${serverId}:`, error.message);
        
        // Detect 403 error and provide helpful guidance
        if (error.message && error.message.includes('403')) {
          console.error(`\n${'='.repeat(70)}`);
          console.error(`[WSManager] ⚠️  WINGS CONFIGURATION ISSUE DETECTED`);
          console.error(`${'='.repeat(70)}`);
          console.error(`The Pterodactyl Wings node rejected the WebSocket connection (403 Forbidden).`);
          console.error(`This usually means the 'allowed-origins' setting is not configured.`);
          console.error(``);
          console.error(`To fix this, for EACH node in your infrastructure:`);
          console.error(`  1. Edit /etc/pterodactyl/config.yml`);
          console.error(`  2. Find the 'allowed-origins' setting`);
          console.error(`  3. Set it to: allowed-origins: ['*']`);
          console.error(`     Or for production: allowed-origins: ['${this.origin || 'https://your-dashboard.com'}']`);
          console.error(`  4. Restart Wings: systemctl restart wings`);
          console.error(`${'='.repeat(70)}\n`);
        }
        
        if (!connection.authenticated) {
          reject(error);
        }
      });

      // Set up token refresh timer
      this._scheduleTokenRefresh(serverId, connection);
      
      this.connections.set(serverId, connection);
      
      // Wait for auth success before resolving
      const authTimeout = setTimeout(() => {
        if (!connection.authenticated) {
          reject(new Error('Authentication timeout'));
        }
      }, 10000);

      const originalHandleMessage = connection._handleAuthResolve;
      connection._handleAuthResolve = () => {
        clearTimeout(authTimeout);
        resolve(connection);
      };
    });
  }

  /**
   * Handle incoming messages from Pterodactyl
   */
  _handleMessage(serverId, message, connection) {
    switch (message.event) {
      case 'auth success':
        console.log(`[WSManager] Authenticated for server ${serverId}`);
        connection.authenticated = true;
        if (connection._handleAuthResolve) {
          connection._handleAuthResolve();
          delete connection._handleAuthResolve;
        }
        // Broadcast to all clients
        this._broadcastToClients(connection, message);
        break;

      case 'token expiring':
        console.log(`[WSManager] Token expiring for server ${serverId}, refreshing...`);
        this._refreshToken(serverId, connection);
        break;

      case 'token expired':
        console.log(`[WSManager] Token expired for server ${serverId}, refreshing...`);
        this._refreshToken(serverId, connection);
        break;

      case 'jwt error':
        console.error(`[WSManager] JWT error for server ${serverId}:`, message.args);
        this._refreshToken(serverId, connection);
        break;

      default:
        // Forward all other messages to clients (stats, status, console output, etc.)
        this._broadcastToClients(connection, message);
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  _broadcastToClients(connection, message) {
    const messageStr = JSON.stringify(message);
    connection.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  }

  /**
   * Handle connection close
   */
  _handleClose(serverId) {
    const connection = this.connections.get(serverId);
    if (connection) {
      // Notify all clients
      connection.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1000, 'Pterodactyl connection closed');
        }
      });
      connection.clients.clear();
      
      // Clear timers
      if (connection.refreshTimer) {
        clearTimeout(connection.refreshTimer);
      }
      if (connection.idleTimer) {
        clearTimeout(connection.idleTimer);
      }
      
      this.connections.delete(serverId);
    }
  }

  /**
   * Get WebSocket credentials from Pterodactyl
   */
  async _getWebSocketCredentials(serverId) {
    try {
      const response = await axios.get(
        `${this.apiUrl}/api/client/servers/${serverId}/websocket`,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error(`[WSManager] Error fetching WebSocket credentials:`, error.message);
      throw error;
    }
  }

  /**
   * Refresh the WebSocket token
   */
  async _refreshToken(serverId, connection) {
    try {
      const credentials = await this._getWebSocketCredentials(serverId);
      if (!credentials) return;

      connection.token = credentials.data.token;
      connection.tokenExpiry = Date.now() + this.TOKEN_LIFETIME_MS;
      
      // Re-authenticate with new token
      if (connection.socket && connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.send(JSON.stringify({ 
          event: 'auth', 
          args: [connection.token] 
        }));
        console.log(`[WSManager] Token refreshed for server ${serverId}`);
      }
      
      // Reschedule token refresh
      this._scheduleTokenRefresh(serverId, connection);
    } catch (error) {
      console.error(`[WSManager] Error refreshing token:`, error.message);
    }
  }

  /**
   * Schedule token refresh before expiry
   */
  _scheduleTokenRefresh(serverId, connection) {
    if (connection.refreshTimer) {
      clearTimeout(connection.refreshTimer);
    }
    
    // Refresh 1 minute before expiry
    const refreshTime = this.TOKEN_LIFETIME_MS - this.TOKEN_REFRESH_BUFFER_MS;
    
    connection.refreshTimer = setTimeout(() => {
      this._refreshToken(serverId, connection);
    }, refreshTime);
  }

  /**
   * Add a client WebSocket to a server connection
   */
  addClient(serverId, clientWs) {
    const connection = this.connections.get(serverId);
    if (connection) {
      connection.clients.add(clientWs);
      
      // Clear idle timer since we have a client
      if (connection.idleTimer) {
        clearTimeout(connection.idleTimer);
        connection.idleTimer = null;
      }
      
      console.log(`[WSManager] Client added for server ${serverId}, total: ${connection.clients.size}`);
      
      // If already authenticated, send auth success to new client
      if (connection.authenticated) {
        clientWs.send(JSON.stringify({ event: 'auth success' }));
      }
    }
  }

  /**
   * Remove a client WebSocket from a server connection
   */
  removeClient(serverId, clientWs) {
    const connection = this.connections.get(serverId);
    if (connection) {
      connection.clients.delete(clientWs);
      console.log(`[WSManager] Client removed for server ${serverId}, remaining: ${connection.clients.size}`);
      
      // If no clients, start idle timer
      if (connection.clients.size === 0) {
        this._startIdleTimer(serverId, connection);
      }
    }
  }

  /**
   * Start idle cleanup timer
   */
  _startIdleTimer(serverId, connection) {
    if (connection.idleTimer) {
      clearTimeout(connection.idleTimer);
    }
    
    console.log(`[WSManager] Starting idle timer for server ${serverId} (${this.IDLE_CLEANUP_MS / 1000}s)`);
    
    connection.idleTimer = setTimeout(() => {
      if (connection.clients.size === 0) {
        console.log(`[WSManager] Closing idle connection for server ${serverId}`);
        this.closeConnection(serverId);
      }
    }, this.IDLE_CLEANUP_MS);
  }

  /**
   * Send a message to Pterodactyl for a specific server
   */
  sendToPterodactyl(serverId, message) {
    const connection = this.connections.get(serverId);
    if (connection && connection.socket && connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
      return true;
    }
    return false;
  }

  /**
   * Close a connection for a server
   */
  closeConnection(serverId) {
    const connection = this.connections.get(serverId);
    if (connection) {
      if (connection.refreshTimer) {
        clearTimeout(connection.refreshTimer);
      }
      if (connection.idleTimer) {
        clearTimeout(connection.idleTimer);
      }
      if (connection.socket) {
        connection.socket.close();
      }
      this.connections.delete(serverId);
      console.log(`[WSManager] Connection closed for server ${serverId}`);
    }
  }

  /**
   * Get connection stats
   */
  getStats() {
    const stats = {
      totalConnections: this.connections.size,
      connections: {}
    };
    
    this.connections.forEach((connection, serverId) => {
      stats.connections[serverId] = {
        clients: connection.clients.size,
        authenticated: connection.authenticated,
        socketState: connection.socket?.readyState
      };
    });
    
    return stats;
  }
}

// Singleton instance
let instance = null;

function getConnectionManager(apiUrl, apiKey, origin) {
  if (!instance) {
    instance = new WebSocketConnectionManager(apiUrl, apiKey, origin);
  }
  return instance;
}

module.exports = { WebSocketConnectionManager, getConnectionManager };
