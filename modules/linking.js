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
  "name": "Discord Linking Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const fetch = require('node-fetch');
const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const indexjs = require("../app.js");
const log = require("../handlers/log");

module.exports.load = async function (app, db) {
  // Helper function to fetch user info from Discord API
  async function getDiscordUserInfo(access_token) {
    const response = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    });
    return response.json();
  }

  // Helper function to handle J4R (Join for Rewards)
  async function handleJ4R(userinfo, access_token) {
    if (settings.api.client.j4r.enabled) {
      const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });
      const guildsinfo = await guildsResponse.json();

      let userj4r = await db.get(`j4rs-${userinfo.id}`) ?? [];
      let coins = await db.get(`coins-${userinfo.id}`) ?? 0;

      for (const guild of settings.api.client.j4r.ads) {
        if (guildsinfo.find(g => g.id === guild.id) && !userj4r.find(g => g.id === guild.id)) {
          userj4r.push({
            id: guild.id,
            coins: guild.coins
          });
          coins += guild.coins;
        }
      }

      for (const j4r of userj4r) {
        if (!guildsinfo.find(g => g.id === j4r.id)) {
          userj4r = userj4r.filter(g => g.id !== j4r.id);
          coins -= j4r.coins;
        }
      }

      await db.set(`j4rs-${userinfo.id}`, userj4r);
      await db.set(`coins-${userinfo.id}`, coins);
    }
  }

  // Discord linking endpoint
  app.get('/api/discord-link', async (req, res) => {
    if (!req.session.pterodactyl) return res.status(403).json({ error: 'Not logged in' });

    const existingDiscordId = await db.get(`discord-${req.session.pterodactyl.id}`);
    if (existingDiscordId) {
      return res.status(400).json({ error: 'Discord account already linked' });
    }

    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${settings.api.client.oauth2.id}&redirect_uri=${encodeURIComponent(settings.api.client.oauth2.link + '/api/discord-callback')}&response_type=code&scope=identify%20email%20guilds.join`;
    res.json({ auth_url: authUrl });
  });

  // Discord callback endpoint
  app.get('/api/discord-callback', async (req, res) => {
    if (!req.session.pterodactyl) return res.status(403).json({ error: 'Not logged in' });
    if (!req.query.code) return res.status(400).json({ error: 'Missing code' });

    try {
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: settings.api.client.oauth2.id,
          client_secret: settings.api.client.oauth2.secret,
          grant_type: 'authorization_code',
          code: req.query.code,
          redirect_uri: settings.api.client.oauth2.link + '/api/discord-callback'
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const tokenData = await tokenResponse.json();
      const userinfo = await getDiscordUserInfo(tokenData.access_token);

      await db.set(`discord-${req.session.pterodactyl.id}`, userinfo.id);
      await handleJ4R(userinfo, tokenData.access_token);

      let theme = indexjs.get(req);
      res.redirect(theme.settings.redirect.callback ? theme.settings.redirect.callback : "/");
    } catch (error) {
      console.error('Error in Discord callback:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get Discord info endpoint
  app.get('/api/discord-info', async (req, res) => {
    if (!req.session.pterodactyl) return res.status(403).json({ error: 'Not logged in' });

    const discordId = await db.get(`discord-${req.session.pterodactyl.id}`);
    if (!discordId) {
      return res.status(404).json({ error: 'No Discord account linked' });
    }

    try {
      const userResponse = await fetch(`https://discord.com/api/users/${discordId}`, {
        headers: {
          Authorization: `Bot ${settings.api.client.bot.token}`
        }
      });
      const userData = await userResponse.json();

      res.json({
        id: userData.id,
        username: userData.username,
        discriminator: userData.discriminator,
        avatar: `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
      });
    } catch (error) {
      console.error('Error fetching Discord info:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Relink Discord account endpoint
  app.get('/api/discord-relink', async (req, res) => {
    if (!req.session.pterodactyl) return res.status(403).json({ error: 'Not logged in' });

    await db.delete(`discord-${req.session.pterodactyl.id}`);

    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${settings.api.client.oauth2.id}&redirect_uri=${encodeURIComponent(settings.api.client.oauth2.link + '/api/discord-callback')}&response_type=code&scope=identify%20email%20guilds.join`;
    res.json({ auth_url: authUrl });
  });
};