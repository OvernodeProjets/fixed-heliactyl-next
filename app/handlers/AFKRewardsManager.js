const loadConfig = require("./config");
const settings = loadConfig("./config.toml");
const { logTransaction } = require("./log");

class AFKRewardsManager {
  constructor(db) {
    this.db = db;
    
    this.COINS_PER_MINUTE = settings.api.afk.coins || 2;
    this.INTERVAL_MS = (settings.api.afk.every || 60) * 1000;
    this.STATE_UPDATE_INTERVAL = settings.api.afk.state_update_interval || 1000;
    
    const partyBoostConfig = settings.api.afk.party_boost || {};
    this.PARTY_BOOST_ENABLED = partyBoostConfig.enabled !== false;
    this.MIN_MULTIPLIER = partyBoostConfig.min_multiplier || 1.0;
    this.MAX_MULTIPLIER = partyBoostConfig.max_multiplier || 5.0;
    this.PARTY_THRESHOLDS = this.parseThresholds(partyBoostConfig.thresholds);
    
    this.timeouts = new Map();
    this.stateTimeouts = new Map();
    this.sessions = new Map();
    this._cachedMultiplier = this.MIN_MULTIPLIER;
    this._cachedPresenceCount = 0;
    
    console.log(`[AFK] Initialized: ${this.COINS_PER_MINUTE} coins/${this.INTERVAL_MS/1000}s, Party Boost: ${this.PARTY_BOOST_ENABLED ? 'ON' : 'OFF'}`);
  }

  parseThresholds(configThresholds) {
    const defaultThresholds = [[3, 1.1], [5, 1.25], [10, 1.5], [20, 2.0]];
    if (!configThresholds || !Array.isArray(configThresholds)) return defaultThresholds;
    
    return configThresholds
      .filter(t => Array.isArray(t) && t.length >= 2)
      .map(t => [parseInt(t[0]), parseFloat(t[1])])
      .sort((a, b) => a[0] - b[0]);
  }

  isSocketOpen(ws) {
    return ws && ws.readyState === ws.OPEN;
  }

  _updateCache() {
    this._cachedPresenceCount = this.sessions.size;
    
    if (!this.PARTY_BOOST_ENABLED) {
      this._cachedMultiplier = this.MIN_MULTIPLIER;
      return;
    }
    
    let multiplier = this.MIN_MULTIPLIER;
    for (const [minPresence, multi] of this.PARTY_THRESHOLDS) {
      if (this._cachedPresenceCount >= minPresence) {
        multiplier = multi;
      } else break;
    }
    this._cachedMultiplier = Math.min(multiplier, this.MAX_MULTIPLIER);
  }

  getPresenceCount() { return this._cachedPresenceCount; }
  getMultiplier() { return this._cachedMultiplier; }

  getNextThreshold() {
    if (!this.PARTY_BOOST_ENABLED) return null;
    
    for (const [minPresence, multi] of this.PARTY_THRESHOLDS) {
      if (this._cachedPresenceCount < minPresence) {
        return { usersNeeded: minPresence - this._cachedPresenceCount, nextMultiplier: multi, atUsers: minPresence };
      }
    }
    return null;
  }

  async hasActiveSession(userId) {
    const session = this.sessions.get(userId);
    return session && (Date.now() - session.lastUpdate) < this.INTERVAL_MS * 2;
  }

  async createSession(userId, clusterId) {
    const now = Date.now();
    this.sessions.set(userId, { clusterId, startedAt: now, lastReward: now, lastUpdate: now, earned: 0 });
    this._updateCache();
    this.db.set(`afk_session-${userId}`, { clusterId, createdAt: now }).catch(() => {});
    console.log(`[AFK] +1 user (${this._cachedPresenceCount} total, x${this._cachedMultiplier})`);
  }

  async processReward(userId, ws, username) {
    if (!this.isSocketOpen(ws)) { await this.cleanup(userId); return; }
    
    const session = this.sessions.get(userId);
    if (!session) return;
    
    try {
      const rewardAmount = this.COINS_PER_MINUTE * this._cachedMultiplier;
      const currentCoins = await this.db.get(`coins-${userId}`) || 0;
      await this.db.set(`coins-${userId}`, currentCoins + rewardAmount);
      
      session.earned += rewardAmount;
      session.lastReward = Date.now();
      session.lastUpdate = Date.now();
      
      this.sendState(userId, ws);
      this.scheduleNextReward(userId, ws, username);
    } catch (error) {
      console.error(`[AFK] Reward error for ${userId}:`, error.message);
      if (this.isSocketOpen(ws)) ws.close(4000, 'Failed to process reward');
    }
  }

  scheduleNextReward(userId, ws, username) {
    if (!this.isSocketOpen(ws)) return;
    
    const existing = this.timeouts.get(userId);
    if (existing) clearTimeout(existing);
    
    this.timeouts.set(userId, setTimeout(() => {
      if (this.isSocketOpen(ws)) this.processReward(userId, ws, username);
    }, this.INTERVAL_MS));
  }

  sendState(userId, ws) {
    if (!this.isSocketOpen(ws)) return;
    const session = this.sessions.get(userId);
    if (!session) return;
    
    const nextRewardIn = Math.max(0, this.INTERVAL_MS - (Date.now() - session.lastReward));
    
    try {
      ws.send(JSON.stringify({
        type: 'afk_state',
        baseCoinsPerMinute: this.COINS_PER_MINUTE,
        coinsPerMinute: this.COINS_PER_MINUTE * this._cachedMultiplier,
        intervalMs: this.INTERVAL_MS,
        nextRewardIn,
        partyBoost: {
          enabled: this.PARTY_BOOST_ENABLED,
          presenceCount: this._cachedPresenceCount,
          multiplier: this._cachedMultiplier,
          minMultiplier: this.MIN_MULTIPLIER,
          maxMultiplier: this.MAX_MULTIPLIER,
          active: this._cachedMultiplier > this.MIN_MULTIPLIER,
          thresholds: this.PARTY_THRESHOLDS,
          nextThreshold: this.getNextThreshold()
        },
        // Legacy
        presenceCount: this._cachedPresenceCount,
        multiplier: this._cachedMultiplier,
        partyModeActive: this._cachedMultiplier > this.MIN_MULTIPLIER,
        thresholds: this.PARTY_THRESHOLDS,
        timestamp: Date.now()
      }));
    } catch (e) {
      // Socket closed during send
    }
  }

  startStateUpdates(userId, ws) {
    const update = () => {
      if (!this.isSocketOpen(ws)) return;
      this.sendState(userId, ws);
      this.stateTimeouts.set(userId, setTimeout(update, this.STATE_UPDATE_INTERVAL));
    };
    update();
  }

  async cleanup(userId) {
    const timeout = this.timeouts.get(userId);
    if (timeout) clearTimeout(timeout);
    this.timeouts.delete(userId);
    
    const stateTimeout = this.stateTimeouts.get(userId);
    if (stateTimeout) clearTimeout(stateTimeout);
    this.stateTimeouts.delete(userId);
    
    const session = this.sessions.get(userId);
    if (session && session.earned > 0) {
      try {
        const totalMinutes = Math.floor((Date.now() - session.startedAt) / this.INTERVAL_MS);
        const avgMultiplier = totalMinutes > 0 ? (session.earned / (totalMinutes * this.COINS_PER_MINUTE)).toFixed(2) : '1.00';
        const currentBalance = await this.db.get(`coins-${userId}`) || 0;
        await logTransaction(this.db, userId, 'credit', session.earned, currentBalance, 
          { description: `AFK ${totalMinutes}m (x${avgMultiplier})`, senderId: 'afk-rewards', receiverId: userId });
      } catch (e) {
        console.error(`[AFK] Log error:`, e.message);
      }
    }
    
    this.sessions.delete(userId);
    this._updateCache();
    this.db.delete(`afk_session-${userId}`).catch(() => {});
    console.log(`[AFK] -1 user (${this._cachedPresenceCount} total)`);
  }
}

module.exports = AFKRewardsManager;