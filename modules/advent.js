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
  "name": "Advent Calendar Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const crypto = require('crypto');
const requireAuth = require('../handlers/requireAuth');
const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");

// Define reward types and their possible values
const REWARD_TYPES = {
  CURRENCY: {
    type: settings.website.currency,
    values: [25, 50, 100, 250, 500, 750, 1000, 1500, 2000],
    special: false
  },
  RAM: {
    type: 'ram',
    values: [256, 512, 768, 1024],
    special: false
  },
  DISK: {
    type: 'disk',
    values: [2048, 5120, 10240],
    special: false
  },
  CPU: {
    type: 'cpu',
    values: [10, 25, 50, 100],
    special: false
  },
  SERVERS: {
    type: 'servers',
    values: [2, 4, 6],
    special: false
  },
  SPECIAL: {
    type: 'special',
    values: [
      'discord_nitro_basic',
      'discord_nitro',
      'visa_5',
      'vps_1gb',
      'vps_2gb',
      'vps_4gb',
      'vps_8gb',
      'domain_com',
      'domain_couk'
    ],
    special: true
  }
};

class AdventCalendarManager {
  constructor(db) {
    this.db = db;
    this.year = new Date().getFullYear();
    this.totalDays = 45; // Nov 11 to Dec 25
  }

  isValidDate() {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    
    // Create date objects for the start and end of the event
    const startDate = new Date(currentYear, 10, 11, 0, 0, 0); // November 11, 00:00:00
    const endDate = new Date(currentYear, 11, 25, 23, 59, 59); // December 25, 23:59:59
    
    // Pour le debug
    console.log('Current Date:', currentDate);
    console.log('Start Date:', startDate);
    console.log('End Date:', endDate);
    console.log('Is Valid:', currentDate >= startDate && currentDate <= endDate);
    
    return currentDate >= startDate && currentDate <= endDate;
  }

  getDayNumber(date = new Date()) {
    const year = date.getFullYear();
    const startDate = new Date(year, 10, 11); // November 11
    const diffTime = date - startDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  }

  getDateFromDayNumber(day) {
    const year = new Date().getFullYear();
    const startDate = new Date(year, 10, 11); // November 11
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + day - 1);
    return date;
  }

  generateReward() {
    // 90% chance for regular rewards, 10% chance for special rewards
    const isSpecial = Math.random() < 0.0000000005;
    
    if (isSpecial) {
      return {
        type: REWARD_TYPES.SPECIAL.type,
        special: REWARD_TYPES.SPECIAL.values[
          Math.floor(Math.random() * REWARD_TYPES.SPECIAL.values.length)
        ],
        isSpecial: true
      };
    }

    // Select random reward type (excluding SPECIAL)
    const regularTypes = [
      REWARD_TYPES.CURRENCY,
      REWARD_TYPES.RAM,
      REWARD_TYPES.DISK,
      REWARD_TYPES.CPU,
      REWARD_TYPES.SERVERS
    ];
    
    const selectedType = regularTypes[Math.floor(Math.random() * regularTypes.length)];
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
        
        return {
          day: dayNumber,
          date: date.toISOString(),
          claimed: false,
          available: this.getDayNumber() >= dayNumber
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

module.exports.load = function(app, db) {
  const adventCalendar = new AdventCalendarManager(db);

  // Claim daily reward
  app.post('/api/advent/claim/:day', requireAuth, async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const day = parseInt(req.params.day);

      const reward = await adventCalendar.claimReward(userId, day);
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
  app.get('/api/advent/calendar', requireAuth, async (req, res) => {
    try {
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