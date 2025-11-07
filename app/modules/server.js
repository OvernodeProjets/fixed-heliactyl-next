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
  "name": "Pterodactyl Server Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const PterodactylClientModule = require("../handlers/ClientAPI.js");
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const WebSocket = require("ws");
const axios = require("axios");
const FormData = require("form-data");
const path = require("path");
const fs = require("fs");
const schedule = require("node-schedule");
const { requireAuth, ownsServer } = require("../handlers/checkMiddleware.js")
const { discordLog, serverActivityLog } = require("../handlers/log.js");

const workflowsFilePath = path.join(__dirname, "../storage/workflows.json");
const scheduledWorkflowsFilePath = path.join(
  __dirname,
  "../storage/scheduledWorkflows.json"
);
module.exports.load = async function (router, db) {
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);

  const pterodactylClient = new PterodactylClientModule(
    settings.pterodactyl.domain,
    settings.pterodactyl.client_key
  );

// Add a list function to get all keys with a specific prefix
async function listKeys(prefix) {
  return new Promise((resolve, reject) => {
    const keys = [];
    db.db.each(
      "SELECT [key] FROM keyv WHERE [key] LIKE ?",
      [`${db.namespace}:${prefix}%`],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          keys.push(row.key.replace(`${db.namespace}:`, ''));
        }
      },
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(keys);
        }
      }
    );
  });
}

// Helper function to get world type (default, nether, end, or custom)
// should be based on server.properties
function getWorldType(worldName, defaultWorld) {
  if (worldName === defaultWorld) return 'default';
  if (worldName === `${defaultWorld}_nether`) return 'nether';
  if (worldName === `${defaultWorld}_the_end`) return 'end';
  return 'custom';
}

async function isValidWorld(fileData, serverId) {
  try {
    // First basic checks
    if (fileData.attributes.mimetype !== "inode/directory" || 
        fileData.attributes.name.startsWith('.')) {
      return false;
    }

    // Known world dimensions are always valid
    if (fileData.attributes.name.endsWith('_nether') || 
        fileData.attributes.name.endsWith('_the_end')) {
      return true;
    }

    // For other directories, check for level.dat
    const worldContents = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/list`,
      {
        params: { directory: `/${fileData.attributes.name}` },
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    // Check if level.dat exists in the directory
    return worldContents.data.data.some(file => 
      file.attributes.name === 'level.dat' && 
      !file.attributes.mimetype.startsWith('inode/')
    );
  } catch (error) {
    console.error(`Error checking if ${fileData.attributes.name} is a valid world:`, error);
    return false;
  }
}


// Worlds endpoints
router.get('/server/:id/worlds', authMiddleware, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    
    // Get server.properties to find level-name
    const serverPropsResponse = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/contents`,
      {
        params: { file: '/server.properties' },
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    // Parse server.properties to get default world name
    const serverProps = serverPropsResponse.data
      .split('\n')
      .reduce((acc, line) => {
        const [key, value] = line.split('=');
        if (key && value) acc[key.trim()] = value.trim();
        return acc;
      }, {});

    const defaultWorld = serverProps['level-name'] || 'world';

    // List contents of root directory to find world folders
    const response = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/list`,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    // Filter for world folders (using Promise.all since we're using async filter)
    const fl = await Promise.all(
      response.data.data.map(async (folder) => {
        const isWorld = await isValidWorld(folder, serverId);
        return isWorld ? folder : null;
      })
    );

    const worldFolders = fl.filter(folder => folder !== null);

    // Get tracked custom worlds from database
    const trackedWorlds = await db.get(`worlds-${serverId}`) || [];
    const trackedWorldNames = new Set(trackedWorlds);

    // Categorize worlds
    const worlds = {
      default: null,
      nether: null,
      end: null,
      custom: []
    };

    for (const folder of worldFolders) {
      const worldName = folder.attributes.name;
      const worldType = getWorldType(worldName, defaultWorld);
      
      const worldData = {
        attributes: {
          ...folder.attributes,
          type: worldType,
          isCustom: trackedWorldNames.has(worldName)
        }
      };

      if (worldType === 'custom') {
        worlds.custom.push(worldData);
      } else {
        worlds[worldType] = worldData;
      }
    }

    res.json(worlds);
  } catch (error) {
    console.error('Error listing worlds:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/server/:id/worlds/import', authMiddleware, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const { worldName } = req.body;

    if (!worldName) {
      return res.status(400).json({ error: 'World name is required' });
    }

    // Create temp directory if it doesn't exist
    try {
      await axios.post(
        `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/create-folder`,
        {
          root: '/',
          name: 'temp'
        },
        {
          headers: {
            'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
            'Accept': 'application/json',
          },
        }
      );
    } catch (error) {
      // Ignore error if folder already exists
    }

    // 1. Get upload URL
    const uploadUrlResponse = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/upload`,
      {
        params: { directory: '/temp' },
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    // 2. Return the upload URL and needed headers for the client
    res.json({
      url: uploadUrlResponse.data.attributes.url,
      worldName: worldName
    });

  } catch (error) {
    console.error('Error preparing world import:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/server/:id/worlds/import/complete', authMiddleware, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const { worldName, fileName } = req.body;

    // 1. Create temp directory
    try {
      await axios.post(
        `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/create-folder`,
        {
          root: '/',
          name: 'temp'
        },
        {
          headers: {
            'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
            'Accept': 'application/json',
          },
        }
      );
    } catch (error) {
      // Ignore error if folder already exists
    }

    // 2. Move zip to temp directory
    await axios.put(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/rename`,
      {
        root: '/',
        files: [
          {
            from: fileName,
            to: `temp/${fileName}`
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    // 3. Decompress the zip in temp directory
    await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/decompress`,
      {
        root: '/temp',
        file: fileName
      },
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    // 4. Delete the zip file
    await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/delete`,
      {
        root: '/temp',
        files: [fileName]
      },
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    // 5. List contents of temp directory
    const tempContents = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/list`,
      {
        params: { directory: '/temp' },
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    // Create the final world directory
    await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/create-folder`,
      {
        root: '/',
        name: worldName
      },
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    // 6. Move files to final location
    const items = tempContents.data.data;
    if (items.length === 1 && items[0].attributes.mimetype === "inode/directory") {
      // If there's a single directory, move its contents
      const srcDirName = items[0].attributes.name;
      const srcContents = await axios.get(
        `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/list`,
        {
          params: { directory: `/temp/${srcDirName}` },
          headers: {
            'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
            'Accept': 'application/json',
          },
        }
      );

      // Move each file/folder from the source directory
      for (const item of srcContents.data.data) {
        await axios.put(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/rename`,
          {
            root: `/temp/${srcDirName}`,
            files: [
              {
                from: item.attributes.name,
                to: `../../${worldName}/${item.attributes.name}`
              }
            ]
          },
          {
            headers: {
              'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
              'Accept': 'application/json',
            },
          }
        );
      }
    } else {
      // Move all files directly
      for (const item of items) {
        await axios.put(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/rename`,
          {
            root: '/temp',
            files: [
              {
                from: item.attributes.name,
                to: `../${worldName}/${item.attributes.name}`
              }
            ]
          },
          {
            headers: {
              'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
              'Accept': 'application/json',
            },
          }
        );
      }
    }

    // 7. Clean up temp directory
    await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/delete`,
      {
        root: '/',
        files: ['temp']
      },
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    // 8. Track the imported world in database
    const trackedWorlds = await db.get(`worlds-${serverId}`) || [];
    if (!trackedWorlds.includes(worldName)) {
      trackedWorlds.push(worldName);
      await db.set(`worlds-${serverId}`, trackedWorlds);
    }

    await serverActivityLog(db, serverId, 'Import World', { worldName });
    res.json({ success: true });
  } catch (error) {
    console.error('Error completing world import:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/server/:id/worlds/:worldName', authMiddleware, ownsServer, async (req, res) => {
  try {
    const { id: serverId, worldName } = req.params;

    // Get server.properties to check if trying to delete default world
    const serverPropsResponse = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/contents`,
      {
        params: { file: '/server.properties' },
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    const serverProps = serverPropsResponse.data
      .split('\n')
      .reduce((acc, line) => {
        const [key, value] = line.split('=');
        if (key && value) acc[key.trim()] = value.trim();
        return acc;
      }, {});

    const defaultWorld = serverProps['level-name'] || 'world';

    // Prevent deletion of default world and its associated dimensions
    if (worldName === defaultWorld ||
        worldName === `${defaultWorld}_nether` ||
        worldName === `${defaultWorld}_the_end`) {
      return res.status(400).json({ error: 'Cannot delete default world or its dimensions' });
    }

    // Delete the world folder
    await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/delete`,
      {
        root: '/',
        files: [worldName]
      },
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    // Remove from tracked worlds
    const trackedWorlds = await db.get(`worlds-${serverId}`) || [];
    const updatedWorlds = trackedWorlds.filter(w => w !== worldName);
    await db.set(`worlds-${serverId}`, updatedWorlds);

    await serverActivityLog(db, serverId, 'Delete World', { worldName });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting world:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/server/:id/allocations - Assign new allocation
router.post('/server/:id/allocations', authMiddleware, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;

    const response = await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/network/allocations`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error assigning allocation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  function saveWorkflowToFile(instanceId, workflow) {
    try {
      let workflows = {};

      if (fs.existsSync(workflowsFilePath)) {
        const data = fs.readFileSync(workflowsFilePath, "utf8");
        workflows = JSON.parse(data);
      }

      workflows[instanceId] = workflow;

      fs.writeFileSync(
        workflowsFilePath,
        JSON.stringify(workflows, null, 2),
        "utf8"
      );
    } catch (error) {
      console.error("Error saving workflow to file:", error);
    }
  }

  function saveScheduledWorkflows() {
    try {
      const scheduledWorkflows = {};

      for (const job of Object.values(schedule.scheduledJobs)) {
        if (job.name.startsWith("job_")) {
          const instanceId = job.name.split("_")[1];
          scheduledWorkflows[instanceId] = job.nextInvocation();
        }
      }

      fs.writeFileSync(
        scheduledWorkflowsFilePath,
        JSON.stringify(scheduledWorkflows, null, 2),
        "utf8"
      );
    } catch (error) {
      console.error("Error saving scheduled workflows:", error);
    }
  }

  function loadScheduledWorkflows() {
    try {
      if (fs.existsSync(scheduledWorkflowsFilePath)) {
        const data = fs.readFileSync(scheduledWorkflowsFilePath, "utf8");
        const scheduledWorkflows = JSON.parse(data);

        for (const [instanceId, nextInvocation] of Object.entries(
          scheduledWorkflows
        )) {
          const workflow = loadWorkflowFromFile(instanceId);
          if (workflow) {
            scheduleWorkflowExecution(instanceId, workflow);
          }
        }
      }
    } catch (error) {
      console.error("Error loading scheduled workflows:", error);
    }
  }


  loadScheduledWorkflows();

// GET /api/server/:id/logs - Get server activity logs
router.get('/server/:id/logs', authMiddleware, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    // Get logs from database
    const activityLog = await db.get(`activity_log_${serverId}`) || [];
    
    // Calculate pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const totalLogs = activityLog.length;
    const totalPages = Math.ceil(totalLogs / limit);
    
    // Get paginated logs
    const paginatedLogs = activityLog.slice(startIndex, endIndex);
    
    // Format response with pagination metadata
    const response = {
      data: paginatedLogs,
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_items: totalLogs,
        items_per_page: limit,
        has_more: endIndex < totalLogs
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // Spigot API base URL
  const SPIGOT_API_BASE = "https://api.spiget.org/v2";

  // Endpoint to list plugins (first 100)
  router.get("/plugins/list", async (req, res) => {
    try {
      const response = await axios.get(`${SPIGOT_API_BASE}/resources`, {
        params: {
          size: 100,
          sort: "-downloads", // Sorting by downloads (most popular)
        },
      });
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching plugin list:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Search endpoint
  router.get("/plugins/search", async (req, res) => {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    try {
      const response = await axios.get(
        `${SPIGOT_API_BASE}/search/resources/${query}`,
        {
          params: {
            size: 100,
            sort: "-downloads", // Sorting by downloads (most popular)
          },
        }
      );
      res.json(response.data);
    } catch (error) {
      console.error("Error searching plugins:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/server/:id/backups
  router.get(
    "/server/:id/backups",
    authMiddleware,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const response = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/backups`,
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.json(response.data);
      } catch (error) {
        console.error("Error fetching backups:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/backups
  router.post(
    "/server/:id/backups",
    authMiddleware,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const response = await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/backups`,
          {},
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.status(201).json(response.data);
      } catch (error) {
        console.error("Error creating backup:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // GET /api/server/:id/backups/:backupId/download
  router.get(
    "/server/:id/backups/:backupId/download",
    authMiddleware,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const backupId = req.params.backupId;
        const response = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/backups/${backupId}/download`,
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.json(response.data);
      } catch (error) {
        console.error("Error generating backup download link:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // DELETE /api/server/:id/backups/:backupId
  router.delete(
    "/server/:id/backups/:backupId",
    authMiddleware,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const backupId = req.params.backupId;
        await axios.delete(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/backups/${backupId}`,
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting backup:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  router.post(
    "/plugins/install/:serverId",
    authMiddleware,
    ownsServer,
    async (req, res) => {
      const { serverId } = req.params;
      const { pluginId } = req.body;

      if (!pluginId) {
        return res.status(400).json({ error: "Plugin ID is required" });
      }

      try {
        // 1. Get plugin download details
        const pluginDetails = await axios.get(
          `${SPIGOT_API_BASE}/resources/${pluginId}`
        );
        const downloadUrl = `https://api.spiget.org/v2/resources/${pluginId}/download`;

        // 2. Download the plugin
        const pluginResponse = await axios.get(downloadUrl, {
          responseType: "arraybuffer",
        });
        const pluginBuffer = Buffer.from(pluginResponse.data, "binary");

        // 3. Get signed upload URL from Pterodactyl
        const uploadUrlResponse = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/upload`,
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );

        const uploadUrl = uploadUrlResponse.data.attributes.url;

        // 4. Upload the plugin to the signed URL using multipart/form-data
        const form = new FormData();
        const tempFileName = `temp_${Date.now()}_${pluginId}.jar`;
        form.append("files", pluginBuffer, {
          filename: tempFileName,
          contentType: "application/java-archive",
        });

        const headers = form.getHeaders();
        await axios.post(uploadUrl, form, {
          headers: {
            ...headers,
            "Content-Length": form.getLengthSync(),
          },
        });

        // 5. Rename (move) the file to the plugins directory
        const renameResponse = await axios.put(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/rename`,
          {
            root: "/",
            files: [
              {
                from: tempFileName,
                to: `plugins/${pluginDetails.data.name}.jar`,
              },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );

        res.json({ message: "Plugin installed successfully" });
      } catch (error) {
        console.error("Error installing plugin:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // GET workflow
  router.get(
    "/server/:id/workflow",
    authMiddleware,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        let workflow = await db.get(serverId + "_workflow");
        if (!workflow) {
          workflow = loadWorkflowFromFile(serverId);
        }

        if (!workflow) {
          workflow = {};
        }

        res.json(workflow);
      } catch (error) {
        console.error("Error fetching server details:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

// GET /api/server/:id/variables
router.get('/server/:id/variables', authMiddleware, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const response = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/startup`,
      {
        headers: {
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
          Accept: 'application/json',
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching server variables:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/server/:id/variables
router.put('/server/:id/variables', authMiddleware, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const { key, value } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Missing key or value' });
    }

    const response = await axios.put(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/startup/variable`,
      { key, value },
      {
        headers: {
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error updating server variable:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // POST save workflow
  router.post(
    "/server/:instanceId/workflow/save-workflow",
    authMiddleware,
    ownsServer,
    async (req, res) => {
      const { instanceId } = req.params;
      const workflow = req.body;

      if (!instanceId || !workflow) {
        return res
          .status(400)
          .json({ success: false, message: "Missing required data" });
      }

      try {
        const scheduledJob = schedule.scheduledJobs[`job_${instanceId}`];
        if (scheduledJob) {
          scheduledJob.cancel();
        }

        await db.set(instanceId + "_workflow", workflow);
        saveWorkflowToFile(instanceId, workflow);

        scheduleWorkflowExecution(instanceId, workflow);

        saveScheduledWorkflows();

        await serverActivityLog(db, instanceId, 'Save Workflow', { workflowDetails: workflow });

        res.json({ success: true, message: "Workflow saved successfully" });
      } catch (error) {
        console.error("Error saving workflow:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    }
  );

// Add new endpoint to show servers where the user is a subuser
router.get('/subuser-servers', authMiddleware, async (req, res) => {
  try {
    const userId = req.session.pterodactyl.username;
    console.log(`Fetching subuser servers for user ${userId}`);
    let subuserServers = await db.get(`subuser-servers-${userId}`) || [];
    
    console.log(`Found ${subuserServers.length} subuser servers for user ${userId}`);
    res.json(subuserServers);
  } catch (error) {
    console.error('Error fetching subuser servers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function updateSubuserInfo(serverId, serverOwnerId) {
  try {
    console.log(`Updating subuser info for server ${serverId}`);
    const response = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/users`,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    const subusers = response.data.data.map(user => ({
      id: user.attributes.username,
      username: user.attributes.username,
      email: user.attributes.email,
    }));

    console.log(`Found ${subusers.length} subusers for server ${serverId}`);

    // Update server owner's subuser list
    await db.set(`subusers-${serverId}`, subusers);

    // Update each subuser's server list
    const serverName = await getServerName(serverId);
    for (const subuser of subusers) {
      console.log(`Updating subuser-servers for user ${subuser.id}`);
      let subuserServers = await db.get(`subuser-servers-${subuser.id}`) || [];
      if (!subuserServers.some(server => server.id === serverId)) {
        subuserServers.push({
          id: serverId,
          name: serverName,
          ownerId: serverOwnerId
        });
        await db.set(`subuser-servers-${subuser.id}`, subuserServers);
        console.log(`Added server ${serverId} to subuser-servers for user ${subuser.id}`);
      }
    }

    // Remove any subusers that are no longer associated with this server
    const currentSubuserIds = new Set(subusers.map(u => u.id));
    const allUsers = await db.get('all_users') || [];

    const promises = allUsers.map(userId => db.get(`subuser-servers-${userId}`));
    const results = await Promise.all(promises);
    for (let i = 0; i < allUsers.length; i++) {
      const userId = allUsers[i];
      let userSubuserServers = results[i] || [];
      const updatedUserSubuserServers = userSubuserServers.filter(server => 
        server.id !== serverId || currentSubuserIds.has(userId)
      );
      if (updatedUserSubuserServers.length !== userSubuserServers.length) {
        await db.set(`subuser-servers-${userId}`, updatedUserSubuserServers);
        console.log(`Updated subuser-servers for user ${userId}`);
      }
    }

  } catch (error) {
    console.error(`Error updating subuser info for server ${serverId}:`, error);
  }
}

router.post('/sync-user-servers', authMiddleware, async (req, res) => {
  try {
    const userId = req.session.pterodactyl.id;
    console.log(`Syncing servers for user ${userId}`);

    // Add the current user to the all_users list
    await addUserToAllUsersList(userId);

    // Sync owned servers
    const ownedServers = req.session.pterodactyl.relationships.servers.data;
    for (const server of ownedServers) {
      await updateSubuserInfo(server.attributes.identifier, userId);
    }

    // Fetch and sync subuser servers
    const subuserServers = await db.get(`subuser-servers-${userId}`) || [];
    for (const server of subuserServers) {
      await updateSubuserInfo(server.id, server.ownerId);
    }

    res.json({ message: 'User servers synced successfully' });
  } catch (error) {
    console.error('Error syncing user servers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to get server name
async function getServerName(serverId) {
  try {
    const response = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}`,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data.attributes.name;
  } catch (error) {
    console.error('Error fetching server name:', error);
    return 'Unknown Server';
  }
}

async function addUserToAllUsersList(userId) {
  let allUsers = await db.get('all_users') || [];
  if (!allUsers.includes(userId)) {
    allUsers.push(userId);
    await db.set('all_users', allUsers);
  }
}

// Update the existing /server/:id/users endpoint to call updateSubuserInfo
router.get('/server/:id/users', authMiddleware, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const response = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/users`,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    
    // Update subuser info in the database
    await updateSubuserInfo(serverId, req.session.userinfo.id);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching subusers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/server/:id/users', authMiddleware, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const response = await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/users`,
      { email, permissions: [
          "control.console",
          "control.start",
          "control.stop",
          "control.restart",
          "user.create",
          "user.update",
          "user.delete",
          "user.read",
          "file.create",
          "file.read",
          "file.update",
          "file.delete",
          "file.archive",
          "file.sftp",
          "backup.create",
          "backup.read",
          "backup.delete",
          "backup.update",
          "backup.download",
          "allocation.update",
          "startup.update",
          "startup.read",
          "database.create",
          "database.read",
          "database.update",
          "database.delete",
          "database.view_password",
          "schedule.create",
          "schedule.read",
          "schedule.update",
          "settings.rename",
          "schedule.delete",
          "settings.reinstall",
          "websocket.connect"
        ] },
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    // Update subuser info after adding a new subuser
    await updateSubuserInfo(serverId, req.session.userinfo.id);

    // Add the new user to the all_users list
    const newUserId = response.data.attributes.username;
    await addUserToAllUsersList(newUserId);

    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error creating subuser:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // DELETE /api/server/:id/users/:subuser - Delete User
  router.delete('/server/:id/users/:subuser', authMiddleware, ownsServer, async (req, res) => {
    try {
      const { id: serverId, subuser: subuserId } = req.params;
      await axios.delete(
        `${settings.pterodactyl.domain}/api/client/servers/${serverId}/users/${subuserId}`,
        {
          headers: {
            'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting subuser:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST Set server power state
  router.post(
    "/server/:id/power",
    authMiddleware,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { signal } = req.body;

        const response = await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/power`,
          {
            signal: signal,
          },
          {
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
            },
          }
        );

        res.status(204).send();
      } catch (error) {
        console.error("Error changing power state:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

// Add these constants at the top of the file
const RENEWAL_PERIOD_HOURS = 48;
const WARNING_THRESHOLD_HOURS = 24; // When to start showing warnings
const CHECK_INTERVAL_MINUTES = 5; // How often to check for expired servers

async function initializeRenewalSystem(db) {
  // Start the background task to check for expired servers
  setInterval(async () => {
    await checkExpiredServers(db);
  }, CHECK_INTERVAL_MINUTES * 60 * 1000);
}

async function getRenewalStatus(db, serverId, user) {
  try {
    const renewalData = await db.get(`renewal_${serverId}`);
    const hasRenewalBypass = await db.get(`renewbypass-${user}`);
    
    if (!renewalData) {
      // Initialize renewal data if it doesn't exist
      const now = new Date();
      const nextRenewal = hasRenewalBypass ? 
        new Date('2099-12-31T23:59:59.999Z').toISOString() : 
        new Date(now.getTime() + RENEWAL_PERIOD_HOURS * 60 * 60 * 1000).toISOString();
      
      const initialRenewalData = {
        lastRenewal: now.toISOString(),
        nextRenewal: nextRenewal,
        isActive: true,
        renewalCount: 0,
        hasRenewalBypass: hasRenewalBypass
      };
      await db.set(`renewal_${serverId}`, initialRenewalData);
      return initialRenewalData;
    }

    // If renewal bypass has been purchased, update the nextRenewal date
    if (hasRenewalBypass && !renewalData.hasRenewalBypass) {
      const updatedRenewalData = {
        ...renewalData,
        nextRenewal: new Date('2099-12-31T23:59:59.999Z').toISOString(),
        hasRenewalBypass: true,
        isActive: true // Ensure server is active if it was previously expired
      };
      await db.set(`renewal_${serverId}`, updatedRenewalData);
      return updatedRenewalData;
    }

    return renewalData;
  } catch (error) {
    console.error(`Error getting renewal status for server ${serverId}:`, error);
    throw new Error('Failed to get renewal status');
  }
}

async function renewServer(db, serverId) {
  try {
    const now = new Date();
    const renewalData = await getRenewalStatus(db, serverId);
    
    // Update renewal data
    const updatedRenewalData = {
      lastRenewal: now.toISOString(),
      nextRenewal: new Date(now.getTime() + RENEWAL_PERIOD_HOURS * 60 * 60 * 1000).toISOString(),
      isActive: true,
      renewalCount: (renewalData.renewalCount || 0) + 1
    };
    
    await db.set(`renewal_${serverId}`, updatedRenewalData);
    await serverActivityLog(db, serverId, 'Server Renewal', {
      renewalCount: updatedRenewalData.renewalCount,
      nextRenewal: updatedRenewalData.nextRenewal
    });
    
    return updatedRenewalData;
  } catch (error) {
    console.error(`Error renewing server ${serverId}:`, error);
    throw new Error('Failed to renew server');
  }
}

async function checkExpiredServers(db) {
  try {
    // Get all renewal keys from the database
    const renewalKeys = await listKeys('renewal_');
    const now = new Date();

    for (const key of renewalKeys) {
      const serverId = key.replace('renewal_', '');
      const renewalData = await db.get(key);

      if (!renewalData || !renewalData.isActive) continue;

      const nextRenewal = new Date(renewalData.nextRenewal);
      const hoursUntilExpiration = (nextRenewal - now) / (1000 * 60 * 60);

      // If server is expired, shut it down
      if (hoursUntilExpiration <= 0) {
        await handleExpiredServer(db, serverId);
      }
      // If server is approaching expiration, log a warning
      else if (hoursUntilExpiration <= WARNING_THRESHOLD_HOURS) {
        await serverActivityLog(db, serverId, 'Renewal Warning', {
          hoursRemaining: Math.round(hoursUntilExpiration * 10) / 10
        });
      }
    }
  } catch (error) {
    console.error('Error checking expired servers:', error);
  }
}

async function handleExpiredServer(db, serverId) {
  try {
    // Update renewal status
    const renewalData = await db.get(`renewal_${serverId}`);
    renewalData.isActive = false;
    await db.set(`renewal_${serverId}`, renewalData);

    // Stop the server
    await executePowerAction(serverId, 'stop');

    console.log(`Server ${serverId} has expired and been stopped.`);

    // Log the expiration
    await serverActivityLog(db, serverId, 'Server Expired', {
      lastRenewal: renewalData.lastRenewal,
      renewalCount: renewalData.renewalCount
    });
  } catch (error) {
    console.error(`Error handling expired server ${serverId}:`, error);
  }
}

// Add these routes to the router
router.get('/server/:id/renewal/status', authMiddleware, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const renewalStatus = await getRenewalStatus(db, serverId, req.session.userinfo.id);
    
    // Calculate time remaining
    const now = new Date();
    const nextRenewal = new Date(renewalStatus.nextRenewal);
    const timeRemaining = nextRenewal - now;
    
    // Format the response
    const response = {
      ...renewalStatus,
      timeRemaining: {
        total: timeRemaining,
        hours: Math.floor(timeRemaining / (1000 * 60 * 60)),
        minutes: Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((timeRemaining % (1000 * 60)) / 1000)
      },
      requiresRenewal: timeRemaining <= WARNING_THRESHOLD_HOURS * 60 * 60 * 1000,
      isExpired: timeRemaining <= 0
    };
    
    res.json(response);
  } catch (error) {
    console.error('Error getting renewal status:', error);
    res.status(500).json({ error: 'Failed to get renewal status' });
  }
});

// And update the renewal endpoint validation in the POST route:
router.post('/server/:id/renewal/renew', authMiddleware, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const currentStatus = await getRenewalStatus(db, serverId);
    
    // Check if renewal is actually needed
    const now = new Date();
    const nextRenewal = new Date(currentStatus.nextRenewal);
    const timeRemaining = nextRenewal - now;
    
    // Allow renewal if less than 24 hours remaining or expired
    if (timeRemaining > WARNING_THRESHOLD_HOURS * 60 * 60 * 1000) {
      return res.status(400).json({
        error: 'Renewal not required yet',
        nextRenewal: currentStatus.nextRenewal,
        timeRemaining: {
          hours: Math.floor(timeRemaining / (1000 * 60 * 60)),
          minutes: Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))
        }
      });
    }
    
    // Process the renewal
    const renewalData = await renewServer(db, serverId);
    
    // If server was stopped due to expiration, restart it
    if (!currentStatus.isActive) {
      await executePowerAction(serverId, 'start');
    }
    
    res.json({
      message: 'Server renewed successfully',
      renewalData
    });
  } catch (error) {
    console.error('Error renewing server:', error);
    res.status(500).json({ error: 'Failed to renew server' });
  }
});


// Initialize the renewal system when the module loads
initializeRenewalSystem(db);
};

function scheduleWorkflowExecution(instanceId, workflow) {
  const blocks = workflow.blocks;
  const intervalBlock = blocks.find((block) => block.type === "interval");

  if (intervalBlock) {
    const intervalMinutes = parseInt(intervalBlock.meta.selectedValue, 10);
    const rule = new schedule.RecurrenceRule();
    rule.minute = new schedule.Range(0, 59, intervalMinutes);

    const jobId = `job_${instanceId}`;

    const nextExecution = schedule.scheduleJob(jobId, rule, () => {
      executeWorkflow(instanceId);
      saveScheduledWorkflows();
    });

    logCountdownToNextExecution(nextExecution, intervalMinutes);
    setInterval(() => checkWorkflowValidity(instanceId, nextExecution), 5000);
  }
}

function saveScheduledWorkflows() {
  try {
    const scheduledWorkflows = {};

    for (const job of Object.values(schedule.scheduledJobs)) {
      if (job.name.startsWith("job_")) {
        const instanceId = job.name.split("_")[1];
        scheduledWorkflows[instanceId] = job.nextInvocation();
      }
    }

    fs.writeFileSync(
      scheduledWorkflowsFilePath,
      JSON.stringify(scheduledWorkflows, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Error saving scheduled workflows:", error);
  }
}

function logCountdownToNextExecution(scheduledJob, intervalMinutes) {
  const logInterval = setInterval(() => {
    const now = new Date();
    const nextDate = new Date(scheduledJob.nextInvocation());

    if (!isNaN(nextDate.getTime())) {
      const timeDiffMs = nextDate - now;
      const totalSecondsRemaining = Math.ceil(timeDiffMs / 1000);

      const minutesRemaining = Math.floor(totalSecondsRemaining / 60);
      const secondsRemaining = totalSecondsRemaining % 60;

      if (timeDiffMs > 0) {
        // Idk
      } else {
        clearInterval(logInterval);
      }
    } else {
      console.error(
        "Invalid next execution time. Cannot calculate remaining time."
      );
      clearInterval(logInterval);
    }
  }, 5000);
}

async function checkWorkflowValidity(instanceId, scheduledJob) {
  const workflow = loadWorkflowFromFile(instanceId);
  if (!workflow) {
    scheduledJob.cancel();
  }
}

function executeWorkflow(instanceId) {
  const workflow = loadWorkflowFromFile(instanceId);

  if (workflow) {
    const blocks = workflow.blocks;

    blocks
      .filter((block) => block.type === "power")
      .forEach((block) => {
        executePowerAction(instanceId, block.meta.selectedValue).then(
          (success) => {
            if (success) {
              const webhookBlock = blocks.find((b) => b.type === "webhook");
              if (webhookBlock) {
                sendWebhookNotification(
                  webhookBlock.meta.inputValue,
                  `Successfully executed power action: ${block.meta.selectedValue}`
                );
              }
            }
          }
        );
      });
  } else {
    console.error(`No workflow found for instance ${instanceId}`);
  }
}

async function executePowerAction(instanceId, powerAction) {
  try {
    const validActions = ['start', 'stop', 'restart', 'kill'];
    if (!validActions.includes(powerAction)) {
      throw new Error(`Invalid power action: ${powerAction}`);
    }

    const response = await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${instanceId}/power`,
      { signal: powerAction },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
        },
      }
    );

    if (response.status === 204) {
      console.log(`Successfully executed power action: ${powerAction} for server ${instanceId}`);
      return true;
    } else {
      console.error(`Unexpected response status: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.error(`Error executing power action for server ${instanceId}:`, error.message);
    return false;
  }
}

async function sendWebhookNotification(webhookUrl, message) {
  try {
    await axios.post(webhookUrl, {
      content: message,
    });
  } catch (error) {
    console.error("Failed to send webhook notification:", error.message);
  }
}

function loadWorkflowFromFile(instanceId) {
  try {
    if (fs.existsSync(workflowsFilePath)) {
      const data = fs.readFileSync(workflowsFilePath, "utf8");
      const workflows = JSON.parse(data);
      return workflows[instanceId] || null;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error loading workflow from file:", error);
    return null;
  }
}
