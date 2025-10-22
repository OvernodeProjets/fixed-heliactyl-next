/**
 *      __         ___            __        __
 *     / /_  ___  / (_)___ ______/ /___  __/ /
 *    / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 *   / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
 *  /_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
 *                               /____/      
 * 
 *     Heliactyl Next 3.2.0 (Avalanche)
 * 
 */

const heliactylModule = {
  "name": "Store Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");

  const clusterId = process.env.CLUSTER_ID || `cluster-${Math.random().toString(36).substring(7)}`;


module.exports.load = function(app, db) {
  class AFKRewardsManager {
  constructor(db) {
    this.db = db;
    this.COINS_PER_MINUTE = settings.api.afk.coins || 2;
    this.INTERVAL_MS = 60000;
    this.timeouts = new Map();
    this.stateTimeouts = new Map();
  }

  async hasActiveSession(userId) {
    try {
      const session = await this.db.get(`afk_session-${userId}`);
      if (!session) return false;
      
      // Check if session is still active (not stale)
      return (Date.now() - session.lastUpdate) < this.INTERVAL_MS;
    } catch (error) {
      console.error(`[ERROR] Failed to check session for ${userId}:`, error);
      return false;
    }
  }

  async createSession(userId, clusterId) {
    try {
      await this.db.set(`afk_session-${userId}`, {
        clusterId,
        lastReward: Date.now(),
        lastUpdate: Date.now(),
        createdAt: Date.now()
      });
    } catch (error) {
      console.error(`[ERROR] Failed to create session for ${userId}:`, error);
      throw error;
    }
  }

  async updateSession(userId) {
    try {
      const session = await this.db.get(`afk_session-${userId}`);
      if (session) {
        session.lastReward = Date.now();
        session.lastUpdate = Date.now();
        await this.db.set(`afk_session-${userId}`, session);
      }
    } catch (error) {
      console.error(`[ERROR] Failed to update session for ${userId}:`, error);
      throw error;
    }
  }

  async removeSession(userId) {
    try {
      await this.db.delete(`afk_session-${userId}`);
    } catch (error) {
      console.error(`[ERROR] Failed to remove session for ${userId}:`, error);
      throw error;
    }
  }

  async getLastReward(userId) {
    try {
      const session = await this.db.get(`afk_session-${userId}`);
      return session?.lastReward || Date.now();
    } catch (error) {
      console.error(`[ERROR] Failed to get last reward for ${userId}:`, error);
      return Date.now();
    }
  }

  async processReward(userId, ws) {
    try {
      const currentCoins = await this.db.get(`coins-${userId}`) || 0;
      const newBalance = currentCoins + this.COINS_PER_MINUTE;
      await this.db.set(`coins-${userId}`, newBalance);
      
      await this.updateSession(userId);
      console.log(`[AFK] Rewarded ${userId} with ${this.COINS_PER_MINUTE} coins. New balance: ${newBalance}`);
      
      this.sendState(userId, ws);
      this.scheduleNextReward(userId, ws);
    } catch (error) {
      console.error(`[ERROR] Failed to process reward for ${userId}:`, error);
      ws.close(4000, 'Failed to process reward');
    }
  }

  scheduleNextReward(userId, ws) {
    const timeout = setTimeout(() => {
      this.processReward(userId, ws);
    }, this.INTERVAL_MS);

    this.timeouts.set(userId, timeout);
  }

  sendState(userId, ws) {
    this.getLastReward(userId).then(lastRewardTime => {
      const nextRewardIn = Math.max(0, this.INTERVAL_MS - (Date.now() - lastRewardTime));
      
      ws.send(JSON.stringify({
        type: 'afk_state',
        coinsPerMinute: this.COINS_PER_MINUTE,
        nextRewardIn,
        timestamp: Date.now()
      }));
    });
  }

  startStateUpdates(userId, ws) {
    const updateState = () => {
      this.sendState(userId, ws);
      
      const timeout = setTimeout(updateState, 1000);
      this.stateTimeouts.set(userId, timeout);
    };

    updateState();
  }

  cleanup(userId) {
    // Clear reward timeout
    const timeout = this.timeouts.get(userId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(userId);
    }

    // Clear state update timeout
    const stateTimeout = this.stateTimeouts.get(userId);
    if (stateTimeout) {
      clearTimeout(stateTimeout);
      this.stateTimeouts.delete(userId);
    }

    // Remove session from database
    this.removeSession(userId);
  }
}

  const afkManager = new AFKRewardsManager(db);

  app.ws('/ws', async function(ws, req) {
    if (!req.session.userinfo) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const userId = req.session.userinfo.id;
    const username = req.session.userinfo.username;

    try {
      // Check for existing session across all clusters
      const hasActive = await afkManager.hasActiveSession(userId);
      if (hasActive) {
        ws.close(4002, 'Already connected on another cluster');
        return;
      }

      // Create new session
      await afkManager.createSession(userId, clusterId);
      console.log(`[AFK] User ${username} (${userId}) connected on cluster ${clusterId}`);

      // Start reward cycle
      afkManager.scheduleNextReward(userId, ws);
      
      // Start state updates
      afkManager.startStateUpdates(userId, ws);

      // Handle disconnection
      ws.on('close', () => {
        afkManager.cleanup(userId);
        console.log(`[AFK] User ${username} (${userId}) disconnected from cluster ${clusterId}`);
      });

    } catch (error) {
      console.error(`[ERROR] Failed to setup AFK session for ${userId}:`, error);
      ws.close(4000, 'Failed to setup AFK session');
    }
  });
};