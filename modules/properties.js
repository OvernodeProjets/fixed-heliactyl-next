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
  "name": "Pterodactyl Properties Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const express = require('express');
const axios = require('axios');
const PterodactylClientModule = require('../handlers/Client.js');
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");

module.exports.load = async function(app, db) {
    const router = express.Router();
    const pterodactylClient = new PterodactylClientModule(settings.pterodactyl.domain, settings.pterodactyl.client_key);

    // Middleware to check if user is authenticated
    const isAuthenticated = (req, res, next) => {
        if (req.session.pterodactyl) {
            next();
        } else {
            res.status(401).json({ error: "Unauthorized" });
        }
    };

    // Middleware to check if user owns the server
    const ownsServer = (req, res, next) => {
        const serverId = req.params.id;
        const userServers = req.session.pterodactyl.relationships.servers.data;
        const serverOwned = userServers.some(server => server.attributes.identifier === serverId);
        
        if (serverOwned) {
            next();
        } else {
            res.status(403).json({ error: "Forbidden. You don't have access to this server." });
        }
    };

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
    router.get('/server/:id/properties', isAuthenticated, ownsServer, async (req, res) => {
        try {
            const serverId = req.params.id;
            const response = await axios.get(`${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/contents`, {
                params: { file: '/server.properties' },
                headers: {
                    'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });

            const properties = parseServerProperties(response.data);
            res.json(properties);
        } catch (error) {
            console.error('Error fetching server properties:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    // PUT update server properties
    router.put('/server/:id/properties', isAuthenticated, ownsServer, async (req, res) => {
        try {
            const serverId = req.params.id;
            const updatedProperties = req.body;

            // First, get the current content of server.properties
            const response = await axios.get(`${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/contents`, {
                params: { file: '/server.properties' },
                headers: {
                    'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });

            let properties = parseServerProperties(response.data);

            // Update the properties
            for (const [key, value] of Object.entries(updatedProperties)) {
                properties[key] = value;
            }

            // Convert properties back to string
            const content = Object.entries(properties).map(([key, value]) => `${key}=${value}`).join('\n');

            // Write the updated content back to the file
            await axios.post(`${settings.pterodactyl.domain}/api/client/servers/${serverId}/files/write`,
                content,
                {
                    params: { file: '/server.properties' },
                    headers: {
                        'Authorization': `Bearer ${settings.pterodactyl.client_key}`,
                        'Accept': 'application/json',
                        'Content-Type': 'text/plain'
                    }
                }
            );

            res.json({ success: true, message: "Properties updated successfully" });
        } catch (error) {
            console.error('Error updating server properties:', error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    // GET property info
    router.get('/minecraft/property-info', (req, res) => {
        const { key } = req.query;
        const propertyInfo = {
            // Add more properties and their descriptions as needed
            'server-port': 'The port on which the server is running',
            'gamemode': 'The default game mode for new players',
            'difficulty': 'The difficulty setting of the game',
            'max-players': 'The maximum number of players allowed on the server',
            'view-distance': 'The maximum distance from players that world data is sent to them',
            'spawn-protection': 'The radius around world spawn which cannot be modified by non-operators'
            // ... other properties
        };

        res.json({ description: propertyInfo[key] || 'No information available for this property.' });
    });

    // GET default property value
    router.get('/minecraft/default-property', (req, res) => {
        const { key } = req.query;
        const defaultValues = {
            // Add more properties and their default values as needed
            'server-port': '25565',
            'gamemode': 'survival',
            'difficulty': 'easy',
            'max-players': '20',
            'view-distance': '10',
            'spawn-protection': '16',
            // ... other properties
        };

        res.json({ defaultValue: defaultValues[key] || 'Default value not available.' });
    });

    // Use the router with the '/api' prefix
    app.use('/api', router);

    //console.log('Pterodactyl Server Properties module loaded');
};