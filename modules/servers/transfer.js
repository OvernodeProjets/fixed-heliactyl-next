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


module.exports.load = async function (app, db) {
  // idk
  const ADMIN_COOKIES = "pterodactyl_session=eyJpdiI6ImpZclJJa1hKeFNWbmxhRGhWbUMvcXc9PSIsInZhbHVlIjoib1huRWVheGpGdjhWZ3VSUmxHTE5xNTRuY0RPcm5UaHIvaG95aitHLy9kM3FpdlJ5ODUrU0lRdGlNd0l0WTVicWNPcXA2eXc4RHQ2eGFaQVlycDZXU1orTFFUdmtyd1huQ3Z0K1ZQWDZPdzQ2ZXdEU2dWUlEvU3Bpc3lvMWZneXMiLCJtYWMiOiJmZDJmZGFkODc3MjMzMmVkNjJkZTExYTQ0OWVmNDVkOWZmYmU4Yjc3ZDhmZWU4N2E3NTExOWIwMTY1NDA4M2MxIiwidGFnIjoiIn0%3D"
  const CSRF_TOKEN = "";
  
  async function apiRequest(endpoint, method = "GET", body = null) {
    const response = await fetch(`${settings.pterodactyl.domain}/api/application${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${settings.pterodactyl.key}`,
        "Content-Type": "application/json",
        Accept: "Application/vnd.pterodactyl.v1+json",
      },
      body: body ? JSON.stringify(body) : null,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${await response.text()}`);
    }

    return response.json();
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
      return fetch(
        `${settings.pterodactyl.domain}/admin/servers/view/${serverId}/manage/transfer`,
        {
          method: "POST",
          headers: {
            Cookie: ADMIN_COOKIES,
            "X-CSRF-TOKEN": CSRF_TOKEN,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `node_id=${targetNodeId}&allocation_id=${allocationId}`,
        }
      )
        .then((response) => {
          if (response.ok) {
            console.log(`Transfer job added to queue for server ${serverId}`);
          } else {
            console.error(
              `Failed to transfer server ${serverId}: ${response}`
            );
          }
        })
        .catch((error) => {
          console.error(`Error transferring server ${serverId}:`, error.message);
        });
    }

    app.get("/api/servers/capacity/:node", async (req, res) => {
      const { node } = req.params;
  
      try {
        const response = await getAvailableAllocations(node);
        res.status(200).json({ availableAllocations: response.length });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  
    app.get("/api/server/transfer", async (req, res) => {
      const { id, nodeId } = req.query;
  
      if (!id || !nodeId) {
        return res
          .status(400)
          .json({ error: "Missing required parameters: id or nodeId" });
      }
  
      try {
        // Get available allocations for the target node
        const availableAllocations = await getAvailableAllocations(nodeId);
  
        if (availableAllocations.length === 0) {
          return res
            .status(500)
            .json({ error: "No available allocations on the target node" });
        }
  
        // Transfer the server to the target node using the first available allocation
        await transferServer(id, availableAllocations[0].attributes.id, nodeId);
  
        res.status(200).json({
          message: `Transfer for server ${id} to node ${nodeId} initiated.`,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
};