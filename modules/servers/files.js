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
  "name": "Files Server Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const axios = require("axios");
const loadConfig = require("../../handlers/config");
const settings = loadConfig("./config.toml");
const { requireAuth, ownsServer } = require("../../handlers/checkMiddleware")
const express = require("express");


module.exports.load = async function (app, db) {
const router = express.Router();


  async function logActivity(db, serverId, action, details) {
  const timestamp = new Date().toISOString();
  const activityLog = await db.get(`activity_log_${serverId}`) || [];
  
  activityLog.unshift({ timestamp, action, details });
  
  // Keep only the last 100 activities
  if (activityLog.length > 100) {
    activityLog.pop();
  }
  
  await db.set(`activity_log_${serverId}`, activityLog);
}

    // GET /api/server/:id/files/download
router.get('/server/:id/files/download', requireAuth, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const file = req.query.file;
    
    if (!file) {
      return res.status(400).json({ error: 'File parameter is required' });
    }

    const response = await axios.get(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/download`,
      {
        params: { file },
        headers: {
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error generating download link:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/server/:id/files/copy
// unused
router.post('/server/:id/files/copy', requireAuth, ownsServer, async (req, res) => {
  try {
    const serverId = req.params.id;
    const { location } = req.body;

    if (!location) {
      return res.status(400).json({ error: 'Missing location' });
    }

    await axios.post(
      `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/copy`,
      { location },
      {
        headers: {
          Authorization: `Bearer ${settings.pterodactyl.client_key}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
    res.status(204).send();
  } catch (error) {
    console.error('Error copying file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // GET /api/server/:id/files/list
router.get(
  "/server/:id/files/list",
  requireAuth,
  ownsServer,
  async (req, res) => {
    try {
      const serverId = req.params.id;
      const directory = req.query.directory || "/";
      const page = parseInt(req.query.page) || 1;
      const perPage = parseInt(req.query.per_page) || 10;

      const response = await axios.get(
        `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/list`,
        {
          params: { 
            directory,
            page: page,
            per_page: perPage
          },
          headers: {
            Authorization: `Bearer ${settings.pterodactyl.client_key}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      // Add pagination metadata to the response
      const totalItems = response.data.meta?.pagination?.total || 0;
      const totalPages = Math.ceil(totalItems / perPage);

      const paginatedResponse = {
        ...response.data,
        meta: {
          ...response.data.meta,
          pagination: {
            ...response.data.meta?.pagination,
            current_page: page,
            per_page: perPage,
            total_pages: totalPages
          }
        }
      };

      res.json(paginatedResponse);
    } catch (error) {
      console.error("Error listing files:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

  /// GET /api/server/:id/files/contents
  router.get(
    "/server/:id/files/contents",
    requireAuth,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const file = encodeURIComponent(req.query.file); // URL-encode the file path
        const response = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/contents?file=${file}`,
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            responseType: "text", // Treat the response as plain text
          }
        );

        // Log the raw content for debugging

        // Send the raw file content back to the client
        res.send(response.data);
      } catch (error) {
        console.error("Error getting file contents:", error);

        // Optionally log the error response for more details
        if (error.response) {
          console.error("Error response data:", error.response.data);
        }

        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/write
  router.post(
    "/server/:id/files/write",
    requireAuth,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const file = encodeURIComponent(req.query.file); // URL-encode the file path
        const content = req.body; // Expect the raw file content from the client

        const response = await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/write?file=${file}`,
          content, // Send the content as the raw body
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "text/plain", // Adjust based on your file type (e.g., 'text/yaml')
            },
          }
        );

    await logActivity(db, serverId, 'Write File', { file });

        res.status(204).send(); // No content response
      } catch (error) {
        console.error("Error writing file:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/compress
  router.post(
    "/server/:id/files/compress",
    requireAuth,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, files } = req.body;
        const response = await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/compress`,
          { root, files },
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.status(200).json(response.data);
      } catch (error) {
        console.error("Error compressing files:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/decompress
  router.post(
    "/server/:id/files/decompress",
    requireAuth,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, file } = req.body;
        await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/decompress`,
          { root, file },
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
        console.error("Error decompressing file:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/delete
  router.post(
    "/server/:id/files/delete",
    requireAuth,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, files } = req.body;
        await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/delete`,
          { root, files },
          {
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
    await logActivity(db, serverId, 'Delete File', { root, files });
        res.status(204).send();
      } catch (error) {
        console.error("Error deleting files:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // GET /api/server/:id/files/upload
  router.get(
    "/server/:id/files/upload",
    requireAuth,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const directory = req.query.directory || "/";
        const response = await axios.get(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/upload`,
          {
            params: { directory },
            headers: {
              Authorization: `Bearer ${settings.pterodactyl.client_key}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );
        res.json(response.data);
      } catch (error) {
        console.error("Error getting upload URL:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/create-folder
  router.post(
    "/server/:id/files/create-folder",
    requireAuth,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, name } = req.body;
        await axios.post(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/create-folder`,
          { root, name },
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
        console.error("Error creating folder:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // PUT /api/server/:id/files/rename
  router.put(
    "/server/:id/files/rename",
    requireAuth,
    ownsServer,
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, files } = req.body;
        await axios.put(
          `${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/rename`,
          { root, files },
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
        console.error("Error renaming file/folder:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  app.use('/api', router);
};