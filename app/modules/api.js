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
  "name": "Heliactyl API 3.0 Beta",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const adminjs = require("./admin.js");
const fs = require("fs");
const ejs = require("ejs");
const fetch = require("node-fetch");
const NodeCache = require("node-cache");
const Queue = require("../handlers/Queue.js");
const { discordLog } = require("../handlers/log");
const getPteroUser = require('../handlers/getPteroUser.js');
const { requireAuth } = require("../handlers/checkMiddleware.js");

const myCache = new NodeCache({ deleteOnExpire: true, stdTTL: 59 });

module.exports.load = async function (app, db) {
// Simple cache implementation
const cache = {
    data: {},
    timeout: {},
};

const getCacheItem = (key) => {
    return cache.data[key];
};

const setCacheItem = (key, value) => {
    cache.data[key] = value;
    
    // Clear any existing timeout for this key
    if (cache.timeout[key]) {
        clearTimeout(cache.timeout[key]);
    }
    
    // Set new timeout to clear the cache after 1 minute
    cache.timeout[key] = setTimeout(() => {
        delete cache.data[key];
        delete cache.timeout[key];
    }, 60 * 1000); // 1 minute
};

app.get("/stats", async (req, res) => {
    try {
        const fetchStats = async (endpoint) => {
            // Check cache first
            const cacheKey = `stats_${endpoint}`;
            const cachedValue = getCacheItem(cacheKey);
            if (cachedValue !== undefined) {
                return cachedValue;
            }

            const response = await fetch(`${settings.pterodactyl.domain}/api/application/${endpoint}?per_page=100000`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${settings.pterodactyl.key}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const total = data.meta.pagination.total;

            // Store in cache
            setCacheItem(cacheKey, total);
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

  app.get('/api/dailystatus', requireAuth, async (req, res) => {
    if (!settings.api.client.coins.daily.enabled) {
      return res.json({ text: 'DISABLED' });
    }
  
    const per = settings.api.client.coins.daily.per;
    const lastClaimTimestamp = await db.get("dailycoins-" + req.session.userinfo.id);
    const lastClaim = lastClaimTimestamp ? new Date(lastClaimTimestamp) : null;

    function getPeriodStart(date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      switch (per) {
        case "week":
          const day = d.getDay();
          const diff = d.getDate() - day + (day === 0 ? -6 : 1);
          d.setDate(diff);
          break;
        case "month":
          d.setDate(1);
          break;
      }
      return d;
    }
  
    const today = getPeriodStart(new Date());
    const lastPeriod = lastClaim ? getPeriodStart(lastClaim) : null;
  
    if (lastPeriod && lastPeriod.getTime() === today.getTime()) {
      return res.json({ text: '0' }); // Already claimed
    } else {
      return res.json({ text: '1' }); // Can claim
    }
  });
  
  
  app.get('/daily-coins', requireAuth, async (req, res) => {
    if (!settings.api.client.coins.daily.enabled) {
      return res.redirect('../dashboard?err=DISABLED');
    }
  
    const per = settings.api.client.coins.daily.per;
    const lastClaimTimestamp = await db.get("dailycoins-" + req.session.userinfo.id);
    const lastClaim = lastClaimTimestamp ? new Date(lastClaimTimestamp) : null;
  
    function getPeriodStart(date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      switch (per) {
        case "week":
          const day = d.getDay();
          const diff = d.getDate() - day + (day === 0 ? -6 : 1);
          d.setDate(diff);
          break;
        case "month":
          d.setDate(1);
          break;
      }
      return d;
    }
  
    const today = getPeriodStart(new Date());
    const lastPeriod = lastClaim ? getPeriodStart(lastClaim) : null;
  
    if (lastPeriod && lastPeriod.getTime() === today.getTime()) {
      return res.redirect('../dashboard?err=CLAIMED');
    }
  
    const coins = (await db.get("coins-" + req.session.userinfo.id)) || 0;
    await db.set("coins-" + req.session.userinfo.id, coins + settings.api.client.coins.daily.amount);
  
    discordLog('daily coins', `${req.session.userinfo.username} has claimed their daily reward of ${settings.api.client.coins.daily.amount} ${settings.website.currency}.`);
  
    await db.set("dailycoins-" + req.session.userinfo.id, today.getTime());
    return res.redirect('../dashboard?err=none');
  });
  
/**
 * GET /giftcoins
 * Gifts coins to another user.
 */
app.get("/giftcoins", async (req, res) => {
  const { coins: coinsStr, id: recipientId } = req.query;
  const coins = parseInt(coinsStr);
  const senderId = req.session.userinfo.id;

  // Validate input
  if (!coins || !recipientId) {
    return res.redirect(`/transfer?err=MISSINGFIELDS`);
  }
  if (recipientId === senderId) {
    return res.redirect(`/transfer?err=CANNOTGIFTYOURSELF`);
  }
  if (coins < 1) {
    return res.redirect(`/transfer?err=TOOLOWCOINS`);
  }

  try {
    // Fetch user balances
    const [senderCoins, recipientCoins] = await Promise.all([
      db.get(`coins-${senderId}`),
      db.get(`coins-${recipientId}`)
    ]);

    // Validate balances
    if (recipientCoins === null) {
      return res.redirect(`/transfer?err=USERDOESNTEXIST`);
    }
    if (senderCoins < coins) {
      return res.redirect(`/transfer?err=CANTAFFORD`);
    }

    // Perform the transfer
    await Promise.all([
      db.set(`coins-${recipientId}`, recipientCoins + coins),
      db.set(`coins-${senderId}`, senderCoins - coins)
    ]);

    // Log the transaction
    discordLog('gifted coins', `${req.session.userinfo.username} sent ${coins} coins to the user with the ID \`${recipientId}\`.`);

    return res.redirect(`/transfer?err=none`);
  } catch (error) {
    console.error('Error during coin transfer:', error);
    return res.redirect(`/transfer?err=INTERNALERROR`);
  }
});
  /**
   * GET /api
   * Returns the status of the API.
   */
  app.get("/api", async (req, res) => {
    /* Check that the API key is valid */
    let authentication = await check(req, res);
    if (!authentication ) return;
    res.send({
      status: true,
    });
  });

  /**
   * GET api/v3/userinfo
   * Returns the user information.
   */
  app.get("api/v3/userinfo", async (req, res) => {
    /* Check that the API key is valid */
    let authentication = await check(req, res);
    if (!authentication) return;
    const { id } = req.query;

    if (!id) return res.send({ status: "missing id" });

    if (!(await db.get("users-" + id)))
      return res.send({ status: "invalid id" });

    if (settings.api.client.oauth2.link.slice(-1) == "/")
      settings.api.client.oauth2.link =
        settings.api.client.oauth2.link.slice(0, -1);

    if (settings.api.client.oauth2.callbackpath.slice(0, 1) !== "/")
      settings.api.client.oauth2.callbackpath =
        "/" + settings.api.client.oauth2.callbackpath;

    if (settings.pterodactyl.domain.slice(-1) == "/")
      settings.pterodactyl.domain = settings.pterodactyl.domain.slice(
        0,
        -1
      );

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
        res.send("An error has occurred while attempting to update your account information and server list.");
        return;
    }

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
  app.post("api/v3/setcoins", async (req, res) => {
    /* Check that the API key is valid */
    let authentication = await check(req, res);
    if (!authentication ) return;

    if (typeof req.body !== "object")
      return res.send({ status: "body must be an object" });
    if (Array.isArray(req.body))
      return res.send({ status: "body cannot be an array" });
    let id = req.body.id;
    let coins = req.body.coins;
    if (typeof id !== "string")
      return res.send({ status: "id must be a string" });
    if (!(await db.get("users-" + id)))
      return res.send({ status: "invalid id" });
    if (typeof coins !== "number")
      return res.send({ status: "coins must be number" });
    if (coins < 0 || coins > 999999999999999)
      return res.send({ status: "too small or big coins" });
    if (coins == 0) {
      await db.delete("coins-" + id);
    } else {
      await db.set("coins-" + id, coins);
    }
    res.send({ status: "success" });
  });

  app.post("/api/v3/addcoins", async (req, res) => {
    /* Check that the API key is valid */
    let authentication = await check(req, res);
    if (!authentication ) return;

    if (typeof req.body !== "object")
      return res.send({ status: "body must be an object" });
    if (Array.isArray(req.body))
      return res.send({ status: "body cannot be an array" });
    let id = req.body.id;
    let coins = req.body.coins;
    if (typeof id !== "string")
      return res.send({ status: "id must be a string" });
    if (!(await db.get("users-" + id)))
      return res.send({ status: "invalid id" });
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
    res.send({ status: "success" });
  });

  /**
   * POST api/v3/setplan
   * Sets the plan for a user.
   */
  app.post("api/v3/setplan", async (req, res) => {
    /* Check that the API key is valid */
    let authentication = await check(req, res);
    if (!authentication ) return;

    if (!req.body) return res.send({ status: "missing body" });

    if (typeof req.body.id !== "string")
      return res.send({ status: "missing id" });

    if (!(await db.get("users-" + req.body.id)))
      return res.send({ status: "invalid id" });

    if (typeof req.body.package !== "string") {
      await db.delete("package-" + req.body.id);
      adminjs.suspend(req.body.id);
      return res.send({ status: "success" });
    } else {
      if (!settings.api.client.packages.list[req.body.package])
        return res.send({ status: "invalid package" });
      await db.set("package-" + req.body.id, req.body.package);
      adminjs.suspend(req.body.id);
      return res.send({ status: "success" });
    }
  });

  /**
   * POST api/v3/setresources
   * Sets the resources for a user.
   */
  app.post("api/v3/setresources", async (req, res) => {
    /* Check that the API key is valid */
    let authentication = await check(req, res);
    if (!authentication ) return;

    if (!req.body) return res.send({ status: "missing body" });

    if (typeof req.body.id !== "string")
      return res.send({ status: "missing id" });

    if (!(await db.get("users-" + req.body.id)))
      res.send({ status: "invalid id" });

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

      adminjs.suspend(req.body.id);
      return res.send({ status: "success" });
    } else {
      res.send({ status: "missing variables" });
    }
  });

  /**
   * Checks the authorization and returns the settings if authorized.
   * Renders the file based on the theme and sends the response.
   * @param {Object} req - The request object.
   * @param {Object} res - The response object.
   * @returns {Object|null} - The settings object if authorized, otherwise null.
   */
  async function check(req, res) {
    let settings = loadConfig("./config.toml");
    if (settings.api.client.api.enabled == true) {
      let auth = req.headers["authorization"];
      if (auth) {
        if (auth == "Bearer " + settings.api.client.api.code) {
          return settings;
        }
      } else {
        res.status(403).send({ status: "forbidden" });
        return null;
      }
    } else {
      res.status(403).send({ status: "forbidden" });
      return null;
    }
  }
};
