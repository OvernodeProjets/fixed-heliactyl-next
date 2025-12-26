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
  "name": "Transfer Server Module",
  "target_platform": "3.2.1-beta.1"
};

module.exports.heliactylModule = heliactylModule;

const axios = require("axios");
const loadConfig = require("../../handlers/config");
const settings = loadConfig("./config.toml");
const { requireAuth } = require("../../handlers/checkMiddleware");

module.exports.load = async function (router, db) {
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);
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

  async function getNodeCapacityInfo(nodeId) {
    const nodeResponse = await apiRequest(`/nodes/${nodeId}?include=servers`);
    const node = nodeResponse.attributes;
    
    let usedMemory = 0;
    let usedDisk = 0;
    if (nodeResponse.attributes.relationships?.servers?.data) {
      for (const server of nodeResponse.attributes.relationships.servers.data) {
        usedMemory += server.attributes.limits?.memory || 0;
        usedDisk += server.attributes.limits?.disk || 0;
      }
    }
    
    return {
      totalMemory: node.memory,
      usedMemory: usedMemory,
      freeMemory: node.memory - usedMemory,
      memoryOverallocation: node.memory_overallocate || 0,
      totalDisk: node.disk,
      usedDisk: usedDisk,
      freeDisk: node.disk - usedDisk,
      diskOverallocation: node.disk_overallocate || 0
    };
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

  router.get("/servers/capacity/:node", authMiddleware, async (req, res) => {
    const { node } = req.params;
    const { requiredMemory, requiredDisk } = req.query;
    try {
      const allocations = await getAvailableAllocations(node);
      
      const capacityInfo = await getNodeCapacityInfo(node);
      
      const memOverallocate = capacityInfo.memoryOverallocation;
      const maxMemory = capacityInfo.totalMemory * (1 + memOverallocate / 100);
      const effectiveFreeMemory = maxMemory - capacityInfo.usedMemory;
      
      const diskOverallocate = capacityInfo.diskOverallocation;
      const maxDisk = capacityInfo.totalDisk * (1 + diskOverallocate / 100);
      const effectiveFreeDisk = maxDisk - capacityInfo.usedDisk;
      
      const requiredMem = parseInt(requiredMemory) || 0;
      const requiredDsk = parseInt(requiredDisk) || 0;
      const hasEnoughMemory = effectiveFreeMemory >= requiredMem;
      const hasEnoughDisk = effectiveFreeDisk >= requiredDsk;
      
      res.status(200).json({ 
        availableAllocations: allocations.length,
        freeMemory: Math.floor(effectiveFreeMemory),
        totalMemory: capacityInfo.totalMemory,
        usedMemory: capacityInfo.usedMemory,
        hasEnoughMemory: hasEnoughMemory,
        freeDisk: Math.floor(effectiveFreeDisk),
        totalDisk: capacityInfo.totalDisk,
        usedDisk: capacityInfo.usedDisk,
        hasEnoughDisk: hasEnoughDisk
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/server/transfer", authMiddleware, async (req, res) => {
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