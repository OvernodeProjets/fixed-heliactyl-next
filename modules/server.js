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

const express = require("express");
const PterodactylClientModule = require("../handlers/Client.js");
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const WebSocket = require("ws");
const axios = require("axios");
const FormData = require("form-data");
const path = require("path");
const fs = require("fs");
const schedule = require("node-schedule");

const workflowsFilePath = path.join(__dirname, "../storage/workflows.json");
const scheduledWorkflowsFilePath = path.join(
  __dirname,
  "../storage/scheduledWorkflows.json"
);
module.exports.load = async function (app, db) {

async function logActivity(db, serverId, action, details) {
  const timestamp = new Date().toISOString();
  const activityLog = await db.get(`activity_log_${serverId}`) || [];
  
  activityLog.unshift({ timestamp, action, details });
  
  // Keep only the last 100 activities
  if (activityLog.length > 100) {
    activityLog.pop();
  }
  
  await db.set(`activity_log_${serverId}`, activityLog);
}

  // TRANSFER

  const ADMIN_COOKIES = "pterodactyl_session=eyJpdiI6ImpZclJJa1hKeFNWbmxhRGhWbUMvcXc9PSIsInZhbHVlIjoib1huRWVheGpGdjhWZ3VSUmxHTE5xNTRuY0RPcm5UaHIvaG95aitHLy9kM3FpdlJ5ODUrU0lRdGlNd0l0WTVicWNPcXA2eXc4RHQ2eGFaQVlycDZXU1orTFFUdmtyd1huQ3Z0K1ZQWDZPdzQ2ZXdEU2dWUlEvU3Bpc3lvMWZneXMiLCJtYWMiOiJmZDJmZGFkODc3MjMzMmVkNjJkZTExYTQ0OWVmNDVkOWZmYmU4Yjc3ZDhmZWU4N2E3NTExOWIwMTY1NDA4M2MxIiwidGFnIjoiIn0%3D"
  const CSRF_TOKEN = "";

  async function apiRequest(endpoint, method = "GET", body = null) {
    const response = await fetch(`${settings.pterodactyl.domain}/api/application${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${settings.pterodactyl.key}`,
        "Content-Type": "application/json",
        Accept: "Application/vnd.pterodactyl.v1+json",
      },
      body: body ? JSON.stringify(body) : null,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${await response.text()}`);
    }

    return response.json();
  }

  async function getAvailableAllocations(nodeId) {
    const response = await apiRequest(
      `/nodes/${nodeId}/allocations?per_page=10000`
    );
    return response.data.filter(
      (allocation) => !allocation.attributes.assigned
    );
  }

  async function transferServer(serverId, allocationId, targetNodeId) {
    return fetch(
      `${settings.pterodactyl.domain}/admin/servers/view/${serverId}/manage/transfer`,
      {
        method: "POST",
        headers: {
          Cookie: ADMIN_COOKIES,
          "X-CSRF-TOKEN": CSRF_TOKEN,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `node_id=${targetNodeId}&allocation_id=${allocationId}`,
      }
    )
      .then((response) => {
        if (response.ok) {
          console.log(`Transfer job added to queue for server ${serverId}`);
        } else {
          console.error(
            `Failed to transfer server ${serverId}: ${response.statusText}`
          );
        }
      })
      .catch((error) => {
        console.error(`Error transferring server ${serverId}:`, error.message);
      });
  }

  app.get("/api/server/transfer", async (req, res) => {
    const { id, nodeId } = req.query;

    if (!id || !nodeId) {
      return res
        .status(400)
        .json({ error: "Missing required parameters: id or nodeId" });
    }

    try {
      // Get available allocations for the target node
      const availableAllocations = await getAvailableAllocations(nodeId);

      if (availableAllocations.length === 0) {
        return res
          .status(500)
          .json({ error: "No available allocations on the target node" });
      }

      // Transfer the server to the target node using the first available allocation
      await transferServer(id, availableAllocations[0].attributes.id, nodeId);

      res.status(200).json({
        message: `Transfer for server ${id} to node ${nodeId} initiated.`,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  const router = express.Router();
  const pterodactylClient = new PterodactylClientModule(
    settings.pterodactyl.domain,
    settings.pterodactyl.client_key
  );

  // Middleware to check if user is authenticated
  const isAuthenticated = (req, res, next) => {
    if (req.session.pterodactyl) {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  };

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

// Helper function to get Pterodactyl user ID
async function getPterodactylUserId(userId) {
  const user = await db.get(`users-${userId}`);
  return user ? user.pterodactyl_id : null;
}

// Create a team
router.post('/teams', isAuthenticated, async (req, res) => {
  try {
    const { name } = req.body;
    const ownerId = req.session.userinfo.id;

    const teamId = Date.now().toString(); // Simple unique ID generation
    const team = {
      id: teamId,
      name,
      owner: ownerId,
      members: [ownerId],
      servers: []
    };

    await db.set(`team-${teamId}`, team);
    res.status(201).json({ success: true, teamId });
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add member to team
router.post('/teams/:teamId/members', isAuthenticated, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { userId } = req.body;
    const team = await db.get(`team-${teamId}`);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (team.owner !== req.session.userinfo.id) {
      return res.status(403).json({ error: 'Only team owner can add members' });
    }

    const pterodactylUserId = await getPterodactylUserId(userId);
    if (!pterodactylUserId) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!team.members.includes(userId)) {
      team.members.push(userId);
      await db.set(`team-${teamId}`, team);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error adding team member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove member from team
router.delete('/teams/:teamId/members/:userId', isAuthenticated, async (req, res) => {
  try {
    const { teamId, userId } = req.params;
    const team = await db.get(`team-${teamId}`);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (team.owner !== req.session.userinfo.id) {
      return res.status(403).json({ error: 'Only team owner can remove members' });
    }

    team.members = team.members.filter(memberId => memberId !== userId);
    await db.set(`team-${teamId}`, team);

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing team member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add server to team
router.post('/teams/:teamId/servers', isAuthenticated, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { serverId } = req.body;
    const team = await db.get(`team-${teamId}`);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (!team.members.includes(req.session.userinfo.id)) {
      return res.status(403).json({ error: 'You are not a member of this team' });
    }

    if (!team.servers.includes(serverId)) {
      team.servers.push(serverId);
      await db.set(`team-${teamId}`, team);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error adding server to team:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove server from team
router.delete('/teams/:teamId/servers/:serverId', isAuthenticated, async (req, res) => {
  try {
    const { teamId, serverId } = req.params;
    const team = await db.get(`team-${teamId}`);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (!team.members.includes(req.session.userinfo.id)) {
      return res.status(403).json({ error: 'You are not a member of this team' });
    }

    team.servers = team.servers.filter(id => id !== serverId);
    await db.set(`team-${teamId}`, team);

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing server from team:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List accessible servers from all teams
router.get('/teams/servers', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userinfo.id;
    const teamKeys = await listKeys('team-');
    const accessibleServers = [];

    for (const teamKey of teamKeys) {
      const team = await db.get(teamKey);
      if (team.members.includes(userId)) {
        for (const serverId of team.servers) {
          const serverDetails = await pterodactylClient.getServerDetails(serverId);
          accessibleServers.push({
            name: serverDetails.name,
            identifier: serverDetails.identifier
          });
        }
      }
    }

    res.json(accessibleServers);
  } catch (error) {
    console.error('Error listing accessible servers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit team settings
router.put('/teams/:teamId', isAuthenticated, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { name } = req.body;
    const team = await db.get(`team-${teamId}`);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (team.owner !== req.session.userinfo.id) {
      return res.status(403).json({ error: 'Only team owner can edit team settings' });
    }

    team.name = name;
    await db.set(`team-${teamId}`, team);

    res.json({ success: true });
  } catch (error) {
    console.error('Error editing team settings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete team
router.delete('/teams/:teamId', isAuthenticated, async (req, res) => {
  try {
    const { teamId } = req.params;
    const team = await db.get(`team-${teamId}`);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (team.owner !== req.session.userinfo.id) {
      return res.status(403).json({ error: 'Only team owner can delete the team' });
    }

    if (team.servers.length > 0) {
      return res.status(400).json({ error: 'Cannot delete team with servers. Remove all servers first.' });
    }

    await db.delete(`team-${teamId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting team:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List user's teams
router.get('/teams', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userinfo.id;
    const teamKeys = await listKeys('team-');
    const userTeams = [];

    for (const teamKey of teamKeys) {
      const team = await db.get(teamKey);
      if (team.members.includes(userId)) {
        // Fetch detailed information for each member
        const memberDetails = await Promise.all(team.members.map(async (memberId) => {
          const user = await db.get(`users-${memberId}`);
          return {
            id: memberId,
            username: user ? user.username : 'Unknown',
            email: user ? user.email : 'Unknown',
            isOwner: memberId === team.owner
          };
        }));

        // Fetch server details
        const serverDetails = await Promise.all(team.servers.map(async (serverId) => {
          try {
            const serverInfo = await pterodactylClient.getServerDetails(serverId);
            return {
              id: serverId,
              name: serverInfo.attributes.name,
              identifier: serverInfo.attributes.identifier,
              node: serverInfo.attributes.node,
              status: serverInfo.attributes.status
            };
          } catch (error) {
            console.error(`Error fetching details for server ${serverId}:`, error);
            return {
              id: serverId,
              name: 'Unknown',
              identifier: 'Unknown',
              node: 'Unknown',
              status: 'Unknown'
            };
          }
        }));

        userTeams.push({
          id: team.id,
          name: team.name,
          owner: team.owner,
          isOwner: team.owner === userId,
          members: memberDetails,
          servers: serverDetails
        });
      }
    }

    res.json(userTeams);
  } catch (error) {
    console.error('Error listing user teams:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const ownsServer = async (req, res, next) => {
  const serverId = req.params.id || req.params.serverId || req.params.instanceId;
  const userId = req.session.pterodactyl.username;
  console.log(`Checking server access for user ${userId} and server ${serverId}`);
  
  const userServers = req.session.pterodactyl.relationships.servers.data;
  const serverOwned = userServers.some(server => server.attributes.identifier === serverId);

  if (serverOwned) {
    console.log(`User ${userId} owns server ${serverId}`);
    return next();
  }

  // Check if the user is a subuser of the server
  try {
    const subuserServers = await db.get(`subuser-servers-${userId}`) || [];
    const hasAccess = subuserServers.some(server => server.id === serverId);
    if (hasAccess) {
      console.log(`User ${userId} is a subuser of server ${serverId}`);
      return next();
    }
  } catch (error) {
    console.error('Error checking subuser status:', error);
  }

  console.log(`User ${userId} does not have access to server ${serverId}`);
  res.status(403).json({ error: 'Forbidden.' });
};
// Helper function to get world type (default, nether, end, or custom)
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
router.get('/server/:id/worlds', isAuthenticated, ownsServer, async (req, res) => {
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

router.post('/server/:id/worlds/import', isAuthenticated, ownsServer, async (req, res) => {
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

router.post('/server/:id/worlds/import/complete', isAuthenticated, ownsServer, async (req, res) => {
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

    await logActivity(db, serverId, 'Import World', { worldName });
    res.json({ success: true });
  } catch (error) {
    console.error('Error completing world import:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/server/:id/worlds/:worldName', isAuthenticated, ownsServer, async (req, res) => {
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

    await logActivity(db, serverId, 'Delete World', { worldName });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting world:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/server/:id/startup
router.put('/server/:serverId/startup', isAuthenticated, async (req, res) => {
  try {
    const serverId = req.params.serverId;
    const { startup, environment, egg, image, skip_scripts } = req.body;

    // First, get the current server details
    const serverDetailsResponse = await axios.get(
      `${settings.pterodactyl.domain}/api/application/servers/${serverId}?include=container`,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    const currentServerDetails = serverDetailsResponse.data.attributes;
    console.log(JSON.stringify(currentServerDetails))

    // Prepare the update payload
    const updatePayload = {
      startup: startup || currentServerDetails.container.startup_command,
      environment: environment || currentServerDetails.container.environment,
      egg: egg || currentServerDetails.egg,
      image: image || currentServerDetails.container.image,
      skip_scripts: skip_scripts !== undefined ? skip_scripts : false,
    };

    // Send the update request
    const response = await axios.patch(
      `${settings.pterodactyl.domain}/api/application/servers/${serverId}/startup`,
      updatePayload,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.key}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error updating server startup:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/server/:id/allocations - Assign new allocation
router.post('/server/:id/allocations', isAuthenticated, ownsServer, async (req, res) => {
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

// Helper function to manage WebSocket connections
async function withServerWebSocket(serverId, callback) {
  let ws = null;
  try {
    // Get WebSocket credentials
    const credsResponse = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/websocket`,
      {
        headers: {
          'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
          'Accept': 'application/json',
        },
      }
    );

    const { socket, token } = credsResponse.data.data;

    // Connect to WebSocket
    return new Promise((resolve, reject) => {
      ws = new WebSocket(socket);
      const timeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
        reject(new Error('WebSocket operation timed out'));
      }, 10000); // 10 second timeout

      let consoleBuffer = [];
      let authenticated = false;

      ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      ws.on('open', () => {
        console.log('WebSocket connection established');
        // Authenticate
        ws.send(JSON.stringify({
          event: "auth",
          args: [token]
        }));
      });

      ws.on('message', async (data) => {
        const message = JSON.parse(data.toString());

        if (message.event === 'auth success') {
          authenticated = true;
          try {
            await callback(ws, consoleBuffer);
            clearTimeout(timeout);
            resolve();
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        }
        else if (message.event === 'console output') {
          consoleBuffer.push(message.args[0]);
        }
        else if (message.event === 'token expiring') {
          // Get new token
          const newCredsResponse = await axios.get(
            `${settings.pterodactyl.domain}/api/client/servers/${serverId}/websocket`,
            {
              headers: {
                'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
                'Accept': 'application/json',
              },
            }
          );
          // Send new token
          ws.send(JSON.stringify({
            event: "auth",
            args: [newCredsResponse.data.data.token]
          }));
        }
      });

      ws.on('close', () => {
        if (!authenticated) {
          clearTimeout(timeout);
          reject(new Error('WebSocket closed before authentication'));
        }
      });
    });
  } catch (error) {
    console.error(`WebSocket error for server ${serverId}:`, error);
    throw error;
  } finally {
    // Only close if the connection was established
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
}

// Helper to send command and wait for response
async function sendCommandAndGetResponse(serverId, command, responseTimeout = 5000) {
  return withServerWebSocket(serverId, async (ws, consoleBuffer) => {
    return new Promise((resolve) => {
      // Clear existing buffer
      consoleBuffer.length = 0;

      // Send command
      ws.send(JSON.stringify({
        event: "send command",
        args: [command]
      }));

      // Wait for response
      setTimeout(() => {
        resolve([...consoleBuffer]); // Return a copy of the buffer
      }, responseTimeout);
    });
  });
}

// Players endpoints
router.get('/server/:id/players', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    
    const consoleLines = await sendCommandAndGetResponse(serverId, 'list');
    
    // Parse player list from console output
    if (!consoleLines || consoleLines.length === 0) {
      return res.json({ players: [] });
    }
    const playerListLine = consoleLines.find(line => line.includes('players online:'));
    let players = [];
    
    if (playerListLine) {
      const match = playerListLine.match(/There are \d+ of a max of \d+ players online: (.*)/);
      if (match && match[1]) {
        players = match[1].split(',').map(p => p.trim()).filter(p => p);
      }
    }

    res.json({ players });
  } catch (error) {
    console.error('Error getting player list:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/server/:id/logs - Get server activity logs
router.get('/server/:id/logs', isAuthenticated, ownsServer, async (req, res) => {
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

router.post('/server/:id/players/:player/kick', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const { id: serverId, player } = req.params;
    const { reason = 'You have been kicked from the server' } = req.body;

    await sendCommandAndGetResponse(serverId, `kick ${player} ${reason}`, 2000);
    await logActivity(db, serverId, 'Kick Player', { player, reason });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error kicking player:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/server/:id/players/:player/ban', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const { id: serverId, player } = req.params;
    const { reason = 'You have been banned from the server' } = req.body;

    await sendCommandAndGetResponse(serverId, `ban ${player} ${reason}`, 2000);
    await logActivity(db, serverId, 'Ban Player', { player, reason });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error banning player:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/server/:id/players/:player/unban', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const { id: serverId, player } = req.params;

    await sendCommandAndGetResponse(serverId, `pardon ${player}`, 2000);
    await logActivity(db, serverId, 'Unban Player', { player });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error unbanning player:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/server/:id/players/banned', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const consoleLines = await sendCommandAndGetResponse(serverId, 'banlist');
    
    // Parse banned players from console output
    const bannedPlayers = [];
    let collectingBans = false;

    if(!consoleLines || consoleLines.length === 0) {
      return res.json({ bannedPlayers: [] });
    }
    
    for (const line of consoleLines) {
      if (line.includes('Banned players:')) {
        collectingBans = true;
        continue;
      }
      
      if (collectingBans && line.trim()) {
        const players = line.split(',').map(p => p.trim()).filter(p => p);
        bannedPlayers.push(...players);
      }
    }

    res.json({ bannedPlayers });
  } catch (error) {
    console.error('Error getting banned players:', error);
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
    isAuthenticated,
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
    isAuthenticated,
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
    isAuthenticated,
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
    isAuthenticated,
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
    isAuthenticated,
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

  // GET /api/server/:id/files/download
router.get('/server/:id/files/download', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const file = req.query.file;
    
    if (!file) {
      return res.status(400).json({ error: 'File parameter is required' });
    }

    const response = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/download`,
      {
        params: { file },
        headers: {
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error generating download link:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // GET workflow
  router.get(
    "/server/:id/workflow",
    isAuthenticated,
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
router.get('/server/:id/variables', isAuthenticated, ownsServer, async (req, res) => {
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
router.put('/server/:id/variables', isAuthenticated, ownsServer, async (req, res) => {
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

// POST /api/server/:id/files/copy
router.post('/server/:id/files/copy', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const { location } = req.body;

    if (!location) {
      return res.status(400).json({ error: 'Missing location' });
    }

    await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/copy`,
      { location },
      {
        headers: {
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    res.status(204).send();
  } catch (error) {
    console.error('Error copying file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // POST save workflow
  router.post(
    "/server/:instanceId/workflow/save-workflow",
    isAuthenticated,
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

    await logActivity(db, instanceId, 'Save Workflow', { workflowDetails: workflow });

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
router.get('/subuser-servers', isAuthenticated, async (req, res) => {
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
    for (const userId of allUsers) {
      let userSubuserServers = await db.get(`subuser-servers-${userId}`) || [];
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

router.post('/sync-user-servers', isAuthenticated, async (req, res) => {
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
router.get('/server/:id/users', isAuthenticated, ownsServer, async (req, res) => {
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

router.post('/server/:id/users', isAuthenticated, ownsServer, async (req, res) => {
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
  router.delete('/server/:id/users/:subuser', isAuthenticated, ownsServer, async (req, res) => {
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

  // GET server details
  router.get("/server/:id", isAuthenticated, ownsServer, async (req, res) => {
    try {
      const serverId = req.params.id;
      const serverDetails = await pterodactylClient.getServerDetails(serverId);
      res.json(serverDetails);
    } catch (error) {
      console.error("Error fetching server details:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET WebSocket credentials
  router.get(
    "/server/:id/websocket",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const wsCredentials = await pterodactylClient.getWebSocketCredentials(
          serverId
        );
        res.json(wsCredentials);
      } catch (error) {
        console.error("Error fetching WebSocket credentials:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST Send command to server
  router.post(
    "/server/:id/command",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { command } = req.body;
        await pterodactylClient.sendCommand(serverId, command);
        res.json({ success: true, message: "Command sent successfully" });
      } catch (error) {
        console.error("Error sending command:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST Set server power state
  router.post(
    "/server/:id/power",
    isAuthenticated,
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

  // GET /api/server/:id/files/list
router.get(
  "/server/:id/files/list",
  isAuthenticated,
  ownsServer,
  async (req, res) => {
    try {
      const serverId = req.params.id;
      const directory = req.query.directory || "/";
      const page = parseInt(req.query.page) || 1;
      const perPage = parseInt(req.query.per_page) || 10;

      const response = await axios.get(
        `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/list`,
        {
          params: { 
            directory,
            page: page,
            per_page: perPage
          },
          headers: {
            Authorization: `Bearer ${settings.pterodactyl.client_key}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      // Add pagination metadata to the response
      const totalItems = response.data.meta?.pagination?.total || 0;
      const totalPages = Math.ceil(totalItems / perPage);

      const paginatedResponse = {
        ...response.data,
        meta: {
          ...response.data.meta,
          pagination: {
            ...response.data.meta?.pagination,
            current_page: page,
            per_page: perPage,
            total_pages: totalPages
          }
        }
      };

      res.json(paginatedResponse);
    } catch (error) {
      console.error("Error listing files:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

  /// GET /api/server/:id/files/contents
  router.get(
    "/server/:id/files/contents",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const file = encodeURIComponent(req.query.file); // URL-encode the file path
        const response = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/contents?file=${file}`,
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            responseType: "text", // Treat the response as plain text
          }
        );

        // Log the raw content for debugging

        // Send the raw file content back to the client
        res.send(response.data);
      } catch (error) {
        console.error("Error getting file contents:", error);

        // Optionally log the error response for more details
        if (error.response) {
          console.error("Error response data:", error.response.data);
        }

        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // GET /api/server/:id/files/download
  router.get(
    "/server/:id/files/download",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const file = req.query.file;
        const response = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/download`,
          {
            params: { file },
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.json(response.data);
      } catch (error) {
        console.error("Error getting download link:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/write
  router.post(
    "/server/:id/files/write",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const file = encodeURIComponent(req.query.file); // URL-encode the file path
        const content = req.body; // Expect the raw file content from the client

        const response = await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/write?file=${file}`,
          content, // Send the content as the raw body
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "text/plain", // Adjust based on your file type (e.g., 'text/yaml')
            },
          }
        );

    await logActivity(db, serverId, 'Write File', { file });

        res.status(204).send(); // No content response
      } catch (error) {
        console.error("Error writing file:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/compress
  router.post(
    "/server/:id/files/compress",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, files } = req.body;
        const response = await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/compress`,
          { root, files },
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.status(200).json(response.data);
      } catch (error) {
        console.error("Error compressing files:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/decompress
  router.post(
    "/server/:id/files/decompress",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, file } = req.body;
        await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/decompress`,
          { root, file },
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
        console.error("Error decompressing file:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/delete
  router.post(
    "/server/:id/files/delete",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, files } = req.body;
        await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/delete`,
          { root, files },
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
    await logActivity(db, serverId, 'Delete File', { root, files });
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting files:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // GET /api/server/:id/files/upload
  router.get(
    "/server/:id/files/upload",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const directory = req.query.directory || "/";
        const response = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/upload`,
          {
            params: { directory },
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.json(response.data);
      } catch (error) {
        console.error("Error getting upload URL:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/create-folder
  router.post(
    "/server/:id/files/create-folder",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, name } = req.body;
        await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/create-folder`,
          { root, name },
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
        console.error("Error creating folder:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/server/:id/files/rename
  router.put(
    "/server/:id/files/rename",
    isAuthenticated,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, files } = req.body;
        await axios.put(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/rename`,
          { root, files },
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
        console.error("Error renaming file/folder:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

// Add these constants at the top of the file
const RENEWAL_PERIOD_HOURS = 48;
const WARNING_THRESHOLD_HOURS = 24; // When to start showing warnings
const CHECK_INTERVAL_MINUTES = 5; // How often to check for expired servers

// Add this to the module.exports.load function
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
    await logActivity(db, serverId, 'Server Renewal', {
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
        await logActivity(db, serverId, 'Renewal Warning', {
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

    // Log the expiration
    await logActivity(db, serverId, 'Server Expired', {
      lastRenewal: renewalData.lastRenewal,
      renewalCount: renewalData.renewalCount
    });
  } catch (error) {
    console.error(`Error handling expired server ${serverId}:`, error);
  }
}

// Add these routes to the router
router.get('/server/:id/renewal/status', isAuthenticated, ownsServer, async (req, res) => {
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
router.post('/server/:id/renewal/renew', isAuthenticated, ownsServer, async (req, res) => {
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

const DOMAINS = {
  PRIMARY: {
    domain: "fractal.limited",
    zoneId: "e1002b67310e71a640f23209f24a1b80"
  },
  LEGACY: {
    domain: "frac.gg",
    zoneId: "9e9277f405ea2a4c600b7d740da9c588"
  }
};

const CF_API_TOKEN = "-aoLhgkgf9vA2BwN0s6CdwrNmTubMmgX4C_NbA4j";
const CF_API_URL = "https://api.cloudflare.com/client/v4";
// Helper function to format SRV record name for Cloudflare
function formatSRVRecord(subdomain) {
  // Now includes service and protocol in the name field
  return `_minecraft._tcp.${subdomain}`;
}
// Helper function to check if subdomain exists across both domains
async function checkSubdomainExists(subdomain) {
  try {
    // Check both domains
    const [primaryExists, legacyExists] = await Promise.all([
      checkDomainExists(subdomain, DOMAINS.PRIMARY),
      checkDomainExists(subdomain, DOMAINS.LEGACY)
    ]);

    return primaryExists || legacyExists;
  } catch (error) {
    console.error('Error checking subdomain:', error);
    throw error;
  }
}

async function checkDomainExists(subdomain, domainConfig) {
  const response = await axios.get(
    `${CF_API_URL}/zones/${domainConfig.zoneId}/dns_records`,
    {
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      params: {
        name: `${formatSRVRecord(subdomain)}.${domainConfig.domain}`
      }
    }
  );
  
  return response.data.success && response.data.result.length > 0;
}

// Updated function to get server's existing subdomains
async function getServerSubdomains(serverId) {
  try {
    const subdomains = await db.get(`subdomains-${serverId}`) || [];
    const verifiedSubdomains = [];

    for (const subdomain of subdomains) {
      try {
        // Check if the subdomain exists in either domain
        const exists = await checkSubdomainExists(subdomain.name);
        if (exists) {
          verifiedSubdomains.push({
            ...subdomain,
            domain: subdomain.domain || DOMAINS.LEGACY.domain // Support legacy entries
          });
        }
      } catch (error) {
        console.error(`Error verifying subdomain ${subdomain.name}:`, error);
      }
    }

    if (verifiedSubdomains.length !== subdomains.length) {
      await db.set(`subdomains-${serverId}`, verifiedSubdomains);
    }

    return verifiedSubdomains;
  } catch (error) {
    console.error('Error getting server subdomains:', error);
    throw error;
  }
}

// Updated function to create DNS record
async function createDNSRecord(serverId, subdomain, serverDetails) {
  const allocation = serverDetails.attributes.relationships.allocations.data[0].attributes;
  const port = allocation.port;
  const nodeSubdomain = allocation.ip_alias;

  // Create SRV record using Cloudflare API
  const response = await axios.post(
    `${CF_API_URL}/zones/${DOMAINS.PRIMARY.zoneId}/dns_records`,
    {
      name: formatSRVRecord(subdomain),
      type: "SRV",
      comment: "Minecraft server subdomain",
      tags: [],
      ttl: 1,
      proxied: false,
      data: {
        port: port,
        weight: 10,
        priority: 10,
        target: nodeSubdomain
      },
      settings: {}
    },
    {
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.data.success) {
    throw new Error('Failed to create DNS record');
  }

  return {
    recordId: response.data.result.id,
    domain: DOMAINS.PRIMARY.domain
  };
}

// Updated router endpoints
router.post('/server/:id/subdomains', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const { subdomain } = req.body;
    
    if (!subdomain || !/^[a-z0-9-]+$/i.test(subdomain)) {
      return res.status(400).json({ error: 'Invalid subdomain format' });
    }

    const existingSubdomains = await getServerSubdomains(serverId);
    if (existingSubdomains.length >= 2) {
      return res.status(400).json({ error: 'Maximum number of subdomains (2) reached' });
    }

    if (await checkSubdomainExists(subdomain)) {
      return res.status(400).json({ error: 'Subdomain already exists' });
    }

    const serverDetails = await pterodactylClient.getServerDetails(serverId);
    const { recordId, domain } = await createDNSRecord(serverId, subdomain, serverDetails);

    const newSubdomain = {
      name: subdomain,
      recordId: recordId,
      domain: domain,
      createdAt: new Date().toISOString()
    };
    
    existingSubdomains.push(newSubdomain);
    await db.set(`subdomains-${serverId}`, existingSubdomains);
    await logActivity(db, serverId, 'Create Subdomain', { subdomain, domain });
    
    res.status(201).json({
      message: 'Subdomain created successfully',
      subdomain: newSubdomain
    });
  } catch (error) {
    console.error('Error creating subdomain:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/server/:id/subdomains', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const subdomains = await getServerSubdomains(serverId);
    
    res.json({ subdomains });
  } catch (error) {
    console.error('Error listing subdomains:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/server/:id/subdomains/:subdomain', isAuthenticated, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const subdomainToDelete = req.params.subdomain;

    const subdomains = await getServerSubdomains(serverId);
    const subdomain = subdomains.find(s => s.name === subdomainToDelete);

    if (!subdomain) {
      return res.status(404).json({ error: 'Subdomain not found' });
    }

    const zoneId = subdomain.domain === DOMAINS.PRIMARY.domain ? 
      DOMAINS.PRIMARY.zoneId : 
      DOMAINS.LEGACY.zoneId;

    const response = await axios.delete(
      `${CF_API_URL}/zones/${zoneId}/dns_records/${subdomain.recordId}`,
      {
        headers: {
          'Authorization': `Bearer ${CF_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.data.success) {
      throw new Error('Failed to delete DNS record');
    }

    const updatedSubdomains = subdomains.filter(s => s.name !== subdomainToDelete);
    await db.set(`subdomains-${serverId}`, updatedSubdomains);
    await logActivity(db, serverId, 'Delete Subdomain', { 
      subdomain: subdomainToDelete,
      domain: subdomain.domain 
    });
    
    res.json({ message: 'Subdomain deleted successfully' });
  } catch (error) {
    console.error('Error deleting subdomain:', error);
    res.status(500).json({ error: 'Failed to delete subdomain' });
  }
});

// Initialize the renewal system when the module loads
initializeRenewalSystem(db);

  // Use the router with the '/api' prefix
  app.use("/api", router);
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


// Additional methods for PterodactylClientModule (to be moved later)
PterodactylClientModule.prototype.getWebSocketCredentials = async function (
  serverId
) {
  try {
    const response = await axios.get(
      `${this.apiUrl}/api/client/servers/${serverId}/websocket`,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching WebSocket credentials:", error);
    throw error;
  }
};

PterodactylClientModule.prototype.sendCommand = async function (
  serverId,
  command
) {
  await this.connectWebSocket(serverId);
  this.sendToWebSocket("send command", [command]);
};

PterodactylClientModule.prototype.setPowerState = async function (
  serverId,
  state
) {
  await this.connectWebSocket(serverId);
  this.sendToWebSocket("set state", [state]);
};
