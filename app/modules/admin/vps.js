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
 *     Proxmox VPS Admin Module
 */

const heliactylModule = {
  "name": "Proxmox VPS Admin Module",
  "target_platform": "3.2.1-beta.1",
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const ProxmoxAPI = require("../../handlers/ProxmoxAPI.js");
const { requireAuth } = require("../../handlers/checkMiddleware.js");
const { discordLog } = require("../../handlers/log.js");

function isProxmoxEnabled() {
  return !!(settings.proxmox && settings.proxmox.api_key && settings.proxmox.api_url);
}

function getProxmoxAPI() {
  if (!isProxmoxEnabled()) {
    return null;
  }
  return new ProxmoxAPI(settings.proxmox.api_url, settings.proxmox.api_key);
}

module.exports.load = async function (router, db) {
  const requireAdmin = (req, res, next) => requireAuth(req, res, next, true, db);

  // GET /api/admin/vps/list - List all VMs
  router.get("/admin/vps/list", requireAdmin, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) {
        return res.status(503).json({ error: "Proxmox integration is not enabled" });
      }

      const vmKeys = await db.list("vps-*");
      const vms = [];

      for (const key of vmKeys) {
        const vmData = await db.get(key);
        if (vmData) {
          vms.push(vmData);
        }
      }

      res.json({ data: vms });
    } catch (error) {
      console.error("Error listing VMs:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/admin/vps/add - Add a new VM
  router.post("/admin/vps/add", requireAdmin, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) {
        return res.status(503).json({ error: "Proxmox integration is not enabled" });
      }

      const { userId, vmId, ip, expirationDate, node } = req.body;

      if (!userId || !vmId || !expirationDate || !node) {
        return res.status(400).json({ error: "Missing required fields: userId, vmId, expirationDate, node" });
      }
      const pterodactylId = await db.get("users-" + userId);
      if (!pterodactylId) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check if VM already exists in database
      const existingVM = await db.get(`vps-${vmId}`);
      if (existingVM) {
        return res.status(409).json({ error: "VM is already assigned to another user" });
      }

      const proxmox = getProxmoxAPI();
      const vmExists = await proxmox.checkVMExists(node, parseInt(vmId));
      if (!vmExists) {
        return res.status(404).json({ error: "VM not found in Proxmox" });
      }

      const vmName = await proxmox.getVMName(node, parseInt(vmId)) || `VM ${vmId}`;

      const vmData = {
        userId,
        vmId: parseInt(vmId),
        node,
        ip: ip || null,
        expirationDate: new Date(expirationDate).toISOString(),
        name: vmName,
        createdAt: new Date().toISOString(),
        createdBy: req.session.userinfo.id
      };

      await db.set(`vps-${vmId}`, vmData);

      // Add VM to user's list
      const userVMs = await db.get(`user-vps-${userId}`) || [];
      userVMs.push({
        vmId: parseInt(vmId),
        node,
        name: vmName
      });
      await db.set(`user-vps-${userId}`, userVMs);

      discordLog(
        `add vps`,
        `${req.session.userinfo.username} added VM ${vmId} (${vmName}) to user ${userId}`
      );

      res.json({ message: "VM added successfully", data: vmData });
    } catch (error) {
      console.error("Error adding VM:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // GET /api/admin/vps/verify - Verify VM exists and is available
  router.get("/admin/vps/verify", requireAdmin, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) {
        return res.status(503).json({ error: "Proxmox integration is not enabled" });
      }

      const { vmId, node } = req.query;

      if (!vmId || !node) {
        return res.status(400).json({ error: "Missing vmId or node parameter" });
      }

      const proxmox = getProxmoxAPI();

      const vmExists = await proxmox.checkVMExists(node, parseInt(vmId));
      if (!vmExists) {
        return res.json({ exists: false, available: false, message: "VM not found in Proxmox" });
      }

      // Check if VM is already assigned
      const existingVM = await db.get(`vps-${vmId}`);
      if (existingVM) {
        return res.json({
          exists: true,
          available: false,
          message: `VM is already assigned to user ${existingVM.userId}`,
          assignedTo: existingVM.userId
        });
      }

      const vmName = await proxmox.getVMName(node, parseInt(vmId));

      res.json({
        exists: true,
        available: true,
        message: "VM is available",
        name: vmName || `VM ${vmId}`
      });
    } catch (error) {
      console.error("Error verifying VM:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // DELETE /api/admin/vps/:vmId - Remove a VM
  router.delete("/admin/vps/:vmId", requireAdmin, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) {
        return res.status(503).json({ error: "Proxmox integration is not enabled" });
      }

      const { vmId } = req.params;

      const vmData = await db.get(`vps-${vmId}`);
      if (!vmData) {
        return res.status(404).json({ error: "VM not found" });
      }

      await db.delete(`vps-${vmId}`);

      const userVMs = await db.get(`user-vps-${vmData.userId}`) || [];
      const filteredVMs = userVMs.filter(vm => vm.vmId !== parseInt(vmId));
      if (filteredVMs.length === 0) {
        await db.delete(`user-vps-${vmData.userId}`);
      } else {
        await db.set(`user-vps-${vmData.userId}`, filteredVMs);
      }

      discordLog(
        `remove vps`,
        `${req.session.userinfo.username} removed VM ${vmId} from user ${vmData.userId}`
      );

      res.json({ message: "VM removed successfully" });
    } catch (error) {
      console.error("Error removing VM:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/admin/vps/nodes - List available Proxmox nodes
  router.get("/admin/vps/nodes", requireAdmin, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) {
        return res.status(503).json({ error: "Proxmox integration is not enabled" });
      }

      const proxmox = getProxmoxAPI();
      const nodes = await proxmox.listNodes();

      res.json({ data: nodes });
    } catch (error) {
      console.error("Error listing nodes:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // PUT /api/admin/vps/:vmId - Update VM information
  router.put("/admin/vps/:vmId", requireAdmin, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) {
        return res.status(503).json({ error: "Proxmox integration is not enabled" });
      }

      const { vmId } = req.params;
      const { ip, expirationDate, userId } = req.body;

      const vmData = await db.get(`vps-${vmId}`);
      if (!vmData) {
        return res.status(404).json({ error: "VM not found" });
      }

      // If userId is being changed, verify the new user exists
      if (userId && userId !== vmData.userId) {
        const newUserPterodactylId = await db.get("users-" + userId);
        if (!newUserPterodactylId) {
          return res.status(404).json({ error: "New user not found" });
        }

        // Remove from old user's list
        const oldUserVMs = await db.get(`user-vps-${vmData.userId}`) || [];
        const filteredOldVMs = oldUserVMs.filter(vm => vm.vmId !== parseInt(vmId));
        if (filteredOldVMs.length === 0) {
          await db.delete(`user-vps-${vmData.userId}`);
        } else {
          await db.set(`user-vps-${vmData.userId}`, filteredOldVMs);
        }

        // Add to new user's list
        const newUserVMs = await db.get(`user-vps-${userId}`) || [];
        if (!newUserVMs.find(vm => vm.vmId === parseInt(vmId))) {
          newUserVMs.push({
            vmId: parseInt(vmId),
            node: vmData.node,
            name: vmData.name
          });
          await db.set(`user-vps-${userId}`, newUserVMs);
        }

        vmData.userId = userId;
      }

      // Update IP if provided
      if (ip) {
        vmData.ip = ip;
      }

      // Update expiration date if provided
      if (expirationDate) {
        vmData.expirationDate = new Date(expirationDate).toISOString();
      }

      // Save updated VM data
      await db.set(`vps-${vmId}`, vmData);

      discordLog(
        `update vps`,
        `${req.session.userinfo.username} updated VM ${vmId}`
      );

      res.json({ message: "VM updated successfully", data: vmData });
    } catch (error) {
      console.error("Error updating VM:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });
};

