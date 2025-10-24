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
  "name": "Google OAuth2 Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const crypto = require('crypto');
const axios = require('axios');
const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const { discordLog } = require("../../handlers/log");
const PterodactylApplicationModule = require('../../handlers/ApplicationAPI.js');

let google;
let oauth2Client;

module.exports.load = async function (app, db) {
  if (!google) {
    google = require('googleapis').google;
  }

  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(
      settings.api.client.oauth2.google.id,
      settings.api.client.oauth2.google.secret,
      settings.api.client.oauth2.google.link + settings.api.client.oauth2.google.callbackpath
    );
  }

  const AppAPI = new PterodactylApplicationModule(settings.pterodactyl.domain, settings.pterodactyl.key);

  app.get("/google/login", (req, res) => {
    if (req.query.redirect) req.session.redirect = "/" + req.query.redirect;

    const loginAttemptId = crypto.randomBytes(16).toString('hex');
    res.cookie('loginAttempt', loginAttemptId, { httpOnly: true, maxAge: 5 * 60 * 1000 });

    if (!settings.api.client.oauth2.google.enable) return res.redirect("/auth");

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email'
      ]
    });

    res.redirect(url);
    return;
  });

  app.get(settings.api.client.oauth2.google.callbackpath, async (req, res) => {
    if (!req.query.code) return res.redirect(`/auth?error=missing_code`);
    if (!settings.api.client.oauth2.google.enable) return res.redirect("/auth");

    res.clearCookie('loginAttempt');

    try {
      const { tokens } = await oauth2Client.getToken(req.query.code);
      oauth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({
        auth: oauth2Client,
        version: 'v2'
      });

      const userinfo = await oauth2.userinfo.get();
      const user = userinfo.data;

      if (settings.whitelist.status && !settings.whitelist.users.includes(user.id)) {
        return res.send("Service is under maintenance.");
      }

      let ip = req.headers["cf-connecting-ip"] || req.connection.remoteAddress || "::1";
      ip = ip.replace(/::1/g, "::ffff:127.0.0.1").replace(/^.*:/, "");

      if (settings.api.client.oauth2.ip.block.includes(ip)) {
        return res.send("Your IP has been blocked from signing in.");
      }

      // Set cookie with Google ID
      res.cookie('userId', user.id, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

      if (!(await db.get("users-" + user.id))) {
        if (!settings.api.client.allow.newusers) {
          return res.send("New users cannot sign up currently.");
        }

        const genpassword = settings.api.client.passwordgenerator.signup
          ? makeid(settings.api.client.passwordgenerator["length"])
          : makeid(16);

        const username = `user_${user.id.substring(0, 10)}`;
        console.log(`Attempting to create Pterodactyl account for: ${username} (${user.email})`);

        try {
          // Try creating a new Pterodactyl account
          const createAccount = await AppAPI.createUser({
            username,
            email: user.email,
            first_name: user.given_name || "User",
            last_name: user.family_name || user.id.substring(0, 5),
            password: genpassword
          });

          const userDataID = createAccount.attributes.id;
          const userList = (await db.get("users")) || [];
          userList.push(userDataID);
          await db.set("users", userList);
          await db.set("users-" + user.id, userDataID);

          req.session.newaccount = true;
          req.session.password = genpassword;

          await db.set('notifications-' + user.id, [{
            action: "user:signup",
            name: "User registration",
            timestamp: new Date().toISOString()
          }]);

          discordLog("signup", `${user.name} logged in to the dashboard for the first time with Google!`);

        } catch (createError) {
          try {
            const users = await AppAPI.listUsers({
              'include': 'servers',
              'filter[email]': encodeURIComponent(user.email),
            });
            const existingUser = users.data.find(acc => acc.attributes.email === user.email);

            if (!existingUser) {
              // todo : check on user if the email is already taken by another account, if not , create account
              return res.redirect('/auth?error=account_creation_failed');
            }

            const userDataID = existingUser.attributes.id;
            const userList = (await db.get("users")) || [];

            if (!userList.includes(userDataID)) {
              userList.push(userDataID);
              await db.set("users", userList);
              await db.set("users-" + user.id, userDataID);
              req.session.pterodactyl = existingUser.attributes;
            } else {
              return res.send("This email is already registered and linked to another Discord/Google account.");
            }

          } catch (fetchError) {
            console.error("Error verifying existing account:", fetchError.response?.data || fetchError.message);
            return res.redirect('/auth?error=server_error');
          }
        }
      }

      // Fetch and cache user info from Pterodactyl
      const cacheAccountResponse = await axios.get(
        `${settings.pterodactyl.domain}/api/application/users/${await db.get("users-" + user.id)}?include=servers`,
        {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${settings.pterodactyl.key}`
          }
        }
      );

      const cacheaccountinfo = cacheAccountResponse.data;
      req.session.pterodactyl = cacheaccountinfo.attributes;

      user.username = user.name.replace(/[^a-zA-Z0-9_\-\.]/g, '').substring(0, 20);
      req.session.userinfo = user;

      // Auth notification
      const notifications = (await db.get('notifications-' + user.id)) || [];
      notifications.push({
        action: "user:auth",
        name: "Sign in from new location",
        timestamp: new Date().toISOString()
      });
      await db.set('notifications-' + user.id, notifications);

      const redirect = req.session.redirect;
      delete req.session.redirect;

      return res.redirect(redirect || "/dashboard");

    } catch (error) {
      console.error('Error during Google OAuth:', error.response?.data || error.message);
      return res.redirect('/auth');
    }
  });
};

function makeid(length) {
  let result = "";
  let characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}