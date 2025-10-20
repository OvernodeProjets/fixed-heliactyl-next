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

const adminjs = require("./admin.js");
const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const { requireAuth } = require("../handlers/requireAuth.js");

const HOUR_IN_MS = 3600000;
const WEEK_IN_MS = 604800000;
const MAX_HISTORY_DAYS = 30;

class BillingError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
  }
}

class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.limit = 100; // requests per minute
    this.windowMs = 60000; // 1 minute
  }

  isRateLimited(userId) {
    const now = Date.now();
    const userRequests = this.requests.get(userId) || [];
    const windowRequests = userRequests.filter(time => time > now - this.windowMs);
    
    this.requests.set(userId, windowRequests);
    
    if (windowRequests.length >= this.limit) {
      return true;
    }
    
    windowRequests.push(now);
    return false;
  }
}

class BillingManager {
  constructor(db) {
    this.db = db;
    this.rateLimiter = new RateLimiter();
    this.isProcessingBilling = false;
    this.resourcePrices = {
      ram: settings.api.client.coins.store.ram.cost,
      disk: settings.api.client.coins.store.disk.cost,
      cpu: settings.api.client.coins.store.cpu.cost,
      servers: settings.api.client.coins.store.servers.cost
    };

    // Initialize billing cycle check
    setInterval(() => this.processBillingCycles().catch(err => {
      console.error('[ERROR] Billing cycle processing failed:', err);
      this.isProcessingBilling = false;
    }), HOUR_IN_MS);

    // Initialize usage tracking
    setInterval(() => this.processUsageTracking().catch(err => {
      console.error('[ERROR] Usage tracking failed:', err);
    }), HOUR_IN_MS);
  }

  async safeDbOperation(operation) {
    try {
      return await operation();
    } catch (error) {
      console.error('[ERROR] Database operation failed:', error);
      throw new BillingError('Database operation failed', 'DB_ERROR');
    }
  }

  validateResourceAmount(resourceType, amount) {
    if (!this.resourcePrices[resourceType]) {
      throw new BillingError('Invalid resource type', 'INVALID_RESOURCE');
    }
    
    if (!Number.isFinite(amount) || amount < 1 || amount > 10) {
      throw new BillingError('Invalid amount', 'INVALID_AMOUNT');
    }

    return true;
  }

  async getActiveSubscriptionCount(userId) {
    const subscriptions = await this.safeDbOperation(() => 
      this.db.get(`subscriptions-${userId}`) || []
    );
    return subscriptions.filter(sub => sub.active).length;
  }

  async logHistory(userId, amount, resourceType, recurring = false) {
    const historyEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId,
      amount,
      resourceType,
      recurring,
      timestamp: Date.now()
    };
    
    await this.safeDbOperation(async () => {
      const history = await this.db.get(`history-${userId}`) || [];
      history.push(historyEntry);
      
      // Keep only last 30 days
      const thirtyDaysAgo = Date.now() - (MAX_HISTORY_DAYS * 24 * HOUR_IN_MS);
      const filteredHistory = history.filter(h => h.timestamp > thirtyDaysAgo);
      
      await this.db.set(`history-${userId}`, filteredHistory);
    });
    
    log(`Resource ${recurring ? 'Billing' : 'Purchase'}`, 
      `User ${userId} ${recurring ? 'billed' : 'purchased'} ${resourceType} for ${amount} coins`);
  }

  async createSubscription(userId, resourceType, amount, cost) {
    this.validateResourceAmount(resourceType, amount);
    
    const subscription = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId,
      resourceType,
      amount,
      weeklyCost: cost,
      nextBillingDate: Date.now() + WEEK_IN_MS,
      active: true,
      created: Date.now(),
      lastUpdated: Date.now()
    };

    await this.safeDbOperation(async () => {
      const subscriptions = await this.db.get(`subscriptions-${userId}`) || [];
      subscriptions.push(subscription);
      await this.db.set(`subscriptions-${userId}`, subscriptions);
    });
    
    return subscription;
  }

  async updateResourceLimits(userId, resourceType, amount, isAddition = true) {
    await this.safeDbOperation(async () => {
      const extra = await this.db.get(`extra-${userId}`) || {
        ram: 0,
        disk: 0,
        cpu: 0,
        servers: 0
      };

      // Calculate actual resource amount using multiplier
      const actualAmount = amount * (RESOURCE_MULTIPLIERS[resourceType] || 1);

      const newAmount = isAddition ? 
        extra[resourceType] + actualAmount :
        extra[resourceType] - actualAmount;

      // Convert MAX_RESOURCE_LIMITS to actual values using multipliers  
      const maxLimit = MAX_RESOURCE_LIMITS[resourceType] * (RESOURCE_MULTIPLIERS[resourceType] || 1);

      if (newAmount > maxLimit) {
        throw new BillingError('Resource limit exceeded', 'RESOURCE_LIMIT_EXCEEDED');
      }

      extra[resourceType] = Math.max(0, newAmount);

      if (Object.values(extra).every(v => v === 0)) {
        await this.db.delete(`extra-${userId}`);
      } else {
        await this.db.set(`extra-${userId}`, extra);
      }

      return extra;
    });
  }

  async processSubscriptionPayment(userId, subscription) {
    return await this.safeDbOperation(async () => {
      const userCoins = await this.db.get(`coins-${userId}`) || 0;
      const hasRenewalBypass = await this.db.get(`renewbypass-${userId}`);

      // Skip payment if user has renewal bypass
      if (hasRenewalBypass) {
        const subscriptions = await this.db.get(`subscriptions-${userId}`) || [];
        const index = subscriptions.findIndex(s => s.id === subscription.id);
        
        if (index !== -1) {
          subscriptions[index].nextBillingDate = Date.now() + WEEK_IN_MS;
          subscriptions[index].lastUpdated = Date.now();
          await this.db.set(`subscriptions-${userId}`, subscriptions);
        }

        return true;
      }

      if (userCoins < subscription.weeklyCost) {
        await this.revokeResources(userId, subscription);
        return false;
      }

      const newBalance = userCoins - subscription.weeklyCost;
      await this.db.set(`coins-${userId}`, newBalance);
      
      const subscriptions = await this.db.get(`subscriptions-${userId}`) || [];
      const index = subscriptions.findIndex(s => s.id === subscription.id);
      
      if (index !== -1) {
        subscriptions[index].nextBillingDate = Date.now() + WEEK_IN_MS;
        subscriptions[index].lastUpdated = Date.now();
        await this.db.set(`subscriptions-${userId}`, subscriptions);
      }

      await this.logHistory(userId, subscription.weeklyCost, subscription.resourceType, true);
      return true;
    });
  }

  async revokeResources(userId, subscription) {
    if (!subscription.active) return;

    await this.safeDbOperation(async () => {
      await this.updateResourceLimits(userId, subscription.resourceType, subscription.amount, false);
      
      const subscriptions = await this.db.get(`subscriptions-${userId}`) || [];
      const index = subscriptions.findIndex(s => s.id === subscription.id);
      
      if (index !== -1) {
        subscriptions[index].active = false;
        subscriptions[index].lastUpdated = Date.now();
        await this.db.set(`subscriptions-${userId}`, subscriptions);
      }
    });

    adminjs.suspend(userId);
    
    log('Resources Revoked', 
      `Revoked ${subscription.amount} ${subscription.resourceType} from user ${userId} due to non-payment`);
  }

  async processBillingCycles() {
    if (this.isProcessingBilling) return;
    this.isProcessingBilling = true;

    try {
      const now = Date.now();
      const accounts = await this.safeDbOperation(() => this.db.get('accounts') || []);
      
      for (const userId of accounts) {
        try {
          const subscriptions = await this.db.get(`subscriptions-${userId}`) || [];
          const activeSubscriptions = subscriptions.filter(s => s.active && s.nextBillingDate <= now);
          
          for (const subscription of activeSubscriptions) {
            await this.processSubscriptionPayment(userId, subscription);
          }
        } catch (error) {
          console.error(`[ERROR] Failed to process billing for user ${userId}:`, error);
          continue;
        }
      }
    } finally {
      this.isProcessingBilling = false;
    }
  }

  async processUsageTracking() {
    const now = Date.now();
    const accounts = await this.safeDbOperation(() => this.db.get('accounts') || []);

    for (const userId of accounts) {
      try {
        const resources = await this.db.get(`extra-${userId}`);
        if (!resources) continue;

        const usage = {
          timestamp: now,
          resources: { ...resources }
        };

        const usageHistory = await this.db.get(`usage-${userId}`) || [];
        usageHistory.push(usage);

        // Keep only last 30 days
        const thirtyDaysAgo = now - (MAX_HISTORY_DAYS * 24 * HOUR_IN_MS);
        const filteredHistory = usageHistory.filter(u => u.timestamp > thirtyDaysAgo);
        
        await this.db.set(`usage-${userId}`, filteredHistory);
      } catch (error) {
        console.error(`[ERROR] Failed to track usage for user ${userId}:`, error);
        continue;
      }
    }
  }
}

const RENEWAL_BYPASS_PRICE = 3500;
const RESOURCE_PRICES = {
  ram: 600,     // coins per GB
  disk: 50,     // coins per 5GB
  cpu: 500,     // coins per 100% CPU
  servers: 200  // coins per server
};

// Resource multipliers to convert units to actual values
const RESOURCE_MULTIPLIERS = {
  ram: 1024,    // 1 unit = 1024 MB (1 GB)
  disk: 5120,   // 1 unit = 5120 MB (5 GB)
  cpu: 100,     // 1 unit = 100% CPU
  servers: 1    // 1 unit = 1 server
};

// Maximum resource limits per user
const MAX_RESOURCE_LIMITS = {
  ram: 96,      // 32 GB
  disk: 200,    // 1TB (200 * 5GB)
  cpu: 36,      // 1000% (10 * 100%)
  servers: 20   // 20 servers
};

class StoreError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

class Store {
  constructor(db) {
    this.db = db;
  }

  async purchaseRenewalBypass(userId) {
    // Check user's balance
    const userCoins = await this.db.get(`coins-${userId}`) || 0;
    
    if (userCoins < RENEWAL_BYPASS_PRICE) {
      throw new StoreError(
        'Insufficient funds to purchase renewal bypass',
        'INSUFFICIENT_FUNDS'
      );
    }

    // Deduct coins
    const newBalance = userCoins - RENEWAL_BYPASS_PRICE;
    await this.db.set(`coins-${userId}`, newBalance);

    // Set renewal bypass flag
    await this.db.set(`renewbypass-${userId}`, true);

    // Log purchase
    const purchase = await this.logPurchase(userId, 'renewal_bypass', 1, RENEWAL_BYPASS_PRICE);

    return {
      purchase,
      remainingCoins: newBalance
    };
  }

  async hasRenewalBypass(userId) {
    return await this.db.get(`renewbypass-${userId}`) || false;
  }

  validateResourceAmount(resourceType, amount) {
    if (!RESOURCE_PRICES[resourceType]) {
      throw new StoreError('Invalid resource type', 'INVALID_RESOURCE');
    }
    
    if (!Number.isInteger(amount) || amount < 1) {
      throw new StoreError('Amount must be a positive integer', 'INVALID_AMOUNT');
    }

    return true;
  }

  async updateResourceLimits(userId, resourceType, amount) {
    const extra = await this.db.get(`extra-${userId}`) || {
      ram: 0,
      disk: 0,
      cpu: 0,
      servers: 0
    };

    // Calculate actual resource amount using multiplier
    const actualAmount = amount * RESOURCE_MULTIPLIERS[resourceType];
    const newAmount = extra[resourceType] + actualAmount;

    // Check against maximum limits
    const maxLimit = MAX_RESOURCE_LIMITS[resourceType] * RESOURCE_MULTIPLIERS[resourceType];
    if (newAmount > maxLimit) {
      throw new StoreError(
        `Resource limit exceeded. Maximum ${resourceType} limit is ${MAX_RESOURCE_LIMITS[resourceType]} units`,
        'RESOURCE_LIMIT_EXCEEDED'
      );
    }

    extra[resourceType] = newAmount;
    await this.db.set(`extra-${userId}`, extra);
    
    return extra;
  }

  async logPurchase(userId, resourceType, amount, cost) {
    const purchase = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId,
      resourceType,
      amount,
      cost,
      timestamp: Date.now()
    };
    
    const history = await this.db.get(`purchases-${userId}`) || [];
    history.push(purchase);
    await this.db.set(`purchases-${userId}`, history);
    
    return purchase;
  }
}

module.exports.load = function(app, db) {
    
  const billingManager = new BillingManager(db);
  const store = new Store(db); 

class StoreController {
  static async handleRenewalBypassPurchase(req, res) {
    try {
      if (!req.session.userinfo) {
        return this.sendError(res, 401, 'Unauthorized');
      }

      const userId = req.session.userinfo.id;

      if (billingManager.rateLimiter.isRateLimited(userId)) {
        return this.sendError(res, 429, 'Rate limit exceeded');
      }

      // Check if user already has renewal bypass
      const hasRenewalBypass = await db.get(`renewbypass-${userId}`);
      if (hasRenewalBypass) {
        return this.sendError(res, 400, 'Renewal bypass already purchased');
      }

      // Get user's current coins
      const userCoins = await db.get(`coins-${userId}`) || 0;
      
      // Check if user has enough coins
      if (userCoins < RENEWAL_BYPASS_PRICE) {
        return this.sendError(res, 402, {
          error: 'Insufficient funds',
          required: RENEWAL_BYPASS_PRICE,
          balance: userCoins
        });
      }

      // Deduct coins and set renewal bypass
      const newBalance = userCoins - RENEWAL_BYPASS_PRICE;
      await db.set(`coins-${userId}`, newBalance);
      await db.set(`renewbypass-${userId}`, true);

      // Log the purchase
      const purchase = await store.logPurchase(userId, 'renewal_bypass', 1, RENEWAL_BYPASS_PRICE);

      res.json({
        success: true,
        purchase,
        remainingCoins: newBalance,
        hasRenewalBypass: true
      });

    } catch (error) {
      console.error('[ERROR] Renewal bypass purchase failed:', error);
      return this.handleUnexpectedError(res, error);
    }
  }

  static async checkRenewalBypassStatus(req, res) {
    try {
      if (!req.session.userinfo) {
        return this.sendError(res, 401, 'Unauthorized');
      }

      const userId = req.session.userinfo.id;
      const hasRenewalBypass = await db.get(`renewbypass-${userId}`);
      const currentBalance = await db.get(`coins-${userId}`) || 0;

      res.json({
        hasRenewalBypass,
        price: RENEWAL_BYPASS_PRICE,
        canAfford: currentBalance >= RENEWAL_BYPASS_PRICE,
        currentBalance
      });
    } catch (error) {
      console.error('[ERROR] Failed to fetch renewal bypass status:', error);
      return this.handleUnexpectedError(res, error);
    }
  }

  // Utility to handle errors
  static sendError(res, status, message) {
    return res.status(status).json({ error: message });
  }

  // Utility to handle unexpected errors
  static handleUnexpectedError(res, error) {
    if (error.name === 'BillingError') {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Define the routes and bind them to the controller methods
app.post('/api/store/renewal-bypass', (req, res) => StoreController.handleRenewalBypassPurchase(req, res));
app.get('/api/store/renewal-bypass', (req, res) => StoreController.checkRenewalBypassStatus(req, res));

  // Buy resource endpoint
  app.post('/api/store/buy', requireAuth, async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const { resourceType, amount } = req.body;

      // Validate request
      store.validateResourceAmount(resourceType, amount);

      // Calculate cost
      const cost = RESOURCE_PRICES[resourceType] * amount;

      // Check user's balance
      const userCoins = await db.get(`coins-${userId}`) || 0;
      if (userCoins < cost) {
        return res.status(402).json({ 
          error: 'Insufficient funds',
          required: cost,
          balance: userCoins
        });
      }

      // Update resources
      const updatedResources = await store.updateResourceLimits(userId, resourceType, amount);

      // Deduct payment
      const newBalance = userCoins - cost;
      await db.set(`coins-${userId}`, newBalance);
      
      // Log purchase
      const purchase = await store.logPurchase(userId, resourceType, amount, cost);

      res.json({
        success: true,
        purchase,
        resources: updatedResources,
        remainingCoins: newBalance
      });

    } catch (error) {
      console.error('[ERROR] Purchase failed:', error);
      
      if (error instanceof StoreError) {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get purchase history endpoint
  app.get('/api/store/history', requireAuth, async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const history = await db.get(`purchases-${userId}`) || [];
      
      res.json(history);
    } catch (error) {
      console.error('[ERROR] Failed to fetch purchase history:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get current resources endpoint
  app.get('/api/store/resources', requireAuth, async (req, res) => {
    try {

      const userId = req.session.userinfo.id;
      const resources = await db.get(`extra-${userId}`) || {
        ram: 0,
        disk: 0,
        cpu: 0,
        servers: 0
      };
      
      res.json(resources);
    } catch (error) {
      console.error('[ERROR] Failed to fetch resources:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
};