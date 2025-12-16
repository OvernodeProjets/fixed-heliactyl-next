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
  "name": "Users Server Module",
  "target_platform": "latest"
};

module.exports.heliactylModule = heliactylModule;

const axios = require("axios");
const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const { requireAuth, ownsServer } = require("../../handlers/checkMiddleware.js");
const { getClientAPI } = require("../../handlers/pterodactylSingleton.js");

module.exports.load = async function(router, db) {
  const ClientAPI = getClientAPI();
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);

  async function addUserToAllUsersList(userId) {
    let allUsers = await db.get('all_users') || [];
    if (!allUsers.includes(userId)) {
      allUsers.push(userId);
      await db.set('all_users', allUsers);
    }
  }

  async function getServerName(serverId) {
    try {
      const serverDetails = await ClientAPI.getServerDetails(serverId, false, false);
      if (serverDetails) {
        return serverDetails.attributes.name;
      }
      return 'Unknown Server';
    } catch (error) {
      console.error('Error fetching server name:', error);
      return 'Unknown Server';
    }
  }

  async function updateSubuserInfo(serverId, serverOwnerId) {
    try {
      console.log(`Updating subuser info for server ${serverId}`);
      const response = await ClientAPI.request('GET', `/api/client/servers/${serverId}/users`);
  
      const subusers = response.data.map(user => ({
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

  // Update the existing /server/:id/users endpoint to call updateSubuserInfo
  router.get('/server/:id/users', authMiddleware, ownsServer(db), async (req, res) => {
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

  router.post('/server/:id/users', authMiddleware, ownsServer(db), async (req, res) => {
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
  router.delete('/server/:id/users/:subuser', authMiddleware, ownsServer(db), async (req, res) => {
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

  // Add new endpoint to show servers where the user is a subuser
  router.get('/server/subuser-servers', authMiddleware, async (req, res) => {
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

  // /api/server/sync-user-servers - Sync User Servers
  router.post('/server/sync-user-servers', authMiddleware, async (req, res) => {
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
};
