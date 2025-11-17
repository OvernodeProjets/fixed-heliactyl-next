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

  // GET WebSocket credentials
  router.get(
    "/server/:id/websocket",
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;

        try {
          let serverDetails = await ClientAPI.getServerDetails(
            serverId
          );
          if (serverDetails.attributes.is_suspended) {
            console.log(`Server ${serverId} is suspended. Denying WebSocket access.`);
            return res
              .status(403)
              .json({ error: "Server is suspended. Cannot connect to WebSocket.", status : "suspended" });
            }
        } catch (error) {
          console.error("Error fetching server details for suspension check:", error);
          return res.status(500).json({ error: "Internal server error" });
        }

        const wsCredentials = await ClientAPI.getWebSocketCredentials(
          serverId
        );
        res.json(wsCredentials);
      } catch (error) {
        console.error("Error fetching WebSocket credentials:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // GET server details
  router.get("/server/:id", authMiddleware, ownsServer(db), async (req, res) => {
    try {
      const serverId = req.params.id;
      const serverDetails = await ClientAPI.getServerDetails(serverId);

      try {
        let serverDetails = await ClientAPI.getServerDetails(
          serverId
        );
        if (serverDetails.attributes.is_suspended) {
          console.log(`Server ${serverId} is suspended. Denying WebSocket access.`);
          return res
            .status(403)
            .json({ error: "Server is suspended. Cannot connect to WebSocket.", status : "suspended" });
          }
      } catch (error) {
        console.error("Error fetching server details for suspension check:", error);
        return res.status(500).json({ error: "Internal server error" });
      }

      res.json(serverDetails);
    } catch (error) {
      console.error("Error fetching server details:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
};