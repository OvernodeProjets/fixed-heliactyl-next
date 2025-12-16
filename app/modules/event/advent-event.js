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
 */

const heliactylModule = {
  "name": "Advent Calendar Module",
  "target_platform": "latest"
};

module.exports.heliactylModule = heliactylModule;

const crypto = require('crypto');
const { requireAuth } = require('../../handlers/checkMiddleware.js');
const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const { discordLog, addNotification } = require("../../handlers/log.js");

// Define reward types and their possible values - balanced for daily rewards
const REWARD_TYPES = {
  CURRENCY: {
    type: settings.website.currency,
    values: [5, 10, 15, 25, 50, 75, 100],
    special: false
  },
  RAM: {
    type: 'ram',
    values: [128, 256, 512, 768],
    special: false
  },
  DISK: {
    type: 'disk',
    values: [512, 1024, 2048, 3072],
    special: false
  },
  CPU: {
    type: 'cpu',
    values: [5, 10, 25, 50],
    special: false
  },
  SERVERS: {
    type: 'servers',
    values: [1, 2],
    special: false
  },
  // Custom rewards - only included if enabled
  ...(settings.advent?.customRewards?.enabled === true ? {
    SPECIAL: {
      type: 'special',
      values: settings.advent?.customRewards?.rewards || [],
      special: true
    }
  } : {})
};

class AdventCalendarManager {
  constructor(db) {
    this.db = db;
    this.year = new Date().getFullYear();
    this.totalDays = 31; // Dec 1 to Dec 31
  }

  isValidDate() {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    
    // Create date objects for the start and end of the event
    const startDate = new Date(currentYear, 11, 1, 0, 0, 0); // December 1, 00:00:00
    const endDate = new Date(currentYear, 11, 31, 23, 59, 59); // December 31, 23:59:59
    
    return currentDate >= startDate && currentDate <= endDate;
  }

  getDayNumber(date = new Date()) {
    const year = date.getFullYear();
    const startDate = new Date(year, 11, 1); // December 1
    const diffTime = date - startDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  }

  getDateFromDayNumber(day) {
    const year = new Date().getFullYear();
    const startDate = new Date(year, 11, 1); // December 1
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + day - 1);
    return date;
  }

  generateReward() {
    // 1% chance for special rewards, 99% for regular rewards - balanced
    // Only if SPECIAL rewards are enabled and configured
    const hasSpecialRewards = REWARD_TYPES.SPECIAL && 
                              REWARD_TYPES.SPECIAL.values && 
                              REWARD_TYPES.SPECIAL.values.length > 0;
    const isSpecial = hasSpecialRewards && Math.random() < 0.01;
    
    if (isSpecial) {
      return {
        type: REWARD_TYPES.SPECIAL.type,
        special: REWARD_TYPES.SPECIAL.values[
          Math.floor(Math.random() * REWARD_TYPES.SPECIAL.values.length)
        ],
        isSpecial: true
      };
    }

    // Select random reward type (excluding SPECIAL) with weighted probabilities
    const regularTypes = [
      { type: REWARD_TYPES.CURRENCY, weight: 40 }, // 40% chance
      { type: REWARD_TYPES.RAM, weight: 20 },      // 20% chance
      { type: REWARD_TYPES.DISK, weight: 20 },     // 20% chance
      { type: REWARD_TYPES.CPU, weight: 15 },      // 15% chance
      { type: REWARD_TYPES.SERVERS, weight: 5 }    // 5% chance
    ];
    
    const totalWeight = regularTypes.reduce((sum, t) => sum + t.weight, 0);
    let random = Math.random() * totalWeight;
    
    let selectedType;
    for (const typeObj of regularTypes) {
      random -= typeObj.weight;
      if (random <= 0) {
        selectedType = typeObj.type;
        break;
      }
    }
    
    const value = selectedType.values[Math.floor(Math.random() * selectedType.values.length)];

    return {
      type: selectedType.type,
      value,
      isSpecial: false
    };
  }

  async claimReward(userId, day) {
    try {
      // Check if event is active
      if (!this.isValidDate()) {
        throw new Error('Advent Calendar event is not active');
      }

      // Get user's claimed rewards
      const claims = await this.db.get(`advent-claims-${userId}-${this.year}`) || [];
      
      // Check if reward was already claimed
      if (claims.find(claim => claim.day === day)) {
        throw new Error('Reward already claimed for this day');
      }

      // Validate day is within range
      const currentDay = this.getDayNumber();
      if (day < 1 || day > this.totalDays) {
        throw new Error('Invalid day for advent calendar');
      }

      if (day > currentDay) {
        throw new Error('Cannot claim future rewards');
      }

      // Generate reward
      // Only allow claiming on the same day (past days are expired)
      if (day < currentDay) {
        throw new Error('You can only claim rewards on the current day. This reward has expired.');
      }
      const reward = this.generateReward();
      const rewardId = crypto.randomUUID();

      // Create claim record
      const claim = {
        id: rewardId,
        day,
        year: this.year,
        type: reward.type,
        value: reward.value,
        special: reward.special,
        isSpecial: reward.isSpecial,
        claimedAt: new Date().toISOString()
      };

      // Save claim
      claims.push(claim);
      await this.db.set(`advent-claims-${userId}-${this.year}`, claims);

      // Process reward
      if (reward.isSpecial) {
        // Special rewards need manual processing
        console.log(`[AdventCalendar] Special reward ${reward.special} claimed by ${userId}`);
        return {
          id: rewardId,
          type: reward.type,
          special: reward.special,
          isSpecial: true,
          status: 'pending_manual_processing'
        };
      }

      // Process automatic rewards
      switch (reward.type) {
        case settings.website.currency:
          const currentCoins = await this.db.get(`coins-${userId}`) || 0;
          await this.db.set(`coins-${userId}`, currentCoins + reward.value);
          break;

        case 'ram':
        case 'disk':
        case 'cpu':
        case 'servers':
          const extra = await this.db.get(`extra-${userId}`) || {
            ram: 0,
            disk: 0,
            cpu: 0,
            servers: 0
          };
          extra[reward.type] += reward.value;
          await this.db.set(`extra-${userId}`, extra);
          break;
      }

      return {
        id: rewardId,
        type: reward.type,
        value: reward.value,
        isSpecial: false,
        status: 'claimed'
      };

    } catch (error) {
      console.error('[ERROR] Failed to claim reward:', error);
      throw error;
    }
  }

  async getUserCalendar(userId) {
    try {
      // Get user's claimed rewards
      const claims = await this.db.get(`advent-claims-${userId}-${this.year}`) || [];
      
      // Create calendar array for all days
      const calendar = Array.from({ length: this.totalDays }, (_, i) => {
        const dayNumber = i + 1;
        const date = this.getDateFromDayNumber(dayNumber);
        const claimed = claims.find(claim => claim.day === dayNumber);
        
        if (claimed) {
          return {
            day: dayNumber,
            date: date.toISOString(),
            claimed: true,
            reward: {
              type: claimed.type,
              value: claimed.value,
              special: claimed.special,
              isSpecial: claimed.isSpecial
            },
            claimedAt: claimed.claimedAt
          };
        }
        
        const currentDay = this.getDayNumber();
        const isToday = dayNumber === currentDay;
        const isPast = dayNumber < currentDay;
        
        return {
          day: dayNumber,
          date: date.toISOString(),
          claimed: false,
          available: isToday,
          expired: isPast
        };
      });

      return {
        calendar,
        eventActive: this.isValidDate(),
        currentDay: this.getDayNumber(),
        totalDays: this.totalDays
      };

    } catch (error) {
      console.error('[ERROR] Failed to get user calendar:', error);
      throw error;
    }
  }
}

module.exports.load = function(router, db) {
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);
  const adventCalendar = new AdventCalendarManager(db);

  // Claim daily reward
  router.post('/advent/claim/:day', authMiddleware, async (req, res) => {
    try {
      // Check if advent calendar is enabled
      if (settings.advent?.enabled !== true) {
        return res.status(400).json({ error: 'Advent Calendar is currently disabled' });
      }

      const userId = req.session.userinfo.id;
      const day = parseInt(req.params.day);

      const reward = await adventCalendar.claimReward(userId, day);

      // Send notification
      await addNotification(
        db,
        userId,
        "advent-calendar",
        "You claimed a reward from the advent calendar!",
        req.ip,
        req.headers['user-agent']
      );

      discordLog(
        "advent calendar",
        `${req.session.userinfo.username} and with the userid \`${req.session.userinfo.id}\` claimed a reward from the advent calendar! (${reward.type} ${reward.value})`
      );

      res.json({
        success: true,
        reward
      });
    } catch (error) {
      console.error('[ERROR] Failed to claim reward:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get user's calendar
  router.get('/advent/calendar', authMiddleware, async (req, res) => {
    try {
      // Check if advent calendar is enabled
      if (settings.advent?.enabled !== true) {
        return res.status(400).json({ error: 'Advent Calendar is currently disabled' });
      }

      if (!adventCalendar.isValidDate()) {
        return res.status(400).json({ error: 'Advent Calendar event is not active' });
      }

      const userId = req.session.userinfo.id;
      const calendar = await adventCalendar.getUserCalendar(userId);
      
      res.json(calendar);
    } catch (error) {
      console.error('[ERROR] Failed to get calendar:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
};