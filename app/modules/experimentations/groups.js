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
  "name": "Groups Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../../handlers/config");
const settings = loadConfig("./config.toml");
const { requireAuth } = require("../../handlers/checkMiddleware.js");


module.exports.load = async function (app, db) {
    // Helper function to get user-specific groups key
    const getUserGroupsKey = (userId) => `user-${userId}-server-groups`;

    // GET all groups for a user
    app.get("/groups", requireAuth, async (req, res) => {
        const userId = req.session.userinfo.id;
        const groups = await db.get(getUserGroupsKey(userId)) || {};
        res.json(groups);
    });

    // CREATE a new group for a user
    app.post("/groups", requireAuth, async (req, res) => {
        if (!req.body.name) return res.status(400).json({ error: "Group name is required" });

        const userId = req.session.userinfo.id;
        const groups = await db.get(getUserGroupsKey(userId)) || {};
        const newGroupId = Date.now().toString();
        groups[newGroupId] = { name: req.body.name, servers: [] };

        await db.set(getUserGroupsKey(userId), groups);
        res.status(201).json({ id: newGroupId, ...groups[newGroupId] });
    });

    // GET a specific group for a user
    app.get("/groups/:groupId", requireAuth, async (req, res) => {
        const userId = req.session.userinfo.id;
        const groups = await db.get(getUserGroupsKey(userId)) || {};
        const group = groups[req.params.groupId];

        if (!group) return res.status(404).json({ error: "Group not found" });

        res.json(group);
    });

    // UPDATE a group for a user
    app.put("/groups/:groupId", requireAuth, async (req, res) => {
        const userId = req.session.userinfo.id;
        const groups = await db.get(getUserGroupsKey(userId)) || {};
        const group = groups[req.params.groupId];

        if (!group) return res.status(404).json({ error: "Group not found" });

        if (req.body.name) group.name = req.body.name;

        await db.set(getUserGroupsKey(userId), groups);
        res.json(group);
    });

    // DELETE a group for a user
    app.delete("/groups/:groupId", requireAuth, async (req, res) => {
        const userId = req.session.userinfo.id;
        const groups = await db.get(getUserGroupsKey(userId)) || {};

        if (!groups[req.params.groupId]) return res.status(404).json({ error: "Group not found" });

        delete groups[req.params.groupId];
        await db.set(getUserGroupsKey(userId), groups);
        res.status(204).send();
    });

    // ADD a server to a group
    app.post("/groups/:groupId/servers", requireAuth, async (req, res) => {
        if (!req.body.serverId) return res.status(400).json({ error: "Server ID is required" });

        const userId = req.session.userinfo.id;
        const groups = await db.get(getUserGroupsKey(userId)) || {};
        const group = groups[req.params.groupId];

        if (!group) return res.status(404).json({ error: "Group not found" });

        if (!group.servers.includes(req.body.serverId)) {
            group.servers.push(req.body.serverId);
            await db.set(getUserGroupsKey(userId), groups);
        }

        res.json(group);
    });

    // REMOVE a server from a group
    app.delete("/groups/:groupId/servers/:serverId", requireAuth, async (req, res) => {
        const userId = req.session.userinfo.id;
        const groups = await db.get(getUserGroupsKey(userId)) || {};
        const group = groups[req.params.groupId];

        if (!group) return res.status(404).json({ error: "Group not found" });

        group.servers = group.servers.filter(id => id !== req.params.serverId);
        await db.set(getUserGroupsKey(userId), groups);
        res.json(group);
    });
};
