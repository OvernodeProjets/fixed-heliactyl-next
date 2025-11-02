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
  "target_platform": "3.2.1"
};

module.exports.heliactylModule = heliactylModule;

const AFKRewardsManager = require('../handlers/AFKRewardsManager');
const clusterId = `cluster-${Math.random().toString(36).substring(7)}`;

module.exports.load = function(app, db) {
  const afkManager = new AFKRewardsManager(db);

  app.ws('/afk/ws', async function(ws, req) {
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
      afkManager.scheduleNextReward(userId, ws, username);
      
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