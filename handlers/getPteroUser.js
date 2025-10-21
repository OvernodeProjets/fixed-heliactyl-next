const fetch = require("node-fetch");
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const PterodactylApplicationModule = require('../handlers/ApplicationAPI.js');

module.exports = (userid, db) => {
  const AppAPI = new PterodactylApplicationModule(settings.pterodactyl.domain, settings.pterodactyl.key);
  return new Promise(async (resolve, reject) => {
    try {
      const user = await AppAPI.getUserDetails((await db.get("users-" + userid)), ['servers']);
      if (!user) return reject(new Error("User not found!"));

      resolve(user);
    } catch (error) {
      reject(new Error("Error fetching user details: " + error.message));
    }
  });
};
