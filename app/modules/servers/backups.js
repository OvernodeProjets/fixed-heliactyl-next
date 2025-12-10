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
  "name": "Backups Server Module",
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

  // GET /api/server/:id/backups
  router.get(
    "/server/:id/backups",
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const data = await ClientAPI.request('GET', `/api/client/servers/${serverId}/backups`);
        res.json(data);
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
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const data = await ClientAPI.request('POST', `/api/client/servers/${serverId}/backups`);
        res.status(201).json(data);
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
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const backupId = req.params.backupId;
        const data = await ClientAPI.request('GET', `/api/client/servers/${serverId}/backups/${backupId}/download`);
        res.json(data);
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
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const backupId = req.params.backupId;
        await ClientAPI.request('DELETE', `/api/client/servers/${serverId}/backups/${backupId}`);
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting backup:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );
};