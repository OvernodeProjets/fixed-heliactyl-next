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
  "name": "WebSocket Server Module",
  "target_platform": "latest"
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const { requireAuth, ownsServer } = require("../../handlers/checkMiddleware.js");
const { getClientAPI } = require("../../handlers/pterodactylSingleton.js");
const axios = require("axios");

module.exports.load = async function(router, db) {
  const ClientAPI = getClientAPI();
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);

  // POST /api/server/:id/allocations - Assign new allocation
  router.post('/server/:id/allocations', authMiddleware, ownsServer(db), async (req, res) => {
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
};