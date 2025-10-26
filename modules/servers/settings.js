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
  "name": "Pterodactyl Settings Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const express = require('express');
const router = express.Router();
const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const WebSocket = require('ws');
const axios = require('axios');
const { requireAuth, ownsServer } = require("../../handlers/checkMiddleware.js");

module.exports.load = async function(app, db) {
    
    // PUT /api/server/:id/startup
    router.put('/server/:serverId/startup', requireAuth, async (req, res) => {
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
    
    // POST Reinstall server
    router.post('/api/server/:id/reinstall', requireAuth, ownsServer, async (req, res) => {
        try {
            const serverId = req.params.id;
            await axios.post(`${settings.pterodactyl.domain}/api/client/servers/${serverId}/settings/reinstall`, {}, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.pterodactyl.client_key}`
                }
            });
            res.status(204).send(); // No content response on success
        } catch (error) {
            console.error('Error reinstalling server:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    // POST Rename server
    router.post('/api/server/:id/rename', requireAuth, ownsServer, async (req, res) => {
        try {
            const serverId = req.params.id;
            const { name } = req.body; // Expecting the new name for the server in the request body

            await axios.post(`${settings.pterodactyl.domain}/api/client/servers/${serverId}/settings/rename`, 
            { name: name }, 
            {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.pterodactyl.client_key}`
                }
            });
            res.status(204).send(); // No content response on success
        } catch (error) {
            console.error('Error renaming server:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    });
};