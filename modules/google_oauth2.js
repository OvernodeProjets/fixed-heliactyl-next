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
const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");

const fetch = require("node-fetch");
const indexjs = require("../app.js");
const log = require("../handlers/log");

const fs = require("fs");
const { renderFile } = require("ejs");
const { google } = require('googleapis');

module.exports.load = async function (app, db) {
  const oauth2Client = new google.auth.OAuth2(
    settings.api.client.oauth2.google.id,
    settings.api.client.oauth2.google.secret,
    settings.api.client.oauth2.google.link + settings.api.client.oauth2.google.callbackpath
  );

  app.get("/google/login", (req, res) => {
    if (req.query.redirect) req.session.redirect = "/" + req.query.redirect;
    
    const loginAttemptId = crypto.randomBytes(16).toString('hex');
    res.cookie('loginAttempt', loginAttemptId, { httpOnly: true, maxAge: 5 * 60 * 1000 });

    if (settings.api.client.oauth2.google.enable == false) return res.redirect("/login");
    
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email']
    });
    res.redirect(url);
  });

  app.get(settings.api.client.oauth2.google.callbackpath, async (req, res) => {
    if (!req.query.code) return res.redirect(`/login`);

    if (settings.api.client.oauth2.google.enable == false) return res.redirect("/login");
    const loginAttemptId = req.cookies.loginAttempt;

    res.clearCookie('loginAttempt');

    try {
      const { tokens } = await oauth2Client.getToken(req.query.code);
      oauth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({
        auth: oauth2Client,
        version: 'v2'
      });

      const userinfo = await oauth2.userinfo.get();

      if (settings.whitelist.status && !settings.whitelist.users.includes(userinfo.data.id)) {
        return res.send("Service is under maintenance.");
      }

      let ip = req.headers["cf-connecting-ip"] || req.connection.remoteAddress;
      ip = (ip ? ip : "::1").replace(/::1/g, "::ffff:127.0.0.1").replace(/^.*:/, "");

      if (settings.api.client.oauth2.ip.block.includes(ip)) {
        return res.send("You could not sign in, because your IP has been blocked from signing in.");
      }

      // Set a cookie with the user's ID
      res.cookie('userId', userinfo.data.id, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

      if (!(await db.get("users-" + userinfo.data.id))) {
        if (settings.api.client.allow.newusers == true) {
          let genpassword = null;
          if (settings.api.client.passwordgenerator.signup == true)
            genpassword = makeid(settings.api.client.passwordgenerator["length"]);
          
          let accountjson = await fetch(
            settings.pterodactyl.domain + "/api/application/users",
            {
              method: "post",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${settings.pterodactyl.key}`,
              },
              body: JSON.stringify({
                username: userinfo.data.id,
                email: userinfo.data.email,
                first_name: userinfo.data.given_name,
                last_name: userinfo.data.family_name,
                password: genpassword,
              }),
            }
          );

          if ((await accountjson.status) == 201) {
            let accountinfo = JSON.parse(await accountjson.text());
            let userids = (await db.get("users")) ? await db.get("users") : [];
            userids.push(accountinfo.attributes.id);
            await db.set("users", userids);
            await db.set("users-" + userinfo.data.id, accountinfo.attributes.id);
            req.session.newaccount = true;
            req.session.password = genpassword;
          } else {
            // Handle error or existing account
            let accountlistjson = await fetch(
              settings.pterodactyl.domain + "/api/application/users?include=servers&filter[email]=" + encodeURIComponent(userinfo.data.email),
              {
                method: "get",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${settings.pterodactyl.key}`,
                },
              }
            );
            let accountlist = await accountlistjson.json();
            let user = accountlist.data.filter((acc) => acc.attributes.email == userinfo.data.email);
            if (user.length == 1) {
              let userid = user[0].attributes.id;
              let userids = (await db.get("users")) ? await db.get("users") : [];
              if (userids.filter((id) => id == userid).length == 0) {
                userids.push(userid);
                await db.set("users", userids);
                await db.set("users-" + userinfo.data.id, userid);
                req.session.pterodactyl = user[0].attributes;
              } else {
                return res.send("An account with your Google email already exists but is associated with a different Google account.");
              }
            } else {
              return res.send("An error has occurred when attempting to create your account. Please try a different authentication method.");
            }
          }

          // Signup notification
          let notifications = await db.get('notifications-' + userinfo.data.id) || [];
          let notification = {
            "action": "user:signup",
            "name": "User registration",
            "timestamp": new Date().toISOString()
          }

          notifications.push(notification)
          await db.set('notifications-' + userinfo.data.id, notifications)
          
          log("signup", `${userinfo.data.name} logged in to the dashboard for the first time!`);
        } else {
          return res.send("New users cannot signup currently.");
        }
      }

      let cacheaccount = await fetch(
        settings.pterodactyl.domain + "/api/application/users/" + (await db.get("users-" + userinfo.data.id)) + "?include=servers",
        {
          method: "get",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.pterodactyl.key}`,
          },
        }
      );

      if ((await cacheaccount.statusText) == "Not Found")
        return res.send("An error has occurred while attempting to get your user information.");

      let cacheaccountinfo = JSON.parse(await cacheaccount.text());
      req.session.pterodactyl = cacheaccountinfo.attributes;

      req.session.userinfo = userinfo.data;
      let theme = indexjs.get(req);

      // Auth notification
      let notifications = await db.get('notifications-' + userinfo.data.id) || [];
      let notification = {
        "action": "user:auth",
        "name": "Sign in from new location",
        "timestamp": new Date().toISOString()
      }

      notifications.push(notification)
      await db.set('notifications-' + userinfo.data.id, notifications)

      const customredirect = req.session.redirect;
      delete req.session.redirect;
      if (customredirect) return res.redirect(customredirect);
      return res.redirect(theme.settings.redirect.callback ? theme.settings.redirect.callback : "/");
    } catch (error) {
      console.error('Error during Google OAuth:', error);
      res.redirect('/login');
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