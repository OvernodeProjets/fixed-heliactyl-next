const fetch = require("node-fetch");
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const PterodactylApplicationModule = require('../handlers/ApplicationAPI.js');

module.exports = async (userid, db) => {
  const AppAPI = new PterodactylApplicationModule(settings.pterodactyl.domain, settings.pterodactyl.key);
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
