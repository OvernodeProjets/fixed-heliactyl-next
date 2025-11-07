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
  "name": "Admin Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../handlers/config");
const updateManager = require("../handlers/updateManager");
const settings = loadConfig("./config.toml");

if (settings?.pterodactyl?.domain?.endsWith("/")) {
  settings.pterodactyl.domain = settings.pterodactyl.domain.slice(0, -1);
}

const adminjs = require("./admin.js");
const { discordLog } = require("../handlers/log.js");
const getPteroUser = require("../handlers/getPteroUser");
const PterodactylApplicationModule = require('../handlers/ApplicationAPI.js');
const { requireAuth } = require("../handlers/checkMiddleware.js");

module.exports.load = async function (app, db) {
  const AppAPI = new PterodactylApplicationModule(settings.pterodactyl.domain, settings.pterodactyl.key);
  const requireAdmin = (req, res, next) => requireAuth(req, res, next, true);

  app.get("/admin/setcoins", requireAdmin, async (req, res) => { 
    let failredirect = "/admin/coins?err=FAILEDSETCOINS";

    let { id, coins } = req.query;

    if (!id) return res.redirect(failredirect + "?err=MISSINGID");
    if (!(await db.get("users-" + id)))
      return res.redirect(`${failredirect}?err=INVALIDID`);

    if (!coins) return res.redirect(failredirect + "?err=MISSINGCOINS");

    coins = parseFloat(coins);

    if (isNaN(coins))
      return res.redirect(failredirect + "?err=INVALIDCOINNUMBER");

    if (coins < 0 || coins > 999999999999999)
      return res.redirect(`${failredirect}?err=COINSIZE`);

    if (coins == 0) {
      await db.delete("coins-" + id);
    } else {
      await db.set("coins-" + id, coins);
    }

    discordLog(
      `set coins`,
      `${req.session.userinfo.username} set the coins of the user with the ID \`${id}\` to \`${coins}\`.`
    );
    res.status(200).json({ message: "Coins set successfully." });
  });

  app.get("/admin/addcoins", requireAdmin, async (req, res) => {
    let failredirect = "/admin?err=FAILEDADDCOINS";

    let { id, coins } = req.query;

    if (!id) return res.redirect(failredirect + "?err=MISSINGID");
    if (!(await db.get("users-" + id)))
      return res.redirect(`${failredirect}?err=INVALIDID`);

    if (!coins) return res.redirect(failredirect + "?err=MISSINGCOINS");

    let currentcoins = (await db.get("coins-" + id)) || 0;

    coins = currentcoins + parseFloat(coins);

    if (isNaN(coins))
      return res.redirect(failredirect + "?err=INVALIDCOINNUMBER");

    if (coins < 0 || coins > 999999999999999)
      return res.redirect(`${failredirect}?err=COINSIZE`);

    if (coins == 0) {
      await db.delete("coins-" + id);
    } else {
      await db.set("coins-" + id, coins);
    }

    discordLog(
      `add coins`,
      `${req.session.userinfo.username} added \`${req.query.coins}\` coins to the user with the ID \`${id}\`'s account.`
    );
    res.status(200).json({ message: "Coins added successfully." });
  });

  app.get("/admin/setresources", requireAdmin, async (req, res) => {
    let { id, ram, disk, cpu, servers } = req.query;

    let failredirect = "/admin/resources?err=FAILEDSETRESOURCES";

    if (!id) return res.redirect(`${failredirect}?err=MISSINGID`);

    if (!(await db.get("users-" + id))) {
      return res.redirect(`${failredirect}?err=INVALIDID`);
    }

    if (!ram || !disk || !cpu || !servers) {
      res.redirect(`${failredirect}?err=MISSINGVARIABLES`);
      return;
    }

      let currentextra = await db.get("extra-" + id);
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

      if (ram) {
        const parsedRam = parseFloat(ram);
        if (parsedRam < 0 || parsedRam > 999999999999999) {
          return res.redirect(`${failredirect}?err=RAMSIZE`);
        }
        extra.ram = parsedRam;
      }

      if (disk) {
        let parsedDisk = parseFloat(disk);
        if (parsedDisk < 0 || parsedDisk > 999999999999999) {
          return res.redirect(`${failredirect}?err=DISKSIZE`);
        }
        extra.disk = parsedDisk;
      }

      if (cpu) {
        let parsedCpu = parseFloat(cpu);
        if (parsedCpu < 0 || parsedCpu > 999999999999999) {
          return res.redirect(`${failredirect}?err=CPUSIZE`);
        }
        extra.cpu = parsedCpu;
      }

      if (servers) {
        let parsedServers = parseFloat(servers);
        if (parsedServers < 0 || parsedServers > 999999999999999) {
          return res.redirect(`${failredirect}?err=SERVERSIZE`);
        }
        extra.servers = parsedServers;
      }

      if (
        extra.ram == 0 &&
        extra.disk == 0 &&
        extra.cpu == 0 &&
        extra.servers == 0
      ) {
        await db.delete("extra-" + id);
      } else {
        await db.set("extra-" + id, extra);
      }

      adminjs.suspend(id);

      discordLog(
        `set resources`,
        `${req.session.userinfo.username} set the resources of the user with the ID \`${id}\` to:\`\`\`servers: ${servers}\nCPU: ${cpu}%\nMemory: ${ram} MB\nDisk: ${disk} MB\`\`\``
      );
      res.status(200).json({ message: "Resources set successfully." });
  });

  app.get("/admin/addresources", requireAdmin, async (req, res) => {

    let { ram, disk, cpu, servers, id } = req.query;

    let failredirect = "/admin/resources?err=FAILEDSETRESOURCES";
    let successredirect = "/admin/resources?success=ADDRESOURCES";

    if (!id) return res.redirect(`${failredirect}?err=MISSINGID`);

    if (!(await db.get("users-" + id)))
      return res.redirect(`${failredirect}?err=INVALIDID`);

    if (!ram || !disk || !cpu || !servers) {
      res.redirect(`${failredirect}?err=MISSINGVARIABLES`);
      return;
    }

      let currentextra = await db.get("extra-" + id);
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

      if (ram) {
        let parsedRam = parseFloat(ram);
        if (parsedRam < 0 || parsedRam > 999999999999999) {
          return res.redirect(`${failredirect}?err=RAMSIZE`);
        }
        extra.ram = extra.ram + parsedRam;
      }

      if (disk) {
        let parsedDisk = parseFloat(disk);
        if (parsedDisk < 0 || parsedDisk > 999999999999999) {
          return res.redirect(`${failredirect}?err=DISKSIZE`);
        }
        extra.disk = extra.disk + parsedDisk;
      }

      if (cpu) {
        let parsedCpu = parseFloat(cpu);
        if (parsedCpu < 0 || parsedCpu > 999999999999999) {
          return res.redirect(`${failredirect}?err=CPUSIZE`);
        }
        extra.cpu = extra.cpu + parsedCpu;
      }

      if (servers) {
        let parsedServers = parseFloat(servers);
        if (parsedServers < 0 || parsedServers > 999999999999999) {
          return res.redirect(`${failredirect}?err=SERVERSIZE`);
        }
        extra.servers = extra.servers + parsedServers;
      }

      if (
        extra.ram == 0 &&
        extra.disk == 0 &&
        extra.cpu == 0 &&
        extra.servers == 0
      ) {
        await db.delete("extra-" + id);
      } else {
        await db.set("extra-" + id, extra);
      }

      adminjs.suspend(id);
      discordLog(
        `add resources`,
        `${req.session.userinfo.username} added resources to the user with the ID \`${id}\`:\`\`\`servers: ${servers}\nCPU: ${cpu}%\nMemory: ${ram} MB\nDisk: ${disk} MB\`\`\``
      );
      return res.status(200).json({ message: "Resources added successfully." });
  });

  app.get("/admin/setplan", requireAdmin, async (req, res) => {
    let { id, package } = req.query;

    let failredirect = "/admin?err=FAILEDSETPLAN";
    let successredirect = "/admin?success=SETPLAN";

    if (!id) return res.redirect(`${failredirect}?err=MISSINGID`);

    if (!(await db.get("users-" + id)))
      return res.redirect(`${failredirect}?err=INVALIDID`);

    if (!package) {
      await db.delete("package-" + id);
      adminjs.suspend(id);

      discordLog(
        `set plan`,
        `${req.session.userinfo.username} removed the plan of the user with the ID \`${id}\`.`
      );
      return res.redirect(successredirect + "?err=none");
    } 

    if (!settings.api.client.packages.list[package]) {
      return res.redirect(`${failredirect}?err=INVALIDPACKAGE`);
    }
    await db.set("package-" + id, package);
    adminjs.suspend(id);

    discordLog(
      `set plan`,
      `${req.session.userinfo.username} set the plan of the user with the ID \`${id}\` to \`${package}\`.`
    );
    return res.status(200).json({ message: "Plan set successfully." });
  });

  app.get("/admin/remove_account", requireAdmin, async (req, res) => {
    let { id } = req.query;

    // This doesn't delete the account and doesn't touch the renewal system.

    if (!id)
      return res.redirect(
          "/admin?err=REMOVEACCOUNTMISSINGID"
      );

    let pterodactylID = await db.get("users-" + id);

    // Remove user.

    let userids = (await db.get("users")) || [];
    userids = userids.filter((user) => user !== pterodactylID);

    if (userids.length == 0) {
      await db.delete("users");
    } else {
      await db.set("users", userids);
    }

    await db.delete("users-" + id);

    // Remove coins/resources.

    await db.delete("coins-" + id);
    await db.delete("extra-" + id);
    await db.delete("package-" + id);

    discordLog(
      `remove account`,
      `${req.session.userinfo.username} removed the account with the ID \`${id}\`.`
    );
    res.status(200).json({ message: "Account removed successfully." });
  });

  app.get("/admin/userinfo", requireAdmin, async (req, res) => {
    try {
      const { id, email } = req.query;

      if (!id && !email) {
        return res.status(400).json({ error: "Missing user ID or email" });
      }
      let userId;
      if (email) {
        let userByEmail = await db.get("user-" + email);

        if (!userByEmail) {
          const allUserKeys = await db.list("user-*");
          for (const key of allUserKeys) {
            const userEmail = key.substring("user-".length);
            if (userEmail.toLowerCase().includes(email.toLowerCase())) {
              userByEmail = await db.get(key);
              if (userByEmail) break;
            }
          }
        }
        
        if (!userByEmail) {
          return res.status(404).json({ error: "User not found in database" });
        }
        userId = userByEmail.id;
      } else {
        const pterodactylId = await db.get("users-" + id);
        if (!pterodactylId) {
          return res.status(404).json({ error: "User not found in database" });
        }
        userId = id;
      }

      let packagename = await db.get("package-" + userId);
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

      const PterodactylUserReq = await getPteroUser(userId, db);
      if (!PterodactylUserReq) {
        return res.status(404).json({ error: "User not found in Pterodactyl" });
      }

      res.status(200).json({
        id: userId,
        package: package,
        extra: (await db.get("extra-" + userId)) || {
          ram: 0,
          disk: 0,
          cpu: 0,
          servers: 0,
        },
        userinfo: PterodactylUserReq,
        coins: settings.api.client.coins.enabled
          ? (await db.get("coins-" + userId)) ?? 0
          : null
      });
    } catch (error) {
      console.error("Error in /admin/userinfo:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/admin/ban", requireAdmin, async (req, res) => {
      const { id, reason, expiration } = req.query;
      if (!id) return res.status(400).json({ error: "Missing user ID" });

      const dbUser = await db.get("users-" + id);
      if (!dbUser) {
          return res.status(404).json({ error: "User not found in database" });
      }

      const banData = {
          reason: reason || "No reason provided",
          expiration: expiration || null,
      };

      await db.set(`ban-${id}`, banData);

      discordLog(
          `ban user`,
          `${req.session.userinfo.username} banned the user with the ID \`${id}\` for reason: \`${banData.reason}\`, expiration: \`${banData.expiration || 'Permanent'}\`.`
      );
      res.status(200).json({ message: "User banned successfully." });
  });

  app.get("/admin/unban", requireAdmin, async (req, res) => {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "Missing user ID" });
      const dbUser = await db.get("users-" + id);
      if (!dbUser) {
          return res.status(404).json({ error: "User not found in database" });
      }
      await db.delete(`ban-${id}`);
      discordLog(
          `unban user`,
          `${req.session.userinfo.username} unbanned the user with the ID \`${id}\`.`
      );
      res.status(200).json({ message: "User unbanned successfully." });
  });

  app.get("/admin/updates/check", requireAdmin, async (req, res) => {
    try {
      const updates = await updateManager.checkForUpdates();
      res.json(updates);
    } catch (error) {
      console.error("Error checking for updates:", error);
      res.status(500).json({ error: "Failed to check for updates" });
    }
  });

  app.post("/admin/updates/install", requireAdmin, async (req, res) => {
    try {
      const { version } = req.body;
      const updates = await updateManager.checkForUpdates();
      const updateToInstall = updates.find(u => u.version === version);
      
      if (!updateToInstall) {
        return res.status(404).json({ error: "Update not found" });
      }

      const result = await updateManager.installUpdate(updateToInstall);
      res.json(result);
    } catch (error) {
      console.error("Error installing update:", error);
      res.status(500).json({ error: "Failed to install update" });
    }
  });

  module.exports.suspend = async function (discordid) {
    if (!settings.api.client.allow.over_resources_suspend) return;
    
    const PterodactylUser = await getPteroUser(discordid, db);
    if (!PterodactylUser) {
        res.send("An error has occurred while attempting to update your account information and server list.");
        return;
    }

    const packagename = await db.get("package-" + discordid);
    const package =
      settings.api.client.packages.list[
        packagename || settings.api.client.packages.default
      ];

    const extra = (await db.get("extra-" + discordid)) || {
      ram: 0,
      disk: 0,
      cpu: 0,
      servers: 0,
    };

    const plan = {
      ram: package.ram + extra.ram,
      disk: package.disk + extra.disk,
      cpu: package.cpu + extra.cpu,
      servers: package.servers + extra.servers,
    };

    let current = {
      ram: 0,
      disk: 0,
      cpu: 0,
      servers: PterodactylUser.attributes.relationships.servers.data.length,
    };
    for (
      let i = 0, len = PterodactylUser.attributes.relationships.servers.data.length;
      i < len;
      i++
    ) {
      current.ram =
        current.ram +
        PterodactylUser.attributes.relationships.servers.data[i].attributes.limits.memory;
      current.disk =
        current.disk +
        PterodactylUser.attributes.relationships.servers.data[i].attributes.limits.disk;
      current.cpu =
        current.cpu +
        PterodactylUser.attributes.relationships.servers.data[i].attributes.limits.cpu;
    }

    if (
      current.ram > plan.ram ||
      current.disk > plan.disk ||
      current.cpu > plan.cpu ||
      current.servers > plan.servers
    ) {
      for (
        let i = 0, len = PterodactylUser.attributes.relationships.servers.data.length;
        i < len;
        i++
      ) {
        const suspendID = PterodactylUser.attributes.relationships.servers.data[i].attributes.id;
        await AppAPI.suspendServer(suspendID);
        // To avoid rate limits on large suspensions
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } else {
      for (
        let i = 0, len = PterodactylUser.attributes.relationships.servers.data.length;
        i < len;
        i++
      ) {
        const suspendID = PterodactylUser.attributes.relationships.servers.data[i].attributes.id;
        await AppAPI.unsuspendServer(suspendID);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  };
};