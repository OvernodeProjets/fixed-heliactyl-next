const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const { getAppAPI } = require('../handlers/pterodactylSingleton.js');
const NodeCache = require('node-cache');

const userCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

/**
 * Fetch Pterodactyl user details with caching
 * @param {string} userid - Local user ID
 * @param {Object} db - Database instance
 * @returns {Promise<Object|null>} Pterodactyl user object or null
 */
module.exports = async (userid, db) => {
  const cacheKey = `ptero-user-${userid}`;
  const cachedUser = userCache.get(cacheKey);
  
  if (cachedUser !== undefined) {
    return cachedUser;
  }

  const AppAPI = getAppAPI();
  try {
    const pterodactylId = await db.get("users-" + userid);
    if (!pterodactylId) {
      userCache.set(cacheKey, null, 300);
      return null;
    }

    const user = await AppAPI.getUserDetails(pterodactylId, ['servers']);
    if (!user) {
      userCache.set(cacheKey, null, 60);
      return null;
    }

    userCache.set(cacheKey, user);
    return user;
  } catch (error) {
    console.error("Error in getPteroUser:", error);
    if (error.response?.status === 404) {
      userCache.set(cacheKey, null, 60);
      return null;
    }
    throw error;
  }
};
