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
  "name": "Files Server Module",
  "target_platform": "latest"
};

module.exports.heliactylModule = heliactylModule;


const loadConfig = require("../../handlers/config");
const settings = loadConfig("./config.toml");
const { requireAuth, ownsServer } = require("../../handlers/checkMiddleware")
const { discordLog, serverActivityLog } = require("../../handlers/log");
const { getClientAPI } = require("../../handlers/pterodactylSingleton.js");

module.exports.load = async function (router, db) {
  const ClientAPI = getClientAPI();
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);
// GET /api/server/:id/files/download
router.get('/server/:id/files/download', authMiddleware, ownsServer(db), async (req, res) => {
  try {
    const serverId = req.params.id;
    const file = req.query.file;
    
    if (!file) {
      return res.status(400).json({ error: 'File parameter is required' });
    }

    const data = await ClientAPI.request('GET', `/api/client/servers/${serverId}/files/download`, null, { file });
    res.json(data);
  } catch (error) {
    console.error('Error generating download link:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/server/:id/files/copy
router.post('/server/:id/files/copy', authMiddleware, ownsServer(db), async (req, res) => {
  try {
    const serverId = req.params.id;
    const { location } = req.body;

    if (!location) {
      return res.status(400).json({ error: 'Missing location' });
    }

    await ClientAPI.request('POST', `/api/client/servers/${serverId}/files/copy`, { location });
    res.status(204).send();
  } catch (error) {
    console.error('Error copying file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // GET /api/server/:id/files/list
router.get(
  "/server/:id/files/list",
  authMiddleware,
  ownsServer(db),
  async (req, res) => {
    try {
      const serverId = req.params.id;
      const directory = req.query.directory || "/";
      const page = parseInt(req.query.page) || 1;
      const perPage = parseInt(req.query.per_page) || 10;

      const data = await ClientAPI.request('GET', `/api/client/servers/${serverId}/files/list`, null, { 
        directory,
        page: page,
        per_page: perPage
      });

      // Add pagination metadata to the response
      const totalItems = data.meta?.pagination?.total || 0;
      const totalPages = Math.ceil(totalItems / perPage);

      const paginatedResponse = {
        ...data,
        meta: {
          ...data.meta,
          pagination: {
            ...data.meta?.pagination,
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
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const file = req.query.file; 
        const data = await ClientAPI.request('GET', `/api/client/servers/${serverId}/files/contents`, null, { file }, 'text');

        // Send the raw file content back to the client
        res.send(data);
      } catch (error) {
        console.error("Error getting file contents:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/write
  router.post(
    "/server/:id/files/write",
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const file = req.query.file; 
        const content = req.body; // Expect the raw file content from the client

        await ClientAPI.request('POST', `/api/client/servers/${serverId}/files/write`, content, { file });

    await serverActivityLog(db, serverId, 'Write File', { file });

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
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, files } = req.body;
        const data = await ClientAPI.request('POST', `/api/client/servers/${serverId}/files/compress`, { root, files });
        res.status(200).json(data);
      } catch (error) {
        console.error("Error compressing files:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/decompress
  router.post(
    "/server/:id/files/decompress",
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, file } = req.body;
        await ClientAPI.request('POST', `/api/client/servers/${serverId}/files/decompress`, { root, file });
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
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, files } = req.body;
        await ClientAPI.request('POST', `/api/client/servers/${serverId}/files/delete`, { root, files });

        await serverActivityLog(db, serverId, 'Delete File', { root, files });
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
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const directory = req.query.directory || "/";
        const data = await ClientAPI.request('GET', `/api/client/servers/${serverId}/files/upload`, null, { directory });
        res.json(data);
      } catch (error) {
        console.error("Error getting upload URL:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // POST /api/server/:id/files/create-folder
  router.post(
    "/server/:id/files/create-folder",
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, name } = req.body;
        await ClientAPI.request('POST', `/api/client/servers/${serverId}/files/create-folder`, { root, name });
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
    authMiddleware,
    ownsServer(db),
    async (req, res) => {
      try {
        const serverId = req.params.id;
        const { root, files } = req.body;
        await ClientAPI.request('PUT', `/api/client/servers/${serverId}/files/rename`, { root, files });
        res.status(204).send();
      } catch (error) {
        console.error("Error renaming file/folder:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );
};