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
  "name": "Transfer Server Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const axios = require("axios");
const loadConfig = require("../../handlers/config");
const settings = loadConfig("./config.toml");
const { requireAuth } = require("../../handlers/checkMiddleware");

module.exports.load = async function (app, db) {
  // Admin authentication data
  const COOKIE_VALUE = settings.pterodactyl.cookie_admin;
  const token = settings.pterodactyl.transfer_token;

  async function apiRequest(endpoint, method = "GET", data = null, isAdmin = false) {
    try {
      const headers = isAdmin
        ? {
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": COOKIE_VALUE,
          }
        : {
            Authorization: `Bearer ${settings.pterodactyl.key}`,
            "Content-Type": "application/json",
            Accept: "Application/vnd.pterodactyl.v1+json",
          };

      const url = isAdmin
        ? `${settings.pterodactyl.domain}${endpoint}`
        : `${settings.pterodactyl.domain}/api/application${endpoint}`;

      const response = await axios({
        url,
        method,
        headers,
        data,
      });

      return response.data;
    } catch (error) {
      const msg = error.response?.data || error.message || "Unknown API error";
      throw new Error(`API request failed: ${JSON.stringify(msg)}`);
    }
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
    const payload = `node_id=${targetNodeId}&allocation_id=${allocationId}&_token=${token}`;
    await apiRequest(
      `/admin/servers/view/${serverId}/manage/transfer`,
      "POST",
      payload,
      true
    );
    console.log(`Transfer job added to queue for server ${serverId}`);
  }

  app.get("/api/servers/capacity/:node", requireAuth, async (req, res) => {
    const { node } = req.params;
    try {
      const allocations = await getAvailableAllocations(node);
      res.status(200).json({ availableAllocations: allocations.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/server/transfer", requireAuth, async (req, res) => {
    const { id, nodeId } = req.body;

    if (!id || !nodeId) {
      return res.status(400).json({ error: "Missing required parameters: id or nodeId" });
    }

    try {
      const availableAllocations = await getAvailableAllocations(nodeId);

      if (availableAllocations.length === 0) {
        return res.status(500).json({ error: "No available allocations on the target node" });
      }

      await transferServer(id, availableAllocations[0].attributes.id, nodeId);

      res.status(200).json({
        message: `Transfer for server ${id} to node ${nodeId} initiated.`,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};