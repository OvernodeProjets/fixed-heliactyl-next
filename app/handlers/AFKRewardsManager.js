const loadConfig = require("./config");
const settings = loadConfig("./config.toml");

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

  async processReward(userId, ws, username) {
    try {
      const currentCoins = await this.db.get(`coins-${userId}`) || 0;
      const newBalance = currentCoins + this.COINS_PER_MINUTE;
      await this.db.set(`coins-${userId}`, newBalance);
      
      await this.updateSession(userId);
      console.log(`[AFK] Rewarded ${username} (${userId}) with ${this.COINS_PER_MINUTE} coins. New balance: ${newBalance}`);
      
      this.sendState(userId, ws);
      this.scheduleNextReward(userId, ws, username);
    } catch (error) {
      console.error(`[ERROR] Failed to process reward for ${userId}:`, error);
      ws.close(4000, 'Failed to process reward');
    }
  }

  scheduleNextReward(userId, ws, username) {
    const timeout = setTimeout(() => {
      this.processReward(userId, ws, username);
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
      
      const timeout = setTimeout(updateState, 30000);
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

module.exports = AFKRewardsManager;