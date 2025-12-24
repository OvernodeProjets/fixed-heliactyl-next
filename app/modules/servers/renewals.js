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
  "name": "Renewals Server Module",
  "target_platform": "3.2.1-beta.1"
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const { requireAuth, ownsServer } = require("../../handlers/checkMiddleware.js");
const { getClientAPI } = require("../../handlers/pterodactylSingleton.js");
const { serverActivityLog } = require("../../handlers/log.js");
const getPteroUser = require("../../handlers/getPteroUser.js");

module.exports.load = async function (router, db) {
  const ClientAPI = getClientAPI();
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);

  // Add these constants at the top of the file
  const RENEWAL_PERIOD_HOURS = settings.renewal?.renewal_period || 48;
  const WARNING_THRESHOLD_HOURS = settings.renewal?.warning_threshold || 24; // When to start showing warnings
  const CHECK_INTERVAL_MINUTES = settings.renewal?.check_interval || 5; // How often to check for expired servers

  async function initializeRenewalSystem(db) {
    // Start the background task to check for expired servers
    setInterval(async () => {
      await checkExpiredServers(db);
    }, CHECK_INTERVAL_MINUTES * 60 * 1000);
  }

  async function getRenewalStatus(db, serverId, user) {
    try {
      const renewalData = await db.get(`renewal_${serverId}`);
      const hasRenewalBypass = await db.get(`renewbypass-${user}`);

      if (!renewalData) {
        // Initialize renewal data if it doesn't exist
        const now = new Date();
        const nextRenewal = hasRenewalBypass ?
          new Date('2099-12-31T23:59:59.999Z').toISOString() :
          new Date(now.getTime() + RENEWAL_PERIOD_HOURS * 60 * 60 * 1000).toISOString();

        const initialRenewalData = {
          lastRenewal: now.toISOString(),
          nextRenewal: nextRenewal,
          isActive: true,
          renewalCount: 0,
          hasRenewalBypass: hasRenewalBypass,
          userId: user // Store userId for future reference
        };
        await db.set(`renewal_${serverId}`, initialRenewalData);
        return initialRenewalData;
      }

      // If renewal bypass has been purchased, update the nextRenewal date
      if (hasRenewalBypass && !renewalData.hasRenewalBypass) {
        const updatedRenewalData = {
          ...renewalData,
          nextRenewal: new Date('2099-12-31T23:59:59.999Z').toISOString(),
          hasRenewalBypass: true,
          isActive: true, // Ensure server is active if it was previously expired
          userId: user || renewalData.userId // Update userId if provided
        };
        await db.set(`renewal_${serverId}`, updatedRenewalData);
        return updatedRenewalData;
      }

      // Ensure userId is stored if missing and provided
      if (user && !renewalData.userId) {
        renewalData.userId = user;
        await db.set(`renewal_${serverId}`, renewalData);
      }

      return renewalData;
    } catch (error) {
      console.error(`Error getting renewal status for server ${serverId}:`, error);
      throw new Error('Failed to get renewal status');
    }
  }

  async function renewServer(db, serverId) {
    try {
      const now = new Date();
      const renewalData = await getRenewalStatus(db, serverId);

      // Update renewal data
      const updatedRenewalData = {
        lastRenewal: now.toISOString(),
        nextRenewal: new Date(now.getTime() + RENEWAL_PERIOD_HOURS * 60 * 60 * 1000).toISOString(),
        isActive: true,
        renewalCount: (renewalData.renewalCount || 0) + 1,
        userId: renewalData.userId // Preserve userId
      };

      await db.set(`renewal_${serverId}`, updatedRenewalData);
      await serverActivityLog(db, serverId, 'Server Renewal', {
        renewalCount: updatedRenewalData.renewalCount,
        nextRenewal: updatedRenewalData.nextRenewal
      });

      return updatedRenewalData;
    } catch (error) {
      console.error(`Error renewing server ${serverId}:`, error);
      throw new Error('Failed to renew server');
    }
  }

  async function listKeys(prefix) {
    return new Promise((resolve, reject) => {
      const keys = [];
      db.db.each(
        "SELECT [key] FROM keyv WHERE [key] LIKE ?",
        [`${db.namespace}:${prefix}%`],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            keys.push(row.key.replace(`${db.namespace}:`, ''));
          }
        },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(keys);
          }
        }
      );
    });
  }

  async function checkExpiredServers(db) {
    try {
      // Get all renewal keys from the database
      const renewalKeys = await listKeys('renewal_');
      const now = new Date();

      for (const key of renewalKeys) {
        const serverId = key.replace('renewal_', '');
        const renewalData = await db.get(key);

        if (!renewalData || !renewalData.isActive) continue;

        const nextRenewal = new Date(renewalData.nextRenewal);
        const hoursUntilExpiration = (nextRenewal - now) / (1000 * 60 * 60);

        // If server is expired, shut it down
        if (hoursUntilExpiration <= 0) {
          await handleExpiredServer(db, serverId);
        }
        // If server is approaching expiration, log a warning
        else if (hoursUntilExpiration <= WARNING_THRESHOLD_HOURS) {
          await serverActivityLog(db, serverId, 'Renewal Warning', {
            hoursRemaining: Math.round(hoursUntilExpiration * 10) / 10
          });
        }
      }
    } catch (error) {
      console.error('Error checking expired servers:', error);
    }
  }

  async function handleExpiredServer(db, serverId) {
    try {
      // Update renewal status
      const renewalData = await db.get(`renewal_${serverId}`);
      renewalData.isActive = false;
      await db.set(`renewal_${serverId}`, renewalData);

      // Stop the server
      const powerResult = await ClientAPI.executePowerAction(serverId, 'stop');

      // If server not found (null result), clean up renewal data
      if (powerResult === null) {
        console.log(`Server ${serverId} not found during expiration check. Removing renewal data.`);
        await db.delete(`renewal_${serverId}`);

        // Update user data if we have the userId
        if (renewalData.userId) {
          console.log(`Refreshing user data for user ${renewalData.userId}`);
          await getPteroUser(renewalData.userId, db);
        }
        return;
      }

      console.log(`Server ${serverId} has expired and been stopped.`);

      // Log the expiration
      await serverActivityLog(db, serverId, 'Server Expired', {
        lastRenewal: renewalData.lastRenewal,
        renewalCount: renewalData.renewalCount
      });
    } catch (error) {
      console.error(`Error handling expired server ${serverId}:`, error);
    }
  }

  // Add these routes to the router
  router.get('/server/:id/renewal/status', authMiddleware, ownsServer(db), async (req, res) => {
    try {
      const serverId = req.params.id;
      const renewalStatus = await getRenewalStatus(db, serverId, req.session.userinfo.id);

      // Calculate time remaining
      const now = new Date();
      const nextRenewal = new Date(renewalStatus.nextRenewal);
      const timeRemaining = nextRenewal - now;

      // Format the response
      const response = {
        ...renewalStatus,
        timeRemaining: {
          total: timeRemaining,
          hours: Math.floor(timeRemaining / (1000 * 60 * 60)),
          minutes: Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60)),
          seconds: Math.floor((timeRemaining % (1000 * 60)) / 1000)
        },
        requiresRenewal: timeRemaining <= WARNING_THRESHOLD_HOURS * 60 * 60 * 1000,
        isExpired: timeRemaining <= 0,
        config: {
          renewalPeriod: RENEWAL_PERIOD_HOURS,
          warningThreshold: WARNING_THRESHOLD_HOURS
        }
      };

      res.json(response);
    } catch (error) {
      console.error('Error getting renewal status:', error);
      res.status(500).json({ error: 'Failed to get renewal status' });
    }
  });

  // And update the renewal endpoint validation in the POST route:
  router.post('/server/:id/renewal/renew', authMiddleware, ownsServer(db), async (req, res) => {
    try {
      const serverId = req.params.id;
      // Pass user ID to ensure it's stored/updated
      const currentStatus = await getRenewalStatus(db, serverId, req.session.userinfo.id);

      // Check if renewal is actually needed
      const now = new Date();
      const nextRenewal = new Date(currentStatus.nextRenewal);
      const timeRemaining = nextRenewal - now;

      // Allow renewal if less than 24 hours remaining or expired
      if (timeRemaining > WARNING_THRESHOLD_HOURS * 60 * 60 * 1000) {
        return res.status(400).json({
          error: 'Renewal not required yet',
          nextRenewal: currentStatus.nextRenewal,
          timeRemaining: {
            hours: Math.floor(timeRemaining / (1000 * 60 * 60)),
            minutes: Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))
          }
        });
      }

      // Process the renewal
      const renewalData = await renewServer(db, serverId);

      // If server was stopped due to expiration, restart it
      if (!currentStatus.isActive) {
        await ClientAPI.executePowerAction(serverId, 'start');
      }

      res.json({
        message: 'Server renewed successfully',
        renewalData
      });
    } catch (error) {
      console.error('Error renewing server:', error);
      res.status(500).json({ error: 'Failed to renew server' });
    }
  });


  // Initialize the renewal system when the module loads
  initializeRenewalSystem(db);
};