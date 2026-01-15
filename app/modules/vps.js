/**
 *      __         ___            __        __
 *     / /_  ___  / (_)___ ______/ /___  __/ /
 *    / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 *   / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
 *  /_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
 *                               /____/      
 *     Heliactyl Next 3.2.1-beta.1 (Avalanche)
 * 
 */

const heliactylModule = {
  "name": "Proxmox VPS User Module",
  "target_platform": "3.2.1-beta.1",
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const ProxmoxAPI = require("../handlers/ProxmoxAPI.js");
const { requireAuth } = require("../handlers/checkMiddleware.js");

function isProxmoxEnabled() {
  return !!(settings.proxmox && settings.proxmox.api_key && settings.proxmox.api_url);
}

function getProxmoxAPI() {
  if (!isProxmoxEnabled()) return null;
  return new ProxmoxAPI(settings.proxmox.api_url, settings.proxmox.api_key);
}

// In-memory cache for VM details (reduces API calls to Proxmox)
const vmDetailsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCachedDetails(vmId) {
  const cached = vmDetailsCache.get(vmId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCachedDetails(vmId, data) {
  vmDetailsCache.set(vmId, {
    data,
    timestamp: Date.now()
  });
}

function invalidateCache(vmId) {
  vmDetailsCache.delete(vmId);
}

// Clean old cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of vmDetailsCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      vmDetailsCache.delete(key);
    }
  }
}, 60000);

module.exports.load = async function (router, db) {
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);

  // GET /api/vps/list
  router.get("/vps/list", authMiddleware, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) return res.status(503).json({ error: "Proxmox integration is not enabled" });

      const userId = req.session.userinfo.id;
      const userVMs = await db.get(`user-vps-${userId}`) || [];

      const vms = [];
      for (const vmRef of userVMs) {
        if (!vmRef.vmId) continue;
        const vmData = await db.get(`vps-${vmRef.vmId}`);
        if (vmData) vms.push(vmData);
      }

      res.json({ data: vms });
    } catch (error) {
      console.error("Error listing user VMs:", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/vps/:vmId
  router.get("/vps/:vmId", authMiddleware, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) return res.status(503).json({ error: "Integration disabled" });

      const userId = req.session.userinfo.id;
      const { vmId } = req.params;

      const vmData = await db.get(`vps-${vmId}`);
      if (!vmData || vmData.userId !== userId) return res.status(404).json({ error: "VM not found" });

      res.json({ data: vmData });
    } catch (error) {
      console.error("Error fetching VM:", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/vps/:vmId/details - Full VM details with Cloud Init IP (cached)
  router.get("/vps/:vmId/details", authMiddleware, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) return res.status(503).json({ error: "Integration disabled" });

      const userId = req.session.userinfo.id;
      const { vmId } = req.params;
      const forceRefresh = req.query.refresh === 'true';

      const vmData = await db.get(`vps-${vmId}`);
      if (!vmData || vmData.userId !== userId) return res.status(404).json({ error: "VM not found" });

      if (!forceRefresh) {
        const cached = getCachedDetails(vmId);
        if (cached) {
          return res.json({
            data: cached,
            cached: true
          });
        }
      }

      const proxmox = getProxmoxAPI();
      const details = await proxmox.getVMFullDetails(vmData.node, vmData.vmId);

      if (!details) {
        return res.status(500).json({ error: "Failed to fetch VM details" });
      }

      const fullDetails = {
        ...details,
        expirationDate: vmData.expirationDate,
        createdAt: vmData.createdAt,
        storedIp: vmData.ip
      };

      setCachedDetails(vmId, fullDetails);

      res.json({
        data: fullDetails,
        cached: false
      });
    } catch (error) {
      console.error("Error fetching VM details:", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/vps/:vmId/stats
  router.get("/vps/:vmId/stats", authMiddleware, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) return res.status(503).json({ error: "Integration disabled" });

      const userId = req.session.userinfo.id;
      const { vmId } = req.params;

      const vmData = await db.get(`vps-${vmId}`);
      if (!vmData || vmData.userId !== userId) return res.status(404).json({ error: "VM not found" });

      const proxmox = getProxmoxAPI();
      const stats = await proxmox.getVMStats(vmData.node, vmData.vmId);

      res.json({ data: stats });
    } catch (error) {
      console.error("Error fetching VM stats:", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/vps/:vmId/power
  router.post("/vps/:vmId/power", authMiddleware, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) return res.status(503).json({ error: "Integration disabled" });

      const userId = req.session.userinfo.id;
      const { vmId } = req.params;
      const { action } = req.body;

      if (!['start', 'stop', 'restart', 'shutdown'].includes(action)) {
        return res.status(400).json({ error: "Invalid action" });
      }

      const vmData = await db.get(`vps-${vmId}`);
      if (!vmData || vmData.userId !== userId) return res.status(404).json({ error: "VM not found" });

      const proxmox = getProxmoxAPI();
      let result;
      let actionPerformed = action;

      switch (action) {
        case 'start': result = await proxmox.startVM(vmData.node, vmData.vmId); break;
        case 'shutdown':
          try {
            result = await proxmox.shutdownVM(vmData.node, vmData.vmId);
          } catch (error) {
            console.warn(`Shutdown failed, falling back to stop:`, error.message);
            result = await proxmox.stopVM(vmData.node, vmData.vmId);
            actionPerformed = 'stop';
          }
          break;
        case 'stop': result = await proxmox.stopVM(vmData.node, vmData.vmId); break;
        case 'restart': result = await proxmox.restartVM(vmData.node, vmData.vmId); break;
      }

      invalidateCache(vmId);

      res.json({ message: `Command sent`, data: result, actionPerformed });
    } catch (error) {
      console.error("Error controlling VM power:", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/vps/:vmId/status
  router.get("/vps/:vmId/status", authMiddleware, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) return res.status(503).json({ error: "Integration disabled" });

      const userId = req.session.userinfo.id;
      const { vmId } = req.params;

      const vmData = await db.get(`vps-${vmId}`);
      if (!vmData || vmData.userId !== userId) return res.status(404).json({ error: "VM not found" });

      const proxmox = getProxmoxAPI();
      const status = await proxmox.getVMStatus(vmData.node, vmData.vmId);

      res.json({ data: { status: status || 'unknown' } });
    } catch (error) {
      console.error("Error fetching status:", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/vps/:vmId/cloudinit/check
  router.get("/vps/:vmId/cloudinit/check", authMiddleware, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) return res.status(503).json({ error: "Integration disabled" });

      const userId = req.session.userinfo.id;
      const { vmId } = req.params;

      const vmData = await db.get(`vps-${vmId}`);
      if (!vmData || vmData.userId !== userId) return res.status(404).json({ error: "VM not found" });

      const proxmox = getProxmoxAPI();
      const usesCloudInit = await proxmox.checkCloudInit(vmData.node, vmData.vmId);

      res.json({ data: { usesCloudInit } });
    } catch (error) {
      console.error("Error checking Cloud Init:", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/vps/:vmId/cloudinit/config
  router.get("/vps/:vmId/cloudinit/config", authMiddleware, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) return res.status(503).json({ error: "Integration disabled" });

      const userId = req.session.userinfo.id;
      const { vmId } = req.params;

      const vmData = await db.get(`vps-${vmId}`);
      if (!vmData || vmData.userId !== userId) return res.status(404).json({ error: "VM not found" });

      const proxmox = getProxmoxAPI();
      const cloudInitConfig = await proxmox.getCloudInitConfig(vmData.node, vmData.vmId);

      res.json({ data: cloudInitConfig });
    } catch (error) {
      console.error("Error fetching Cloud Init config:", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/vps/:vmId/cloudinit/password
  router.post("/vps/:vmId/cloudinit/password", authMiddleware, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) return res.status(503).json({ error: "Integration disabled" });

      const userId = req.session.userinfo.id;
      const { vmId } = req.params;
      const { password } = req.body;

      if (!password || typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      const safePasswordRegex = /^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{},.<>?]+$/;
      if (!safePasswordRegex.test(password)) {
        return res.status(400).json({ error: "Password contains illegal characters" });
      }

      const vmData = await db.get(`vps-${vmId}`);
      if (!vmData || vmData.userId !== userId) return res.status(404).json({ error: "VM not found" });

      const proxmox = getProxmoxAPI();
      const usesCloudInit = await proxmox.checkCloudInit(vmData.node, vmData.vmId);

      if (!usesCloudInit) return res.status(400).json({ error: "Cloud Init not enabled" });

      await proxmox.updateCloudInitPassword(vmData.node, vmData.vmId, password);

      res.json({ success: true, message: "Password updated. Restart VM to apply." });
    } catch (error) {
      console.error("Error updating password:", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/vps/:vmId/rrd - Historical usage data for graphs
  router.get("/vps/:vmId/rrd", authMiddleware, async (req, res) => {
    try {
      if (!isProxmoxEnabled()) return res.status(503).json({ error: "Integration disabled" });

      const userId = req.session.userinfo.id;
      const { vmId } = req.params;
      const timeframe = req.query.timeframe || 'hour';
      const cf = req.query.cf || 'AVERAGE';

      // Validate timeframe parameter
      if (!['hour', 'day', 'week', 'month', 'year'].includes(timeframe)) {
        return res.status(400).json({ error: "Invalid timeframe. Use: hour, day, week, month, year" });
      }

      const vmData = await db.get(`vps-${vmId}`);
      if (!vmData || vmData.userId !== userId) return res.status(404).json({ error: "VM not found" });

      const proxmox = getProxmoxAPI();
      const rrdData = await proxmox.getRRDData(vmData.node, vmData.vmId, timeframe, cf);

      if (!rrdData) {
        return res.status(500).json({ error: "Failed to fetch RRD data" });
      }

      res.json({ data: rrdData, timeframe });
    } catch (error) {
      console.error("Error fetching RRD data:", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });
};