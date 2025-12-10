const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const { getAppAPI } = require('../handlers/pterodactylSingleton.js');

// todo : cache results to reduce api calls
module.exports = async (userid, db) => {
  const AppAPI = getAppAPI();
  try {
    const pterodactylId = await db.get("users-" + userid);
    if (!pterodactylId) {
      return null;
    }

    const user = await AppAPI.getUserDetails(pterodactylId, ['servers']);
    if (!user) {
      return null;
    }

    return user;
  } catch (error) {
    console.error("Error in getPteroUser:", error);
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
};
