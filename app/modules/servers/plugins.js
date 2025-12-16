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
  "name": "Plugins Server Module",
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

  router.post(
    "/plugins/install/:id",
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      const { id: serverId } = req.params;
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

};