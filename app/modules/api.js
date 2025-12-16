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
  "name": "Heliactyl API 3.0 Beta",
  "target_platform": "latest"
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const adminjs = require("./admin/admin.js");
// todo : logging
const { discordLog } = require("../handlers/log");
const getPteroUser = require('../handlers/getPteroUser.js');

if (settings?.pterodactyl?.domain?.endsWith("/")) {
  settings.pterodactyl.domain = settings.pterodactyl.domain.slice(0, -1);
}

module.exports.load = async function (router, db) {
  const authenticate = async (req, res, next) => {
    const auth = await check(req, res);
    if (!auth) return;
    next();
  };

  /**
   * GET /api
   * Returns the status of the API.
   */
  router.get("/api", authenticate, async (req, res) => {
    discordLog('api access', `API Status check requested`);
    res.send({
      status: true,
      version: settings.version,
      platform_codename: settings.platform_codename,
    });
  });

  /**
   * GET api/v3/userinfo
   * Returns the user information.
   */
  router.get("api/v3/userinfo", authenticate, async (req, res) => {
    const { id } = req.query;

    if (!id) {
      discordLog('api error', `API userinfo request: Missing user ID`);
      return res.send({ status: "missing id" });
    }

    if (!(await db.get("users-" + id))) {
      discordLog('api error', `API userinfo request: Invalid user ID \`${id}\``);
      return res.send({ status: "invalid id" });
    }

    let packagename = await db.get("package-" + id);
    let package =
      settings.api.client.packages.list[
        packagename ? packagename : settings.api.client.packages.default
      ];
    if (!package)
      package = {
        ram: 0,
        disk: 0,
        cpu: 0,
        servers: 0,
      };
    package["name"] = packagename;

    const PterodactylUser = await getPteroUser(id, db);
    if (!PterodactylUser) {
        discordLog('api error', `API userinfo request: Failed to fetch Pterodactyl user data for ID \`${id}\``);
        res.send("An error has occurred while attempting to update your account information and server list.");
        return;
    }

    discordLog('api access', `API userinfo retrieved for user ID \`${id}\``);
    res.send({
      status: "success",
      package: package,
      extra: (await db.get("extra-" + req.query.id))
        ? await db.get("extra-" + req.query.id)
        : {
            ram: 0,
            disk: 0,
            cpu: 0,
            servers: 0,
          },
      userinfo: PterodactylUser,
      coins:
        settings.api.client.coins.enabled == true
          ? (await db.get("coins-" + id))
            ? await db.get("coins-" + id)
            : 0
          : null,
    });
  });

  /**
   * POST api/v3/setcoins
   * Sets the number of coins for a user.
   */
  router.post("api/v3/setcoins", authenticate, async (req, res) => {
    if (typeof req.body !== "object")
      return res.send({ status: "body must be an object" });
    if (Array.isArray(req.body))
      return res.send({ status: "body cannot be an array" });
    let id = req.body.id;
    let coins = req.body.coins;
    if (typeof id !== "string")
      return res.send({ status: "id must be a string" });
    if (!(await db.get("users-" + id))) {
      discordLog('api error', `API setcoins request: Invalid user ID \`${id}\``);
      return res.send({ status: "invalid id" });
    }
    if (typeof coins !== "number")
      return res.send({ status: "coins must be number" });
    if (coins < 0 || coins > 999999999999999)
      return res.send({ status: "too small or big coins" });
    if (coins == 0) {
      await db.delete("coins-" + id);
    } else {
      await db.set("coins-" + id, coins);
    }
    discordLog('api set coins', `User ID: \`${id}\` | Coins set to: \`${coins}\``);
    res.send({ status: "success" });
  });

  router.post("/api/v3/addcoins", authenticate, async (req, res) => {
    if (typeof req.body !== "object")
      return res.send({ status: "body must be an object" });
    if (Array.isArray(req.body))
      return res.send({ status: "body cannot be an array" });
    let id = req.body.id;
    let coins = req.body.coins;
    if (typeof id !== "string")
      return res.send({ status: "id must be a string" });
    if (!(await db.get("users-" + id))) {
      discordLog('api error', `API addcoins request: Invalid user ID \`${id}\``);
      return res.send({ status: "invalid id" });
    }
    if (typeof coins !== "number")
      return res.send({ status: "coins must be number" });
    if (coins < 1 || coins > 999999999999999)
      return res.send({ status: "too small or big coins" });
    if (coins == 0) {
      return res.send({ status: "cant do that mate" });
    } else {
      let current = await db.get("coins-" + id);
      await db.set("coins-" + id, current + coins);
    }
    discordLog('api add coins', `User ID: \`${id}\` | Coins added: \`${coins}\``);
    res.send({ status: "success" });
  });

  /**
   * POST api/v3/setplan
   * Sets the plan for a user.
   */
  router.post("api/v3/setplan", authenticate, async (req, res) => {
    if (!req.body) return res.send({ status: "missing body" });

    if (typeof req.body.id !== "string")
      return res.send({ status: "missing id" });

    if (!(await db.get("users-" + req.body.id))) {
      discordLog('api error', `API setplan request: Invalid user ID \`${req.body.id}\``);
      return res.send({ status: "invalid id" });
    }

    if (typeof req.body.package !== "string") {
      await db.delete("package-" + req.body.id);
      adminjs.suspend(req.body.id);
      discordLog('api set plan', `User ID: \`${req.body.id}\` | Package deleted`);
      return res.send({ status: "success" });
    } else {
      if (!settings.api.client.packages.list[req.body.package]) {
        discordLog('api error', `API setplan request: Invalid package \`${req.body.package}\` for user ID \`${req.body.id}\``);
        return res.send({ status: "invalid package" });
      }
      await db.set("package-" + req.body.id, req.body.package);
      adminjs.suspend(req.body.id);
      discordLog('api set plan', `User ID: \`${req.body.id}\` | Package set to: \`${req.body.package}\``);
      return res.send({ status: "success" });
    }
  });

  /**
   * POST api/v3/setresources
   * Sets the resources for a user.
   */
  router.post("api/v3/setresources", authenticate, async (req, res) => {
    if (!req.body) return res.send({ status: "missing body" });

    if (typeof req.body.id !== "string")
      return res.send({ status: "missing id" });

    if (!(await db.get("users-" + req.body.id))) {
      discordLog('api error', `API setresources request: Invalid user ID \`${req.body.id}\``);
      return res.send({ status: "invalid id" });
    }

    if (
      typeof req.body.ram == "number" ||
      typeof req.body.disk == "number" ||
      typeof req.body.cpu == "number" ||
      typeof req.body.servers == "number"
    ) {
      let ram = req.body.ram;
      let disk = req.body.disk;
      let cpu = req.body.cpu;
      let servers = req.body.servers;

      let currentextra = await db.get("extra-" + req.body.id);
      let extra;

      if (typeof currentextra == "object") {
        extra = currentextra;
      } else {
        extra = {
          ram: 0,
          disk: 0,
          cpu: 0,
          servers: 0,
        };
      }

      if (typeof ram == "number") {
        if (ram < 0 || ram > 999999999999999) {
          return res.send({ status: "ram size" });
        }
        extra.ram = ram;
      }

      if (typeof disk == "number") {
        if (disk < 0 || disk > 999999999999999) {
          return res.send({ status: "disk size" });
        }
        extra.disk = disk;
      }

      if (typeof cpu == "number") {
        if (cpu < 0 || cpu > 999999999999999) {
          return res.send({ status: "cpu size" });
        }
        extra.cpu = cpu;
      }

      if (typeof servers == "number") {
        if (servers < 0 || servers > 999999999999999) {
          return res.send({ status: "server size" });
        }
        extra.servers = servers;
      }

      if (
        extra.ram == 0 &&
        extra.disk == 0 &&
        extra.cpu == 0 &&
        extra.servers == 0
      ) {
        await db.delete("extra-" + req.body.id);
      } else {
        await db.set("extra-" + req.body.id, extra);
      }

      discordLog('api set resources', `User ID: \`${req.body.id}\` | RAM: \`${extra.ram}\` | Disk: \`${extra.disk}\` | CPU: \`${extra.cpu}\` | Servers: \`${extra.servers}\``);
      adminjs.suspend(req.body.id);
      return res.send({ status: "success" });
    } else {
      discordLog('api error', `API setresources request: Missing variables for user ID \`${req.body.id}\``);
      res.send({ status: "missing variables" });
    }
  });

  /**
   * POST api/v3/ban
   * Bans a user.
   */
  router.post("api/v3/ban", authenticate, async (req, res) => {
    if (typeof req.body !== "object")
      return res.send({ status: "body must be an object" });
    if (Array.isArray(req.body))
      return res.send({ status: "body cannot be an array" });
    
    let id = req.body.id;
    let reason = req.body.reason || "No reason provided";
    let expiration = req.body.expiration || null;
    
    if (typeof id !== "string")
      return res.send({ status: "id must be a string" });
    
    if (!(await db.get("users-" + id)))
      return res.send({ status: "invalid id" });
    
    const banData = {
      reason: reason,
      expiration: expiration,
    };
    
    await db.set(`ban-${id}`, banData);
    adminjs.suspend(id);
    discordLog('api ban user', `User ID: \`${id}\` | Reason: \`${reason}\` | Expiration: \`${expiration || 'Never'}\``);
    
    res.send({ status: "success", message: "User banned successfully" });
  });

  /**
   * POST api/v3/unban
   * Unbans a user.
   */
  router.post("api/v3/unban", authenticate, async (req, res) => {
    if (typeof req.body !== "object")
      return res.send({ status: "body must be an object" });
    if (Array.isArray(req.body))
      return res.send({ status: "body cannot be an array" });
    
    let id = req.body.id;
    
    if (typeof id !== "string")
      return res.send({ status: "id must be a string" });
    
    if (!(await db.get("users-" + id)))
      return res.send({ status: "invalid id" });
    
    await db.delete(`ban-${id}`);
    adminjs.suspend(id);
    discordLog('api unban user', `User ID: \`${id}\` has been unbanned`);
    
    res.send({ status: "success", message: "User unbanned successfully" });
  });

  /**
   * Checks the authorization and returns the settings if authorized.
   * Renders the file based on the theme and sends the response.
   * @param {Object} req - The request object.
   * @param {Object} res - The response object.
   * @returns {Object|null} - The settings object if authorized, otherwise null.
   */
  async function check(req, res) {
    if (!settings.api.client.api.enabled) {
      res.status(403).json({ 
        status: "error", 
        message: "API is disabled" 
      });
      return null;
    }

    const auth = req.headers["authorization"];
    
    if (!auth) {
      res.status(401).json({ 
        status: "error", 
        message: "Missing authorization header" 
      });
      return null;
    }

    if (auth !== "Bearer " + settings.api.client.api.code) {
      res.status(403).json({ 
        status: "error", 
        message: "Invalid API key" 
      });
      return null;
    }

    return true;
  }
};
