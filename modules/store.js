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

const { requireAuth } = require("../handlers/checkMiddleware.js");
const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");

const RENEWAL_BYPASS_PRICE = settings.api.client.coins.store.renewalbypass.cost;
const RESOURCE_PRICES = {
  ram: settings.api.client.coins.store.ram.cost,     // coins per GB
  disk: settings.api.client.coins.store.disk.cost,   // coins per 5GB
  cpu: settings.api.client.coins.store.cpu.cost,     // coins per 100% CPU
  servers: settings.api.client.coins.store.servers.cost  // coins per server
};

// Resource multipliers to convert units to actual values
const RESOURCE_MULTIPLIERS = {
  ram: settings.api.client.coins.store.ram.per,    // 1 unit = 1024 MB (1 GB)
  disk: settings.api.client.coins.store.disk.per,   // 1 unit = 5120 MB (5 GB)
  cpu: settings.api.client.coins.store.cpu.per,     // 1 unit = 100% CPU
  servers: settings.api.client.coins.store.servers.per    // 1 unit = 1 server
};

// Maximum resource limits per user
const MAX_RESOURCE_LIMITS = {
  ram: settings.api.client.coins.store.ram.limit,      // 32 GB
  disk: settings.api.client.coins.store.disk.limit,    // 1TB (200 * 5GB)
  cpu: settings.api.client.coins.store.cpu.limit,      // 1000% (10 * 100%)
  servers: settings.api.client.coins.store.servers.limit   // 20 servers
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
  
  const store = new Store(db); 

class StoreController {
  static async handleRenewalBypassPurchase(req, res) {
    try {
      if (!req.session.userinfo) {
        return this.sendError(res, 401, 'Unauthorized');
      }

      const userId = req.session.userinfo.id;

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