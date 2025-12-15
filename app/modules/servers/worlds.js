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
  "name": "Worlds Server Module",
  "target_platform": "3.2.1-beta.1"
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const { requireAuth, ownsServer } = require("../../handlers/checkMiddleware.js");
const { getClientAPI } = require("../../handlers/pterodactylSingleton.js");


module.exports.load = async function(router, db) {
  const ClientAPI = getClientAPI();
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);

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
      const worldContents = await ClientAPI.request(
        'GET',
        `/api/client/servers/${serverId}/files/list`,
        null,
        { directory: `/${fileData.attributes.name}` }
      );
  
      // Check if level.dat exists in the directory
      return worldContents.data.some(file => 
        file.attributes.name === 'level.dat' && 
        !file.attributes.mimetype.startsWith('inode/')
      );
    } catch (error) {
      console.error(`Error checking if ${fileData.attributes.name} is a valid world:`, error);
      return false;
    }
  }
  
  
  // Worlds endpoints
  router.get('/server/:id/worlds', authMiddleware, ownsServer(db), async (req, res) => {
    try {
      const serverId = req.params.id;
      
      // Get server.properties to find level-name
      const serverPropsResponse = await ClientAPI.request(
        'GET',
        `/api/client/servers/${serverId}/files/contents`,
        null,
        { file: '/server.properties' },
        'text'
      );
  
      // Parse server.properties to get default world name
      const serverProps = serverPropsResponse
        .split('\n')
        .reduce((acc, line) => {
          const [key, value] = line.split('=');
          if (key && value) acc[key.trim()] = value.trim();
          return acc;
        }, {});
  
      const defaultWorld = serverProps['level-name'] || 'world';
  
      // List contents of root directory to find world folders
      // List contents of root directory to find world folders
      const response = await ClientAPI.request('GET', `/api/client/servers/${serverId}/files/list`);
  
      // Filter for world folders (using Promise.all since we're using async filter)
      const fl = await Promise.all(
        response.data.map(async (folder) => {
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
  
  router.post('/server/:id/worlds/import', authMiddleware, ownsServer(db), async (req, res) => {
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
      const uploadUrlResponse = await ClientAPI.request('GET', `/api/client/servers/${serverId}/files/upload`, null, { directory: '/temp' });
  
      // 2. Return the upload URL and needed headers for the client
      res.json({
        url: uploadUrlResponse.attributes.url,
        worldName: worldName
      });
  
    } catch (error) {
      console.error('Error preparing world import:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  router.post('/server/:id/worlds/import/complete', authMiddleware, ownsServer(db), async (req, res) => {
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
      // 2. Move zip to temp directory
      await ClientAPI.request('PUT', `/api/client/servers/${serverId}/files/rename`, { root: '/', files: [{ from: fileName, to: `temp/${fileName}` }] });
  
      // 3. Decompress the zip in temp directory
      // 3. Decompress the zip in temp directory
      await ClientAPI.request('POST', `/api/client/servers/${serverId}/files/decompress`, { root: '/temp', file: fileName });
  
      // 4. Delete the zip file
      // 4. Delete the zip file
      await ClientAPI.request('POST', `/api/client/servers/${serverId}/files/delete`, { root: '/temp', files: [fileName] });
  
      // 5. List contents of temp directory
      // 5. List contents of temp directory
      const tempContents = await ClientAPI.request('GET', `/api/client/servers/${serverId}/files/list`, null, { directory: '/temp' });
  
      // Create the final world directory
      // Create the final world directory
      await ClientAPI.request('POST', `/api/client/servers/${serverId}/files/create-folder`, { root: '/', name: worldName });
  
      // 6. Move files to final location
      const items = tempContents.data;
      if (items.length === 1 && items[0].attributes.mimetype === "inode/directory") {
        // If there's a single directory, move its contents
        const srcDirName = items[0].attributes.name;
        const srcContents = await ClientAPI.request('GET', `/api/client/servers/${serverId}/files/list`, null, { directory: `/temp/${srcDirName}` });
  
        // Move each file/folder from the source directory
        for (const item of srcContents.data) {
          await ClientAPI.request('PUT', `/api/client/servers/${serverId}/files/rename`, { 
            root: `/temp/${srcDirName}`, 
            files: [{ from: item.attributes.name, to: `../../${worldName}/${item.attributes.name}` }]
          });
        }
      } else {
        // Move all files directly
        for (const item of items) {
          await ClientAPI.request('PUT', `/api/client/servers/${serverId}/files/rename`, { 
            root: '/temp', 
            files: [{ from: item.attributes.name, to: `../${worldName}/${item.attributes.name}` }]
          });
        }
      }
  
      // 7. Clean up temp directory
      // 7. Clean up temp directory
      await ClientAPI.request('POST', `/api/client/servers/${serverId}/files/delete`, { root: '/', files: ['temp'] });
  
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
  
  router.delete('/server/:id/worlds/:worldName', authMiddleware, ownsServer(db), async (req, res) => {
    try {
      const { id: serverId, worldName } = req.params;
  
      // Get server.properties to check if trying to delete default world
      const serverPropsContent = await ClientAPI.request(
        'GET',
        `/api/client/servers/${serverId}/files/contents`,
        null,
        { file: '/server.properties' },
        'text'
      );
  
      const serverProps = serverPropsContent
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
      // Delete the world folder
      await ClientAPI.request('POST', `/api/client/servers/${serverId}/files/delete`, { root: '/', files: [worldName] });
  
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
};
