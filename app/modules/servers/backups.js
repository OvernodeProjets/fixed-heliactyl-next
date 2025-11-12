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
const PterodactylClientModule = require("../../handlers/ClientAPI.js");

module.exports.load = async function(router, db) {
  const ClientAPI = new PterodactylClientModule(settings.pterodactyl.domain, settings.pterodactyl.client_key);
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);

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
};