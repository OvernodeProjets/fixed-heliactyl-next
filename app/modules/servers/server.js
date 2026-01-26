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
  "name": "Pterodactyl Server Module",
  "target_platform": "3.2.1-beta.1"
};

module.exports.heliactylModule = heliactylModule;

const { getClientAPI } = require("../../handlers/pterodactylSingleton.js");
const loadConfig = require("../../handlers/config");
const settings = loadConfig("./config.toml");
const WebSocket = require("ws");
const axios = require("axios");
const FormData = require("form-data");
const path = require("path");
const fs = require("fs");
const cluster = require("cluster");
const schedule = require("node-schedule");
const { requireAuth, ownsServer } = require("../../handlers/checkMiddleware.js")
const { discordLog, serverActivityLog } = require("../../handlers/log.js");
const pterodactylClient = getClientAPI();

/**
 * Execute a function with a file lock
 * @param {string} lockPath - Path to the lock directory
 * @param {Function} fn - Function to execute
 */
async function withFileLock(lockName, fn) {
  const lockDir = path.join(path.dirname(workflowsFilePath), `${lockName}.lock`);
  const maxRetries = 20; // 2 seconds total wait
  const retryDelay = 100;

  for (let i = 0; i < maxRetries; i++) {
    try {
      fs.mkdirSync(lockDir);
      // Lock acquired
      try {
        return await fn();
      } finally {
        try {
          fs.rmdirSync(lockDir);
        } catch (e) {
          console.error(`Failed to remove lock ${lockDir}:`, e);
        }
      }
    } catch (error) {
      if (error.code === 'EEXIST') {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Failed to acquire lock for ${lockName} after ${maxRetries} attempts`);
}

const workflowsFilePath = path.join(__dirname, "../../storage/workflows.json");
const scheduledWorkflowsFilePath = path.join(
  __dirname,
  "../../storage/scheduledWorkflows.json"
);
module.exports.load = async function (router, db) {
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);


  function saveWorkflowToFile(instanceId, workflow) {
    withFileLock('workflows', () => {
      let workflows = {};

      if (fs.existsSync(workflowsFilePath)) {
        try {
          const data = fs.readFileSync(workflowsFilePath, "utf8");
          workflows = JSON.parse(data);
        } catch (e) {
            // Handle corrupted file
            console.error("Error parsing workflows file, starting fresh:", e);
            workflows = {};
        }
      }

      workflows[instanceId] = workflow;

      fs.writeFileSync(
        workflowsFilePath,
        JSON.stringify(workflows, null, 2),
        "utf8"
      );
    }).catch(err => console.error("Error saving workflow:", err));
  }

  function saveScheduledWorkflows() {
    try {
      const scheduledWorkflows = {};

      for (const job of Object.values(schedule.scheduledJobs)) {
        if (job.name.startsWith("job_")) {
          const instanceId = job.name.split("_")[1];
          scheduledWorkflows[instanceId] = job.nextInvocation();
        }
      }

      fs.writeFileSync(
        scheduledWorkflowsFilePath,
        JSON.stringify(scheduledWorkflows, null, 2),
        "utf8"
      );
    } catch (error) {
      console.error("Error saving scheduled workflows:", error);
    }
  }

  function loadScheduledWorkflows() {
    try {
      if (fs.existsSync(scheduledWorkflowsFilePath)) {
        const data = fs.readFileSync(scheduledWorkflowsFilePath, "utf8");
        const scheduledWorkflows = JSON.parse(data);

        for (const [instanceId, nextInvocation] of Object.entries(
          scheduledWorkflows
        )) {
          const workflow = loadWorkflowFromFile(instanceId);
          if (workflow) {
            scheduleWorkflowExecution(instanceId, workflow);
          }
        }
      }
    } catch (error) {
      console.error("Error loading scheduled workflows:", error);
    }
  }


  if (cluster.isWorker && cluster.worker.id === 1) {
    loadScheduledWorkflows();
    setInterval(async () => {
      try {
        const workflows = JSON.parse(fs.readFileSync(workflowsFilePath, "utf8"));
        const instanceIds = Object.keys(workflows);
        for (const id of instanceIds) {
          const details = await pterodactylClient.getServerDetails(id);
          if (details === null) {
            console.log(`[Workflow Cleanup] Server ${id} not found, deleting orphan workflow.`);
            deleteWorkflow(id);
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err) {
        // Silently fail if file doesn't exist yet or other issues
      }
    }, 60 * 60 * 1000); // Run every hour
  }

// GET /api/server/:id/logs - Get server activity logs
router.get('/server/:id/logs', authMiddleware, ownsServer(db), async (req, res) => {
  try {
    const serverId = req.params.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    // Get logs from database
    const activityLog = await db.get(`activity_log_${serverId}`) || [];
    
    // Calculate pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const totalLogs = activityLog.length;
    const totalPages = Math.ceil(totalLogs / limit);
    
    // Get paginated logs
    const paginatedLogs = activityLog.slice(startIndex, endIndex);
    
    // Format response with pagination metadata
    const response = {
      data: paginatedLogs,
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_items: totalLogs,
        items_per_page: limit,
        has_more: endIndex < totalLogs
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // GET workflow
  router.get(
    "/server/:id/workflow",
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        let workflow = await db.get(serverId + "_workflow");
        if (!workflow) {
          workflow = loadWorkflowFromFile(serverId);
        }

        if (!workflow) {
          workflow = {};
        }

        res.json(workflow);
      } catch (error) {
        console.error("Error fetching server details:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

// GET /api/server/:id/variables
router.get('/server/:id/variables', authMiddleware, ownsServer(db), async (req, res) => {
  try {
    const serverId = req.params.id;
    const response = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/startup`,
      {
        headers: {
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
          Accept: 'application/json',
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching server variables:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/server/:id/variables
router.put('/server/:id/variables', authMiddleware, ownsServer(db), async (req, res) => {
  try {
    const serverId = req.params.id;
    const { key, value } = req.body;

    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Missing key or value' });
    }

    const response = await axios.put(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/startup/variable`,
      { key, value },
      {
        headers: {
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error updating server variable:', error);
    if (error.response) {
      console.error('Pterodactyl Response:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // POST save workflow
  router.post(
    "/server/:instanceId/workflow/save-workflow",
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      const { instanceId } = req.params;
      const workflow = req.body;

      if (!instanceId || !workflow) {
        return res
          .status(400)
          .json({ success: false, message: "Missing required data" });
      }

      try {
        const scheduledJob = schedule.scheduledJobs[`job_${instanceId}`];
        if (scheduledJob) {
          scheduledJob.cancel();
        }

        await db.set(instanceId + "_workflow", workflow);
        saveWorkflowToFile(instanceId, workflow);

        scheduleWorkflowExecution(instanceId, workflow);

        saveScheduledWorkflows();

        await serverActivityLog(db, instanceId, 'Save Workflow', { workflowDetails: workflow });

        res.json({ success: true, message: "Workflow saved successfully" });
      } catch (error) {
        console.error("Error saving workflow:", error);
        res
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    }
  );
};

module.exports.deleteWorkflow = deleteWorkflow;

function scheduleWorkflowExecution(instanceId, workflow) {
  const blocks = workflow.blocks;
  const intervalBlock = blocks.find((block) => block.type === "interval");

  if (intervalBlock) {
    let intervalMinutes = parseFloat(intervalBlock.meta.selectedValue);
    if (isNaN(intervalMinutes) || intervalMinutes < 1) {
      intervalMinutes = 1;
    }
    const rule = new schedule.RecurrenceRule();
    rule.minute = new schedule.Range(0, 59, Math.floor(intervalMinutes));

    const jobId = `job_${instanceId}`;

    const nextExecution = schedule.scheduleJob(jobId, rule, () => {
      executeWorkflow(instanceId);
      saveScheduledWorkflows();
    });

    logCountdownToNextExecution(nextExecution, intervalMinutes);
    setInterval(() => checkWorkflowValidity(instanceId, nextExecution), 5000);
  }
}

function saveScheduledWorkflows() {
  try {
    const scheduledWorkflows = {};

    for (const job of Object.values(schedule.scheduledJobs)) {
      if (job.name.startsWith("job_")) {
        const instanceId = job.name.split("_")[1];
        scheduledWorkflows[instanceId] = job.nextInvocation();
      }
    }

    // Ensure directory exists
    const storageDir = path.dirname(scheduledWorkflowsFilePath);
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    fs.writeFileSync(
      scheduledWorkflowsFilePath,
      JSON.stringify(scheduledWorkflows, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Error saving scheduled workflows:", error);
  }
}

function logCountdownToNextExecution(scheduledJob, intervalMinutes) {
  const logInterval = setInterval(() => {
    const now = new Date();
    const nextDate = new Date(scheduledJob.nextInvocation());

    if (!isNaN(nextDate.getTime())) {
      const timeDiffMs = nextDate - now;
      const totalSecondsRemaining = Math.ceil(timeDiffMs / 1000);

      const minutesRemaining = Math.floor(totalSecondsRemaining / 60);
      const secondsRemaining = totalSecondsRemaining % 60;

      if (timeDiffMs > 0) {
        // Idk
      } else {
        clearInterval(logInterval);
      }
    } else {
      console.error(
        "Invalid next execution time. Cannot calculate remaining time."
      );
      clearInterval(logInterval);
    }
  }, 5000);
}

async function checkWorkflowValidity(instanceId, scheduledJob) {
  const workflow = loadWorkflowFromFile(instanceId);
  if (!workflow) {
    scheduledJob.cancel();
  }
}

function executeWorkflow(instanceId) {
  const workflow = loadWorkflowFromFile(instanceId);

  if (workflow) {
    const blocks = workflow.blocks;

    blocks
      .filter((block) => block.type === "power")
      .forEach((block) => {
        executePowerAction(instanceId, block.meta.selectedValue).then(
          (success) => {
            if (success) {
              const webhookBlock = blocks.find((b) => b.type === "webhook");
              if (webhookBlock) {
                sendWebhookNotification(
                  webhookBlock.meta.inputValue,
                  `Successfully executed power action: ${block.meta.selectedValue}`
                );
              }
            }
          }
        );
      });
  } else {
    console.error(`No workflow found for instance ${instanceId}`);
  }
}


function deleteWorkflow(instanceId) {
  withFileLock('workflows', () => {
    try {
      console.log(`Deleting workflow for instance ${instanceId} as server was not found.`);
      const jobId = `job_${instanceId}`;
      const scheduledJob = schedule.scheduledJobs[jobId];
      if (scheduledJob) {
        scheduledJob.cancel();
      }

      saveScheduledWorkflows();

      if (fs.existsSync(workflowsFilePath)) {
        let workflows = {};
        try {
            const data = fs.readFileSync(workflowsFilePath, "utf8");
            workflows = JSON.parse(data);
        } catch (e) {
             console.error("Error parsing workflows file during delete:", e);
             return;
        }

        if (workflows[instanceId]) {
          delete workflows[instanceId];
          fs.writeFileSync(
            workflowsFilePath,
            JSON.stringify(workflows, null, 2),
            "utf8"
          );
        }
      }
    } catch (error) {
      console.error(`Error deleting workflow for ${instanceId}:`, error);
    }
  }).catch(err => console.error(`Failed to delete workflow for ${instanceId}:`, err));
}

async function executePowerAction(instanceId, powerAction) {
  try {
    const validActions = ['start', 'stop', 'restart', 'kill'];
    if (!validActions.includes(powerAction)) {
      throw new Error(`Invalid power action: ${powerAction}`);
    }

    const result = await pterodactylClient.executePowerAction(instanceId, powerAction);
    if (result === null) {
      deleteWorkflow(instanceId);
      return false;
    }
    return result;
  } catch (error) {
    console.error(`Error executing power action for server ${instanceId}:`, error.message);
    return false;
  }
}

async function sendWebhookNotification(webhookUrl, message) {
  try {
    await axios.post(webhookUrl, {
      content: message,
    });
  } catch (error) {
    console.error("Failed to send webhook notification:", error.message);
  }
}

function loadWorkflowFromFile(instanceId) {
  try {
    if (fs.existsSync(workflowsFilePath)) {
      const data = fs.readFileSync(workflowsFilePath, "utf8");
      const workflows = JSON.parse(data);
      return workflows[instanceId] || null;
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error loading workflow from file:", error);
    return null;
  }
}
