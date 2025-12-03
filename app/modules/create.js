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
  "name": "Pterodactyl Module",
  "target_platform": "3.2.1-beta.1"
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const adminjs = require("./admin/admin.js");
const fs = require("fs");
const getPteroUser = require("../handlers/getPteroUser.js");
const Queue = require("../handlers/Queue.js");
const {discordLog} = require("../handlers/log.js");
const { requireAuth } = require("../handlers/checkMiddleware.js");
const PterodactylApplicationModule = require('../handlers/ApplicationAPI.js');

if (settings?.pterodactyl?.domain?.endsWith("/")) {
  settings.pterodactyl.domain = settings.pterodactyl.domain.slice(0, -1);
}

module.exports.load = async function(router, db) {
  const AppAPI = new PterodactylApplicationModule(settings.pterodactyl.domain, settings.pterodactyl.key);
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);
  
router.get("/updateinfo", authMiddleware, async (req, res) => {
    try {
        // Get user's package and extra resources
        const packagename = await db.get("package-" + req.session.userinfo.id);
        const package = settings.api.client.packages.list[packagename ? packagename : settings.api.client.packages.default];
        const extra = await db.get("extra-" + req.session.userinfo.id) || {
            ram: 0,
            disk: 0,
            cpu: 0,
            servers: 0
        };

        // Calculate total allowed resources
        const totalAllowedRam = package.ram + extra.ram;
        const totalAllowedDisk = package.disk + extra.disk;
        const totalAllowedCpu = package.cpu + extra.cpu;

        // Calculate current resource usage
        let totalUsedRam = 0;
        let totalUsedDisk = 0;
        let totalUsedCpu = 0;
        const servers = PterodactylUser.attributes.relationships.servers.data;

        for (const server of servers) {
            totalUsedRam += server.attributes.limits.memory;
            totalUsedDisk += server.attributes.limits.disk;
            totalUsedCpu += server.attributes.limits.cpu;
        }

        // Check if resources are exceeded
        if (totalUsedRam > totalAllowedRam || totalUsedDisk > totalAllowedDisk || totalUsedCpu > totalAllowedCpu) {
            console.log(`User ${req.session.userinfo.id} exceeding resources. Adjusting servers...`);

            // Adjust each server's resources
            for (const server of servers) {
                const serverId = server.attributes.id;

                await AppAPI.updateServerBuild(serverId, {
                    memory: 1024,
                    disk: 5120,
                    cpu: 50
                });

                await AppAPI.updateServerBuild(serverId, {
                    allocation: server.attributes.allocation,
                    memory: 1024,
                    swap: server.attributes.limits.swap,
                    disk: 5120,
                    io: server.attributes.limits.io,
                    cpu: 50,
                    feature_limits: server.attributes.feature_limits
                });

                discordLog(
                    "resource adjustment",
                    `Adjusted resources for server ${serverId} belonging to user ${req.session.userinfo.id} to standard limits (RAM: 1024MB, Disk: 5120MB, CPU: 50%)`
                );
            }

            const PterodactylUserRefresh = await getPteroUser(req.session.userinfo.id, db);
            if (!PterodactylUserRefresh) {
                res.send("An error has occurred while attempting to update your account information and server list.");
                return;
            }

            req.session.pterodactyl = PterodactylUserRefresh.attributes;
        }

        req.session.pterodactyl = PterodactylUser.attributes;

        if (req.query.redirect && typeof req.query.redirect === "string") {
            return res.redirect("/" + req.query.redirect);
        }
        
        res.redirect("/dashboard");
    } catch (error) {
        console.error("Error in updateinfo:", error);
        res.send("An error occurred while updating account information.");
    }
});

router.get("/server/create", authMiddleware, async (req, res) => {
    if (!settings.api.client.allow.server.create) {
      res.redirect("/servers?err=disabled");
      return;
    }

        if (!req.query.name || !req.query.ram || !req.query.disk || !req.query.cpu || !req.query.egg || !req.query.location) {
            res.redirect(`/server/new?err=MISSINGVARIABLE`);
            return;
        }
            try {
                decodeURIComponent(req.query.name);
            } catch (err) {
                return res.redirect(`/server/new?err=COULDNOTDECODENAME`);
            }

            let packagename = await db.get("package-" + req.session.userinfo.id);
            let package = settings.api.client.packages.list[packagename ? packagename : settings.api.client.packages.default];

            let extra = (await db.get("extra-" + req.session.userinfo.id)) || {
                ram: 0,
                disk: 0,
                cpu: 0,
                servers: 0,
            };

            // Calculate resources used by active servers
            let ram2 = 0;
            let disk2 = 0;
            let cpu2 = 0;
            let servers2 = req.session.pterodactyl.relationships.servers.data.length;
            for (let i = 0, len = req.session.pterodactyl.relationships.servers.data.length; i < len; i++) {
                ram2 += req.session.pterodactyl.relationships.servers.data[i].attributes.limits.memory;
                disk2 += req.session.pterodactyl.relationships.servers.data[i].attributes.limits.disk;
                cpu2 += req.session.pterodactyl.relationships.servers.data[i].attributes.limits.cpu;
            }

            if (servers2 >= package.servers + extra.servers) {
                return res.redirect(`/server/new?err=TOOMUCHSERVERS`);
            }

            let name = decodeURIComponent(req.query.name);
            if (name.length < 3) {
                return res.redirect(`/server/new?err=LITTLESERVERNAME`);
            }
            if (name.length > 191) {
                return res.redirect(`/server/new?err=BIGSERVERNAME`);
            }

            let location = req.query.location;

            if (Object.entries(settings.api.client.locations).filter((vname) => vname[0] == location).length !== 1) {
                return res.redirect(`/server/new?err=INVALIDLOCATION`);
            }

            let requiredpackage = Object.entries(settings.api.client.locations).filter((vname) => vname[0] == location)[0][1].package;
            if (requiredpackage)
                if (!requiredpackage.includes(packagename ? packagename : settings.api.client.packages.default)) {
                    return res.redirect(`../dashboard?err=INVALIDLOCATIONFORPACKAGE`);
                }

            let egg = req.query.egg;
            let egginfo = settings.api.client.eggs[egg];
            if (!egginfo) {
                return res.redirect(`/server/new?err=INVALIDEGG`);
            }

            let ram = parseFloat(req.query.ram);
            let disk = parseFloat(req.query.disk);
            let cpu = parseFloat(req.query.cpu);
            // Validate number inputs
            const validateResource = (value, type, current, max, min) => {
                if (isNaN(value)) return 'NOTANUMBER';
                if (current + value > max) return `EXCEED${type}&num=${max - current}`;
                if (min && value < min) return `TOOLITTLE${type}&num=${min}`;
                if (egginfo.maximum?.[type.toLowerCase()] && value > egginfo.maximum[type.toLowerCase()]) 
                    return `TOOMUCH${type}&num=${egginfo.maximum[type.toLowerCase()]}`;
                return null;
            };

            const resources = [
                { value: ram, type: 'RAM', current: ram2, max: package.ram + extra.ram, min: egginfo.minimum.ram },
                { type: 'DISK', value: disk, current: disk2, max: package.disk + extra.disk, min: egginfo.minimum.disk },
                { type: 'CPU', value: cpu, current: cpu2, max: package.cpu + extra.cpu, min: egginfo.minimum.cpu }
            ];

            for (const resource of resources) {
                const error = validateResource(
                    resource.value,
                    resource.type,
                    resource.current,
                    resource.max,
                    resource.min
                );
                if (error) return res.redirect(`/server/new?err=${error}`);
            }
                const specs = egginfo.info;

                const serverSpecs = {
                  name: name.trim(),
                  user: await db.get(`users-${req.session.userinfo.id}`),
                  egg: specs.egg,
                  docker_image: specs.docker_image,
                  startup: specs.startup,
                  environment: specs.environment,
                  limits: {
                      memory: ram,
                      swap: -1,
                      disk: disk,
                      io: 500,
                      cpu: cpu
                  },
                  feature_limits: {
                      databases: specs.feature_limits.databases,
                      backups: specs.feature_limits.backups,
                      allocations: specs.feature_limits.allocations
                  },
                  deploy: {
                      locations: [location],
                      dedicated_ip: false,
                      port_range: []
                  }
        };

    let serverinfo = await AppAPI.createServer(serverSpecs);
    if (!serverinfo || !serverinfo.attributes) {
        console.error("Pterodactyl API Error:", serverinfo);
        const encodedError = encodeURIComponent(JSON.stringify(serverinfo || { error: "Unknown error" }));
        return res.redirect(`/dashboard?err=PTERODACTYL&data=${encodedError}`);
    }
                let serverinfotext = serverinfo;
                let newpterodactylinfo = req.session.pterodactyl;
                newpterodactylinfo.relationships.servers.data.push(serverinfotext);
                req.session.pterodactyl = newpterodactylinfo;
                
                discordLog(
                    "created server",
                    `${req.session.userinfo.username} and with the userid \`${req.session.userinfo.id}\` created a new server named \`${name}\` with the following specs:\n\`\`\`Memory: ${ram} MB\nCPU: ${cpu}%\nDisk: ${disk}\`\`\``
                );
                console.log(`user ${req.session.userinfo.username} created a server called ${name}`)
                return res.redirect("/dashboard?err=CREATED");
});
async function processQueue() {
  console.log('Processing queue...');
  let queuedServers = await db.get("queuedServers") || [];
  if (queuedServers.length === 0) return;

  let serverToCreate = queuedServers[0];

  console.log(`Next server in queue: ${serverToCreate.name}`);

  // Re-fetch the egg information
  let egginfo = settings.api.client.eggs[serverToCreate.egg];
  if (!egginfo) {
    console.log(`Error: Invalid egg ${serverToCreate.egg} for server ${serverToCreate.name}`);
    await removeFromQueue(serverToCreate);
    return;
  }

  // Update specs with the latest egg info
  let specs = {
    ...egginfo.info,
    user: serverToCreate.user,
    name: serverToCreate.name,
    limits: {
      swap: -1,
      io: 500,
      backups: 0,
      memory: serverToCreate.limits.memory,
      disk: serverToCreate.limits.disk,
      cpu: serverToCreate.limits.cpu
    },
    deploy: serverToCreate.deploy || {
      locations: [],
      dedicated_ip: false,
      port_range: [],
    }
  };

  console.log('Attempting to create server...');
  try {
    let serverinfo = await AppAPI.createServer(specs);
    console.log(`Pterodactyl API response status: ${serverinfo.status} ${serverinfo.statusText}`);

    if (serverinfo && serverinfo.attributes) {
      console.log('Server created successfully');
      await removeFromQueue(serverToCreate);

      discordLog(
        "server created from queue",
        `Server \`${serverToCreate.name}\` for user ID ${serverToCreate.userId} has been successfully created from the queue.`
      );
    } else {
      console.log('Server creation failed');
      console.log('Response body:', await serverinfo.text());
      
      // Remove the server from the queue if Pterodactyl sent an error
      await removeFromQueue(serverToCreate);
      
      discordLog(
        "server creation failed",
        `Failed to create server \`${serverToCreate.name}\` for user ID ${serverToCreate.userId} from the queue. Server removed from queue due to Pterodactyl error.`
      );
    }
  } catch (error) {
    console.error('Error during server creation:', error);
    // Remove the server from the queue if an error occurred
    await removeFromQueue(serverToCreate);
    
    discordLog(
      "server creation error",
      `Error occurred while creating server \`${serverToCreate.name}\` for user ID ${serverToCreate.userId} from the queue. Server removed from queue.`
    );
  }

  // Update queue positions for remaining servers
  queuedServers = await db.get("queuedServers") || [];
  queuedServers.forEach((server, index) => {
    server.queuePosition = index + 1;
  });
  await db.set("queuedServers", queuedServers);
}

async function removeFromQueue(server) {
  let queuedServers = await db.get("queuedServers") || [];
  queuedServers = queuedServers.filter(s => s.name !== server.name);
  await db.set("queuedServers", queuedServers);

  let userQueuedServers = await db.get(`${server.userId}-queued`) || [];
  userQueuedServers = userQueuedServers.filter(s => s.name !== server.name);
  await db.set(`${server.userId}-queued`, userQueuedServers);
}

// Set up interval to process queue every 5 minutes
//setInterval(processQueue, 5 * 60 * 1000);

// Route to manually process the queue
router.get("/process-queue", authMiddleware, async (req, res) => {
  await processQueue();
  res.json({ status: 200, msg: 'Queue processed successfully' });
});

// Route to remove a server from the queue
router.get("/queue-remove/:id", authMiddleware, async (req, res) => {
  let serverPos = parseInt(req.params.id);
  let userId = req.session.userinfo.id;

  let queuedServers = await db.get("queuedServers") || [];
  
  // Find the server to remove
  let serverToRemove = queuedServers.find(server => server.queuePosition === serverPos && server.userId === userId);
  
  if (serverToRemove) {
      // Remove the server from the main queue
      queuedServers = queuedServers.filter(server => server !== serverToRemove);
      
      // Update positions for remaining servers
      queuedServers.forEach((server, index) => {
          server.queuePosition = index + 1;
      });
      
      await db.set("queuedServers", queuedServers);

      // Remove the server from the user's queue
      let userQueuedServers = await db.get(`${userId}-queued`) || [];
      userQueuedServers = userQueuedServers.filter(server => server.queuePosition !== serverPos);
      await db.set(`${userId}-queued`, userQueuedServers);

      discordLog(
          "removed server from queue",
          `User ${userId} removed server "${serverToRemove.name}" from queue position ${serverPos}`
      );

      res.redirect('/dashboard')
  } else {
      res.status(404).json({ status: 404, msg: 'Open a ticket if you see this message.' });
  }
});

// Route to clear the entire queue
router.get("/clear-queue", authMiddleware, async (req, res) => {
  try {
      let queuedServers = await db.get("queuedServers") || [];

      discordLog(
          "cleared server queue",
          `Admin ${req.session.userinfo.username} cleared the server queue. ${queuedServers.length} servers were removed from the queue.`
      );

      await db.set("queuedServers", []);

      for (let server of queuedServers) {
          let userQueuedServers = await db.get(`${server.userId}-queued`) || [];
          userQueuedServers = userQueuedServers.filter(s => s.name !== server.name);
          await db.set(`${server.userId}-queued`, userQueuedServers);
      }

      res.json({ status: 200, message: 'Queue cleared successfully' });
  } catch (error) {
      console.error('Error clearing queue:', error);
      res.status(500).json({ status: 500, error: 'An error occurred while clearing the queue' });
  }
});

    router.get("/server/:id/modify", authMiddleware, async (req, res) => {
        if (!settings.api.client.allow.server.modify) {
          res.redirect("/servers?err=disabled");
          return;
        }

        const { id } = req.params;

          if (!id) return res.send("Missing server id.");
    
          let redirectlink = "/server/edit";
    
          let checkexist =
            req.session.pterodactyl.relationships.servers.data.filter(
              (name) => name.attributes.id == id
            );
          if (checkexist.length !== 1) return res.send("Invalid server id.");
    
          let ram = req.query.ram
            ? isNaN(parseFloat(req.query.ram))
              ? undefined
              : parseFloat(req.query.ram)
            : undefined;
          let disk = req.query.disk
            ? isNaN(parseFloat(req.query.disk))
              ? undefined
              : parseFloat(req.query.disk)
            : undefined;
          let cpu = req.query.cpu
            ? isNaN(parseFloat(req.query.cpu))
              ? undefined
              : parseFloat(req.query.cpu)
            : undefined;

          if (!ram || !disk || !cpu) {
            res.redirect(`${redirectlink}?id=${id}&err=MISSINGVARIABLE`);
            return;
          }
    
            let packagename = await db.get("package-" + req.session.userinfo.id);
            let package =
              settings.api.client.packages.list[
                packagename ? packagename : settings.api.client.packages.default
              ];
    
            let pterorelationshipsserverdata =
              req.session.pterodactyl.relationships.servers.data.filter(
                (name) => name.attributes.id.toString() !== id
              );
    
            let ram2 = 0;
            let disk2 = 0;
            let cpu2 = 0;
            for (
              let i = 0, len = pterorelationshipsserverdata.length;
              i < len;
              i++
            ) {
              ram2 =
                ram2 + pterorelationshipsserverdata[i].attributes.limits.memory;
              disk2 =
                disk2 + pterorelationshipsserverdata[i].attributes.limits.disk;
              cpu2 = cpu2 + pterorelationshipsserverdata[i].attributes.limits.cpu;
            }
            let attemptegg = null;
            //let attemptname = null;
    
            for (let [name, value] of Object.entries(settings.api.client.eggs)) {
              if (value.info.egg == checkexist[0].attributes.egg) {
                attemptegg = settings.api.client.eggs[name];
                //attemptname = name;
              }
            }
            let egginfo = attemptegg ? attemptegg : null;
    
            if (!egginfo)
              return res.redirect(
                `${redirectlink}?id=${id}&err=MISSINGEGG`
              );
    
            let extra = (await db.get("extra-" + req.session.userinfo.id))
              ? await db.get("extra-" + req.session.userinfo.id)
              : {
                  ram: 0,
                  disk: 0,
                  cpu: 0,
                  servers: 0,
                };

            const validateResource = (value, type, current, max, min) => {
                if (current + value > max) return `EXCEED${type}&num=${max - current}`;
                if (min && value < min) return `TOOLITTLE${type}&num=${min}`;
                if (egginfo.maximum?.[type.toLowerCase()] && value > egginfo.maximum[type.toLowerCase()]) 
                    return `TOOMUCH${type}&num=${egginfo.maximum[type.toLowerCase()]}`;
                return null;
            };

            const resources = [
                { value: ram, type: 'RAM', current: ram2, max: package.ram + extra.ram, min: egginfo.minimum.ram },
                { value: disk, type: 'DISK', current: disk2, max: package.disk + extra.disk, min: egginfo.minimum.disk },
                { value: cpu, type: 'CPU', current: cpu2, max: package.cpu + extra.cpu, min: egginfo.minimum.cpu }
            ];

            for (const resource of resources) {
                const error = validateResource(
                    resource.value,
                    resource.type,
                    resource.current,
                    resource.max,
                    resource.min
                );
                if (error) return res.redirect(`${redirectlink}?id=${id}&err=${error}`);
            }
    
            let limits = {
              memory: ram ? ram : checkexist[0].attributes.limits.memory,
              disk: disk ? disk : checkexist[0].attributes.limits.disk,
              cpu: cpu ? cpu : checkexist[0].attributes.limits.cpu,
              swap: egginfo ? checkexist[0].attributes.limits.swap : -1,
              io: egginfo ? checkexist[0].attributes.limits.io : 500,
            };
    
            let serverinfo = await AppAPI.updateServerBuild(id, {
              limits: limits,
              feature_limits: checkexist[0].attributes.feature_limits,
              allocation: checkexist[0].attributes.allocation,
            });
            if (!serverinfo || !serverinfo.attributes)
              return res.redirect(
                `${redirectlink}?id=${id}&err=ERRORONMODIFY`
              );
            let text = serverinfo;
            discordLog(
              `modified server`,
              `${req.session.userinfo.username} modified the server called \`${text.attributes.name}\` to have the following specs:\n\`\`\`Memory: ${ram} MB\nCPU: ${cpu}%\nDisk: ${disk}\`\`\``
            );
            pterorelationshipsserverdata.push(text);
            req.session.pterodactyl.relationships.servers.data =
              pterorelationshipsserverdata;

            adminjs.suspend(req.session.userinfo.id);
            res.redirect("/dashboard?err=MODIFIED");
      });

router.get("/server/:id/delete", authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!id) return res.send("Missing id.");

  if (!settings.api.client.allow.server.delete) {
    res.redirect("/servers?err=disabled");
    return;
  }
    if (
      req.session.pterodactyl.relationships.servers.data.filter(
        (server) => server.attributes.id == id
      ).length == 0
    )
      return res.send("Could not find server with that ID.");

    // Check if the server is suspended
    const server = await AppAPI.getServerDetails(id);

    if (server.attributes.suspended) {
      return res.redirect("/dashboard?err=SUSPENDED")
    }

    try {
      await AppAPI.deleteServer(id, true);
    } catch (error) {
      return res.send(
        "An error has occurred while attempting to delete the server."
      );
    }

    let pterodactylinfo = req.session.pterodactyl;
    pterodactylinfo.relationships.servers.data =
      pterodactylinfo.relationships.servers.data.filter(
        (server) => server.attributes.id.toString() !== id
      );
    req.session.pterodactyl = pterodactylinfo;
    discordLog(
      `deleted server`,
      `${req.session.userinfo.username} deleted the server called \`${server.attributes.name}\``
    );

    adminjs.suspend(req.session.userinfo.id);

    return res.redirect("/dashboard?err=DELETED");
  });
};