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
  "name": "Google OAuth2 Module",
  "target_platform": "3.2.2"
};

module.exports.heliactylModule = heliactylModule;

const crypto = require('crypto');
const axios = require('axios');
const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const { discordLog, addNotification } = require("../../handlers/log");
const PterodactylApplicationModule = require('../../handlers/ApplicationAPI.js');
const getPteroUser = require('../../handlers/getPteroUser.js');
const { getPages } = require('../../handlers/theme.js');

let google;
let oauth2Client;

module.exports.load = async function (router, db) {
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

  router.get("/google/login", (req, res) => {
    const { redirect } = req.query;
    
    if (redirect) req.session.redirect = "/" + redirect;

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

  router.get(settings.api.client.oauth2.google.callbackpath.replace(/^\/api/, ''), async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect(`/auth?error=missing_code`);
    if (!settings.api.client.oauth2.google.enable) return res.redirect("/auth");

    res.clearCookie('loginAttempt');

    try {
      const { tokens } = await oauth2Client.getToken(code);
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

      const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
      if (settings.api.client.oauth2.ip.block.includes(ip)) {
        return res.send(
          "You could not sign in, because your IP has been blocked from signing in."
        );
      }

      // Set cookie with Google ID
      res.cookie('userId', user.id, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

      if (settings.api.client.oauth2.ip["duplicate check"] == true) {
        const userIP = await db.get(`ipuser-${ip}`);
        const bypassFlag = await db.get(`antialt-bypass-${user.id}`) || false;
        if (userIP && userIP !== user.id && !bypassFlag) {
          // Send webhook notifications
          await discordLog(
            "anti-alt",
            `User ID: \`${user.id}\` attempted to login from an IP associated with another user ID: \`${userIP}\`.`,
            [
              { name: "IP Address", value: ip, inline: true },
              { name: "Alt User ID", value: userIP, inline: true }
            ],
            false
          );
          
          await discordLog(
            "anti-alt",
            `<@${user.id}> attempted to login from an IP associated with another user ID: <@${userIP}>.`,
            [],
            true
          );
          
          const theme = await getPages();
          return res.status(500).render(theme.settings.errors.antialt);
        } else if (!userIP) {
          await db.set(`ipuser-${ip}`, user.id);
        }
      }

      if (!(await db.get("users-" + user.id))) {
        if (!settings.api.client.allow.new_users) {
          return res.send("New users cannot sign up currently.");
        }

        const genpassword = settings.api.client.passwordgenerator.signup
          ? makeid(settings.api.client.passwordgenerator["length"])
          : makeid(16);

        try {
          // Try creating a new Pterodactyl account
          const createAccount = await AppAPI.createUser({
            username: user.id,
            email: user.email,
            first_name: user.given_name || "User",
            last_name: "On Heliactyl",
            password: genpassword
          });

          const userDataID = createAccount.attributes.id;
          const userList = (await db.get("users")) || [];
          userList.push(userDataID);
          await db.set("users", userList);
          await db.set("users-" + user.id, userDataID);

          req.session.newaccount = true;
          req.session.password = genpassword;

          await addNotification(
            db,
            user.id,
            "user:sign up",
            "Account created via Google OAuth2",
             req.ip
          );

          discordLog("sign in", `${user.name} signed in with Google!`);

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
      const PterodactylUser = await getPteroUser(user.id, db);
      if (!PterodactylUser) {
          res.send("An error has occurred while attempting to update your account information and server list.");
          return;
      }
      
      req.session.pterodactyl = PterodactylUser.attributes;

      user.username = user.name.replace(/[^a-zA-Z0-9_\-\.]/g, '').substring(0, 20);
      req.session.userinfo = user;

      // Auth notification
      await addNotification(
        db,
        user.id,
        "user:auth",
        "Signed in with Google OAuth2",
        req.ip
      );

      discordLog("sign in", `${user.name} logged in to the dashboard with Google!`);

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