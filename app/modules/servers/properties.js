/**
 *      __         ___            __        __
 *     / /_  ___  / (_)___ ______/ /___  __/ /
 *    / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 *   / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
 *  /_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
 *                               /____/      
 * 
 *     Heliactyl Next 3.2.1-beta.1 (Avalanche)
 *      UNUSED MODULE
 * 
 */

const heliactylModule = {
  "name": "Pterodactyl Properties Module",
  "target_platform": "3.2.1-beta.1"
};

module.exports.heliactylModule = heliactylModule;


const { getClientAPI } = require('../../handlers/pterodactylSingleton.js');
const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const { requireAuth, ownsServer } = require("../../handlers/checkMiddleware.js")

module.exports.load = async function(router, db) {
    const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);
    const pterodactylClient = getClientAPI();

    // Helper function to parse server.properties content
    const parseServerProperties = (content) => {
        const properties = {};
        const lines = content.split('\n');
        lines.forEach(line => {
            line = line.trim();
            if (line && !line.startsWith('#')) {
                const [key, value] = line.split('=').map(item => item.trim());
                properties[key] = value;
            }
        });
        return properties;
    };

    // GET server properties
    router.get('/server/:id/properties', authMiddleware, ownsServer(db), async (req, res) => {
        try {
            const serverId = req.params.id;
            const responseData = await pterodactylClient.request(
              'GET',
              `/api/client/servers/${serverId}/files/contents`,
              null,
              { file: '/server.properties' },
              'text'
            );

            const properties = parseServerProperties(responseData);
            res.json(properties);
        } catch (error) {
            console.error('Error fetching server properties:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    // PUT update server properties
    router.put('/server/:id/properties', authMiddleware, ownsServer(db), async (req, res) => {
        try {
            const serverId = req.params.id;
            const updatedProperties = req.body;

            // First, get the current content of server.properties
            // First, get the current content of server.properties
            const currentContent = await pterodactylClient.request(
              'GET',
              `/api/client/servers/${serverId}/files/contents`,
              null,
              { file: '/server.properties' },
              'text'
            );

            let properties = parseServerProperties(currentContent);

            // Update the properties
            for (const [key, value] of Object.entries(updatedProperties)) {
                properties[key] = value;
            }

            // Convert properties back to string
            const content = Object.entries(properties).map(([key, value]) => `${key}=${value}`).join('\n');

            // Write the updated content back to the file
            // Write the updated content back to the file
            await pterodactylClient.request(
                'POST',
                `/api/client/servers/${serverId}/files/write`,
                content,
                { file: '/server.properties' }
            );

            res.json({ success: true, message: "Properties updated successfully" });
        } catch (error) {
            console.error('Error updating server properties:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    // GET Minecraft property info + default value
    router.get('/minecraft/property', (req, res) => {
        const { key } = req.query;

        const propertyInfo = {
            'server-port': 'The port on which the server is running',
            'gamemode': 'The default game mode for new players',
            'difficulty': 'The difficulty setting of the game',
            'max-players': 'The maximum number of players allowed on the server',
            'view-distance': 'The maximum distance from players that world data is sent to them',
            'spawn-protection': 'The radius around world spawn which cannot be modified by non-operators'
        };

        const defaultValues = {
            'server-port': '25565',
            'gamemode': 'survival',
            'difficulty': 'easy',
            'max-players': '20',
            'view-distance': '10',
            'spawn-protection': '16',
        };

        const description = propertyInfo[key] || 'No information available for this property.';
        const defaultValue = defaultValues[key] || 'Default value not available.';

        res.json({
            key,
            description,
            defaultValue
        });
    });
};