
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
  "name": "Alts Module",
  "target_platform": "3.2.1-beta.1"
};

module.exports.heliactylModule = heliactylModule;

const { requireAuth } = require("../../handlers/checkMiddleware.js");

module.exports.load = async function (router, db) {
  const requireAdmin = (req, res, next) => requireAuth(req, res, next, true, db);
  // GET /api/admin/alts/:userid - Get alts for a user based on IP
  router.get('/admin/alts/:ip', requireAdmin, async (req, res) => {
    try {
      const userId = req.params.userid;
      
      // Get the IP associated with this user
      const userIp = await db.get(`ipuser-${userId}`);
      
      if (!userIp) {
        return res.status(404).json({ error: 'No IP found' });
      }
      
      // Find all users with this IP
      const allUsers = await db.get('users') || [];
      const alts = [];
      
      for (const id of allUsers) {
        const ipForThisUser = await db.get(`ipuser-${id}`);
        if (ipForThisUser === userIp && id !== userId) {
          alts.push(id);
        }
      }
      
      res.json({
        userId: userId,
        ip: userIp,
        alts: alts
      });
    } catch (error) {
      console.error('Error in /api/admin/alts/:userid route:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  // POST /api/admin/alts/bypass/:userId - Bypass anti-alt check for a user
  router.post('/admin/alts/bypass/:userId', requireAdmin, async (req, res) => {
    try {
      const userId = req.params.userId;
      
      // Check if the user exists
      const userExists = await db.get(`users-${userId}`);
      if (!userExists) {
        return res.status(404).json({ error: 'User not found' });
      }
  
      // Set a bypass flag for this user
      await db.set(`antialt-bypass-${userId}`, true);
      
      // Get the IP associated with this user (if any)
      const userIp = await db.get(`ipuser-${userId}`);
  
      res.json({
        success: true,
        message: `Anti-alt check bypassed for user ${userId}`,
        userIp: userIp || 'No IP associated'
      });
  
    } catch (error) {
      console.error('Error in /admin/alts/bypass/:userId route:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  // GET /api/admin/alts/delete/:ip - Delete IP-user association
  router.get('/admin/alts/delete/:ip', requireAdmin, async (req, res) => {
    try {
      const ip = req.params.ip;
      
      // Get the user ID associated with this IP
      const userId = await db.get(`ipuser-${ip}`);
      
      if (!userId) {
        return res.status(404).json({ error: 'No user found for this IP' });
      }
  
      // Delete the IP-user association
      await db.delete(`ipuser-${ip}`);
      
      res.json({
        success: true,
        message: `IP association removed for user ${userId}`
      });
    } catch (error) {
      console.error('Error in /admin/alts/delete/:ip route:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
};