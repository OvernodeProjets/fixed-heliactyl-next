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
  "name": "Staking Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

module.exports.load = async function (app, db) {
  // Configuration
  const DAILY_INTEREST_RATE = 0.05; // 5% daily interest
  const MIN_STAKE_AMOUNT = 10; // Minimum amount to stake
  const LOCK_PERIODS = {
    '30d': { days: 30, bonus: 0.2 }, // 20% bonus
    '90d': { days: 90, bonus: 0.5 }, // 50% bonus
    '180d': { days: 180, bonus: 1.0 }, // 100% bonus
  };
  const MASTER_USER_ID = "MASTER";
  const EARLY_WITHDRAWAL_PENALTY = 0.5; // 50% penalty on earnings for early withdrawal
const RATE_LIMIT_WINDOW = 3000; // 3 seconds in milliseconds
const lastRequestTimes = new Map(); // Store last request times per user

  // Helper function to calculate compound interest
  const calculateEarnings = (stakedAmount, lastStakeTime, lockPeriod) => {
    const msStaked = Date.now() - lastStakeTime;
    const daysStaked = msStaked / (24 * 60 * 60 * 1000);
    
    // Compound interest formula: A = P(1 + r)^t
    const baseRate = DAILY_INTEREST_RATE / 365; // Convert to daily rate
    const periodBonus = LOCK_PERIODS[lockPeriod]?.bonus || 0;
    const effectiveRate = baseRate * (1 + periodBonus);
    
    return stakedAmount * (Math.pow(1 + effectiveRate, daysStaked) - 1);
  };

  // Helper function to log transactions
  async function logTransaction(senderId, receiverId, amount, description) {
  }

  // Migrate old staking data to new format
  async function migrateStakingData(userId) {
    const oldStakedAmount = await db.get(`staked-${userId}`);
    const oldLastStakeTime = await db.get(`lastStakeTime-${userId}`);
    
    if (oldStakedAmount && oldStakedAmount > 0) {
      // Create new staking position with 30-day lock
      const newStakingPosition = {
        amount: oldStakedAmount,
        startTime: oldLastStakeTime || Date.now(),
        lockPeriod: '30d',
        lastClaimTime: oldLastStakeTime || Date.now(),
        positionId: require('crypto').randomBytes(16).toString('hex')
      };
      
      const userPositions = await db.get(`staking-positions-${userId}`) || [];
      userPositions.push(newStakingPosition);
      
      await db.set(`staking-positions-${userId}`, userPositions);
      
      // Clear old data
      await db.delete(`staked-${userId}`);
      await db.delete(`lastStakeTime-${userId}`);
      
      return newStakingPosition;
    }
    return null;
  }

  const rateLimit = (req, res, next) => {
    const userId = req.session.userinfo.id;
    const now = Date.now();
    const lastRequest = lastRequestTimes.get(userId) || 0;
    
    if (now - lastRequest < RATE_LIMIT_WINDOW) {
      return res.status(429).json({
        error: "Rate limit exceeded",
        retryAfter: Math.ceil((RATE_LIMIT_WINDOW - (now - lastRequest)) / 1000)
      });
    }
    
    lastRequestTimes.set(userId, now);
    next();
  };

  // Modified staking endpoint with rate limiting
  app.post("/stake", rateLimit, async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/auth`);
    
    const { amount, lockPeriod } = req.body;
    const parsedAmount = parseFloat(amount);
    
    // Rest of the stake endpoint implementation remains the same...
    if (!LOCK_PERIODS[lockPeriod]) {
      return res.status(400).json({ error: "Invalid lock period" });
    }
    
    if (isNaN(parsedAmount) || parsedAmount < MIN_STAKE_AMOUNT) {
      return res.status(400).json({ 
        error: `Invalid amount. Minimum stake is ${MIN_STAKE_AMOUNT} coins.` 
      });
    }
    
    const userId = req.session.userinfo.id;
    const userCoins = await db.get(`coins-${userId}`) || 0;
    
    if (userCoins < parsedAmount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    
    // Create new staking position
    const newPosition = {
      amount: parsedAmount,
      startTime: Date.now(),
      lockPeriod,
      lastClaimTime: Date.now(),
      positionId: require('crypto').randomBytes(16).toString('hex')
    };
    
    const userPositions = await db.get(`staking-positions-${userId}`) || [];
    userPositions.push(newPosition);
    
    // Update balances
    await db.set(`staking-positions-${userId}`, userPositions);
    await db.set(`coins-${userId}`, userCoins - parsedAmount);
    await logTransaction(userId, MASTER_USER_ID, parsedAmount, `Staked with ${lockPeriod} lock`);
    
    res.status(200).json({ 
      message: "Staked successfully", 
      position: newPosition 
    });
  });

  // Modified unstaking endpoint with rate limiting
  app.post("/unstake", rateLimit, async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/auth`);
    
    const { positionId } = req.body;
    const userId = req.session.userinfo.id;
    
    // Rest of the unstake endpoint implementation remains the same...
    const positions = await db.get(`staking-positions-${userId}`) || [];
    const positionIndex = positions.findIndex(p => p.positionId === positionId);
    
    if (positionIndex === -1) {
      return res.status(400).json({ error: "Invalid position" });
    }
    
    const position = positions[positionIndex];
    const lockPeriodMs = LOCK_PERIODS[position.lockPeriod].days * 24 * 60 * 60 * 1000;
    const isLocked = Date.now() - position.startTime < lockPeriodMs;
    
    let earnings = calculateEarnings(
      position.amount, 
      position.lastClaimTime, 
      position.lockPeriod
    );
    
    if (isLocked) {
      earnings *= (1 - EARLY_WITHDRAWAL_PENALTY);
    }
    
    const userCoins = await db.get(`coins-${userId}`) || 0;
    const totalReturn = position.amount + earnings;
    
    await db.set(`coins-${userId}`, userCoins + totalReturn);
    
    positions.splice(positionIndex, 1);
    await db.set(`staking-positions-${userId}`, positions);
    
    await logTransaction(
      MASTER_USER_ID, 
      userId, 
      position.amount, 
      `Unstaked position ${positionId}`
    );
    
    if (earnings > 0) {
      await logTransaction(
        MASTER_USER_ID, 
        userId, 
        earnings, 
        `Staking earnings for position ${positionId}`
      );
    }
    
    res.status(200).json({
      message: "Unstaked successfully",
      returned: totalReturn,
      principal: position.amount,
      earnings,
      penaltyApplied: isLocked
    });
  });

  // View staking positions and earnings
  app.get("/stake/positions", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/auth`);
    
    const userId = req.session.userinfo.id;
    
    // Migrate old staking data if needed
    const positions = await db.get(`staking-positions-${userId}`);
    if (!positions) {
      const migratedPosition = await migrateStakingData(userId);
      if (migratedPosition) {
        return res.status(200).json({
          positions: [migratedPosition],
          message: "Staking data migrated to new format"
        });
      }
    }
    
    // Calculate current earnings for each position
    const positionsWithEarnings = (positions || []).map(position => {
      const earnings = calculateEarnings(
        position.amount,
        position.lastClaimTime,
        position.lockPeriod
      );
      
      const lockPeriodMs = LOCK_PERIODS[position.lockPeriod].days * 24 * 60 * 60 * 1000;
      const unlockTime = position.startTime + lockPeriodMs;
      
      return {
        ...position,
        currentEarnings: earnings,
        unlockTime,
        isLocked: Date.now() < unlockTime
      };
    });
    
    res.status(200).json({
      positions: positionsWithEarnings
    });
  });

  app.get("/stake/positions/:positionId", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/auth`);
    
    const userId = req.session.userinfo.id;
    const { positionId } = req.params;
    
    try {
      const positions = await db.get(`staking-positions-${userId}`) || [];
      const position = positions.find(p => p.positionId === positionId);
      
      if (!position) {
        return res.status(404).json({ error: "Position not found" });
      }
      
      // Calculate current earnings
      const earnings = calculateEarnings(
        position.amount,
        position.lastClaimTime,
        position.lockPeriod
      );
      
      // Calculate lock status
      const lockPeriodMs = LOCK_PERIODS[position.lockPeriod].days * 24 * 60 * 60 * 1000;
      const unlockTime = position.startTime + lockPeriodMs;
      const isLocked = Date.now() < unlockTime;
      
      // Calculate APR including bonus
      const baseAPR = DAILY_INTEREST_RATE * 365 * 100; // Convert daily rate to yearly percentage
      const bonusAPR = baseAPR * (1 + LOCK_PERIODS[position.lockPeriod].bonus);
      
      // Return enriched position data
      res.status(200).json({
        position: {
          ...position,
          currentEarnings: earnings,
          unlockTime,
          isLocked,
          baseAPR,
          bonusAPR,
          lockPeriodDays: LOCK_PERIODS[position.lockPeriod].days,
          earlyWithdrawalPenalty: EARLY_WITHDRAWAL_PENALTY * 100, // Convert to percentage
          projectedEarnings: position.amount * (DAILY_INTEREST_RATE * 
            (1 + LOCK_PERIODS[position.lockPeriod].bonus)) * 
            (LOCK_PERIODS[position.lockPeriod].days),
          timeRemaining: Math.max(0, unlockTime - Date.now()),
          lastUpdate: Date.now()
        }
      });
    } catch (error) {
      console.error('Error fetching position details:', error);
      res.status(500).json({ error: "Failed to fetch position details" });
    }
  });

  // Claim earnings for a specific position
  app.post("/stake/claim", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect(`/auth`);
    
    const { positionId } = req.body;
    const userId = req.session.userinfo.id;
    
    // Get user's staking positions
    const positions = await db.get(`staking-positions-${userId}`) || [];
    const positionIndex = positions.findIndex(p => p.positionId === positionId);
    
    if (positionIndex === -1) {
      return res.status(400).json({ error: "Invalid position" });
    }
    
    const position = positions[positionIndex];
    const earnings = calculateEarnings(
      position.amount,
      position.lastClaimTime,
      position.lockPeriod
    );
    
    if (earnings <= 0) {
      return res.status(400).json({ error: "No earnings to claim" });
    }
    
    // Update user balance and last claim time
    const userCoins = await db.get(`coins-${userId}`) || 0;
    await db.set(`coins-${userId}`, userCoins + earnings);
    
    position.lastClaimTime = Date.now();
    positions[positionIndex] = position;
    await db.set(`staking-positions-${userId}`, positions);
    
    // Log the transaction
    await logTransaction(
      MASTER_USER_ID, 
      userId, 
      earnings, 
      `Claimed earnings for position ${positionId}`
    );
    
    res.status(200).json({
      message: "Earnings claimed successfully",
      claimedAmount: earnings,
      newBalance: userCoins + earnings,
      position: position
    });
  });
};