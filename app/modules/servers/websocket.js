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
const { getConnectionManager } = require("../../handlers/WebSocketConnectionManager.js");

module.exports.load = async function(router, db) {
  const ClientAPI = getClientAPI();
  const connectionManager = getConnectionManager(settings.pterodactyl.domain, settings.pterodactyl.client_key);
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);

  // WebSocket proxy endpoint - persistent connection through server
  router.ws(
    "/server/:id/ws",
    async (ws, req) => {
      // Authentication check
      if (!req.session || !req.session.userinfo) {
        ws.close(4001, 'Unauthorized');
        return;
      }

      const serverId = req.params.id;
      const userId = req.session.userinfo.id;

      try {
        // Check server ownership (simplified check)
        const pterodactylId = await db.get("users-" + userId);
        if (!pterodactylId) {
          ws.close(4001, 'Unauthorized');
          return;
        }

        // Check if server is suspended
        let serverDetails;
        try {
          serverDetails = await ClientAPI.getServerDetails(serverId);
          if (!serverDetails || serverDetails.attributes.is_suspended) {
            ws.close(4003, 'Server is suspended');
            return;
          }
        } catch (error) {
          console.error("[WS Proxy] Error checking server:", error.message);
          ws.close(4000, 'Server check failed');
          return;
        }

        // Get or create persistent connection to Pterodactyl
        const connection = await connectionManager.getOrCreateConnection(serverId);
        
        // Register this client
        connectionManager.addClient(serverId, ws);
        console.log(`[WS Proxy] Client ${userId} connected to server ${serverId}`);

        // Forward messages from client to Pterodactyl
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            // Forward to Pterodactyl (except auth - handled by manager)
            if (message.event !== 'auth') {
              connectionManager.sendToPterodactyl(serverId, message);
            }
          } catch (error) {
            console.error("[WS Proxy] Error forwarding message:", error.message);
          }
        });

        // Handle client disconnect
        ws.on('close', () => {
          connectionManager.removeClient(serverId, ws);
          console.log(`[WS Proxy] Client ${userId} disconnected from server ${serverId}`);
        });

        ws.on('error', (error) => {
          console.error(`[WS Proxy] Client error for server ${serverId}:`, error.message);
          connectionManager.removeClient(serverId, ws);
        });

      } catch (error) {
        console.error("[WS Proxy] Error establishing connection:", error.message);
        ws.close(4000, 'Connection failed');
      }
    }
  );

  // GET WebSocket connection manager stats (for debugging)
  router.get(
    "/ws/stats",
    authMiddleware,
    async (req, res) => {
      // Only allow admins to see stats
      if (!req.session.userinfo?.root_admin) {
        return res.status(403).json({ error: "Forbidden" });
      }
      res.json(connectionManager.getStats());
    }
  );

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