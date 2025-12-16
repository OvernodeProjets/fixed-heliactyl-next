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
  "name": "Extras Module",
  "target_platform": "latest"
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const { requireAuth } = require("../handlers/checkMiddleware.js");
const { getAppAPI } = require('../handlers/pterodactylSingleton.js');
const NodeCache = require("node-cache");

module.exports.load = async function(router, db) {
  const AppAPI = getAppAPI();
  const myCache = new NodeCache({ stdTTL: 60, checkperiod: 10 });
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);

  router.get("/stats", async (req, res) => {
    try {
      const fetchStats = async (endpoint) => {
        // Check cache first
        const cacheKey = `stats_${endpoint}`;

        const cachedValue = myCache.get(cacheKey);
        if (cachedValue !== undefined) {
          return cachedValue;
        }

        let data;
        switch(endpoint) {
          case 'users':
            data = await AppAPI.listUsers({ perPage: 100000 });
            break;
          case 'servers':
            data = await AppAPI.listServers(1, 100000);
            break;
          case 'nodes':
            data = await AppAPI.listNodes(1, 100000);
            break;
          case 'locations':
            data = await AppAPI.listLocations(1, 100000);
            break;
          default:
            throw new Error(`Unknown endpoint: ${endpoint}`);
        }

        const total = data.meta.pagination.total;

        // Store in cache
        myCache.set(cacheKey, total);

        return total;
      };

        // Fetch all stats in parallel
      const [users, servers, nodes, locations] = await Promise.all([
        fetchStats('users'),
        fetchStats('servers'),
        fetchStats('nodes'),
        fetchStats('locations')
      ]);

      res.json({ users, servers, nodes, locations });
    } catch (error) {
      console.error('Error fetching stats:', error);
      res.status(500).json({ error: 'An error occurred while fetching stats' });
    }
  });

  router.get("/panel", async (req, res) => {
    res.redirect(settings.pterodactyl.domain);
  });

  // todo : implement notifications system
  router.get("/notifications", authMiddleware, async (req, res) => {
    let notifications = await db.get('notifications-' + req.session.userinfo.id) || [];

    res.json(notifications)
  });

  router.get("/password/generate", authMiddleware, async (req, res) => {
    if (!settings.api.client.allow.change_password) return res.status(403).json({ error: "Password changes are not allowed" });

    const newPassword = settings.api.client.passwordgenerator.signup
      ? makeid(settings.api.client.passwordgenerator["length"])
      : makeid(16);
    req.session.password = newPassword;

    try {
      await updatePassword(req.session.pterodactyl, newPassword, settings, db);
      res.redirect("/account");
    } catch (error) {
      console.error("Password update error:", error);
      res.status(500).json({ error: "Failed to update password" });
    }
  });

  // New endpoint for custom password changes
  router.post("/password/change", authMiddleware, async (req, res) => {
    if (!settings.api.client.allow.change_password) return res.status(403).json({ error: "Password changes are not allowed" });

    const { password, confirmPassword } = req.body;

    // Validate password
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: "Invalid password provided" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    // Password requirements
    const minLength = 8;
    const hasNumber = /\d/.test(password);
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (password.length < minLength) {
      return res.status(400).json({ error: `Password must be at least ${minLength} characters long` });
    }

    if (!(hasNumber && hasUpperCase && hasLowerCase)) {
      return res.status(400).json({ 
        error: "Password must contain at least one number, one uppercase letter, and one lowercase letter" 
      });
    }

    try {
      await updatePassword(req.session.pterodactyl, password, settings, db);
      res.json({ success: true, message: "Password updated successfully" });
    } catch (error) {
      console.error("Password update error:", error);
      res.status(500).json({ error: "Failed to update password" });
    }
  });

// Helper function to update password
async function updatePassword(userInfo, newPassword, settings, db) {
  await AppAPI.updateUser(userInfo.id, {
    username: userInfo.username,
    email: userInfo.email,
    first_name: userInfo.first_name,
    last_name: userInfo.last_name,
    password: newPassword
  });

  await db.set(`password-${userInfo.id}`, newPassword);
}
};

function makeid(length) {
  let result = '';
  let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
     result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}