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
  "name": "Discord OAuth2 Module",
  "target_platform": "3.2.2"
};

module.exports.heliactylModule = heliactylModule;

"use strict";

const crypto = require('crypto');
const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const getPteroUser = require("../../handlers/getPteroUser.js");

if (settings?.api?.client?.oauth2?.link?.endsWith("/")) {
  settings.api.client.oauth2.link = settings.api.client.oauth2.link.slice(0, -1);
}

if (settings?.api?.client?.oauth2?.callbackpath?.slice(0, 1) !== "/") {
  settings.api.client.oauth2.callbackpath = "/" + settings.api.client.oauth2.callbackpath;
}

if (settings?.pterodactyl?.domain?.endsWith("/")) {
  settings.pterodactyl.domain = settings.pterodactyl.domain.slice(0, -1);
}

const fetch = require("node-fetch");
const { discordLog, addNotification } = require("../../handlers/log.js");
const { getPages } = require("../../handlers/theme.js");

const { getAppAPI } = require('../../handlers/pterodactylSingleton.js');

module.exports.load = async function (router, db) {
  const AppAPI = getAppAPI();
  router.get("/discord/login", async (req, res) => {
    if (req.query.redirect) req.session.redirect = "/" + req.query.redirect;
    
    // Generate a unique identifier for this login attempt
    const loginAttemptId = crypto.randomBytes(16).toString('hex');
    res.cookie('loginAttempt', loginAttemptId, { httpOnly: true, maxAge: 5 * 60 * 1000 }); // 5 minutes expiry
    
    res.redirect(
      `https://discord.com/api/oauth2/authorize?client_id=${
        settings.api.client.oauth2.id
      }&redirect_uri=${encodeURIComponent(
        settings.api.client.oauth2.link +
          settings.api.client.oauth2.callbackpath
      )}&response_type=code&scope=identify%20email${
        settings.api.client.bot.joinguild.enabled == true
          ? "%20guilds.join"
          : ""
      }${settings.api.client.j4r.enabled == true ? "%20guilds" : ""}${
        settings.api.client.oauth2.prompt == false
          ? "&prompt=none"
          : req.query.prompt
          ? req.query.prompt == "none"
            ? "&prompt=none"
            : ""
          : ""
      }`
    );
    return;
  });

router.get("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error("Error during session destruction:", err);
      return res.status(500).send("Error during logout.");
    }
    res.redirect("/");
    return;
  });
});

  router.get(settings.api.client.oauth2.callbackpath.replace(/^\/api/, ''), async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect(`/auth?error=missing_code`);

    // Check if the loginAttempt cookie exists
    const loginAttemptId = req.cookies.loginAttempt;
    if (!loginAttemptId) {
      return res.send("Invalid login attempt. Please try again.");
    }

    // Clear the loginAttempt cookie
    res.clearCookie('loginAttempt');

    res.send(`
    <!doctype html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Please wait...</title>
      <style>
      body{margin:0;background:#05050e;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Whitney,system-ui,-apple-system,sans-serif}
      @keyframes spin{to{transform:rotate(360deg)}}
      .spinner{animation:spin 1s linear infinite;width:2rem;height:2rem;color:#fff}
      </style>
    </head>
    <body>
      <svg class="spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle opacity=".25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path opacity=".75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
      </svg>
    <script>
    history.pushState(null,'Logging in...','/auth');
    location.replace('/api/submitlogin?code=${encodeURIComponent(
      code.replace(/'/g, "")
    )}');
    </script>
    </body>
    </html>
    `);
  });

  router.get(`/submitlogin`, async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send("Missing code.");

    let customredirect = req.session.redirect;
    delete req.session.redirect;

    let json = await fetch("https://discord.com/api/oauth2/token", {
      method: "post",
      body:
        "client_id=" +
        settings.api.client.oauth2.id +
        "&client_secret=" +
        settings.api.client.oauth2.secret +
        "&grant_type=authorization_code&code=" +
        encodeURIComponent(code) +
        "&redirect_uri=" +
        encodeURIComponent(
          settings.api.client.oauth2.link +
            settings.api.client.oauth2.callbackpath
        ),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!json.ok) {
      res.redirect(`/auth?error=token_error`);
      return;
    }
      let codeinfo = JSON.parse(await json.text());
      let scopes = codeinfo.scope;
      let missingscopes = [];

      if (scopes.replace(/identify/g, "") == scopes)
        missingscopes.push("identify");
      if (scopes.replace(/email/g, "") == scopes) missingscopes.push("email");
      if (settings.api.client.bot.joinguild.enabled == true)
        if (scopes.replace(/guilds.join/g, "") == scopes)
          missingscopes.push("guilds.join");
      if (settings.api.client.j4r.enabled)
        if (scopes.replace(/guilds/g, "") == scopes)
          missingscopes.push("guilds");
      if (missingscopes.length !== 0)
        return res.send("Missing scopes: " + missingscopes.join(", "));
      let userjson = await fetch("https://discord.com/api/users/@me", {
        method: "get",
        headers: {
          Authorization: `Bearer ${codeinfo.access_token}`,
        },
      });
      let userinfo = JSON.parse(await userjson.text());

      if (settings.whitelist.status && !settings.whitelist.users.includes(userinfo.id)) {
        return res.send("Service is under maintenance.");
      }

      let guildsjson = await fetch("https://discord.com/api/users/@me/guilds", {
        method: "get",
        headers: {
          Authorization: `Bearer ${codeinfo.access_token}`,
        },
      });
      let guildsinfo = await guildsjson.json();
      if (userinfo.verified == true) {
          const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
        if (settings.api.client.oauth2.ip.block.includes(ip))
          return res.send(
            "You could not sign in, because your IP has been blocked from signing in."
          );

      // Set a cookie with the user's ID
      res.cookie('userId', userinfo.id, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 }); // 30 days expiry

      if (settings.api.client.oauth2.ip["duplicate check"] == true && ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1" && !ip.startsWith("192.168.")) {
        const userIP = await db.get(`ipuser-${ip}`);
        const bypassFlag = await db.get(`antialt-bypass-${userinfo.id}`) || false;
        
        // Check if the IP is associated with a banned account
        if (userIP && userIP !== userinfo.id) {
          const linkedUserBanStatus = await db.get(`ban-${userIP}`);
          if (linkedUserBanStatus) {
            // Auto-ban the current user if their IP is linked to a banned account
            const banData = {
              reason: `Auto-banned: IP linked to banned account (${userIP})`,
              expiration: null,
              bannedAt: new Date().toISOString(),
              bannedBy: 'system-antialt'
            };
            
            await db.set(`ban-${userinfo.id}`, banData);
            
            // Add to ban history
            const banHistory = (await db.get(`banHistory-${userinfo.id}`)) || [];
            banHistory.push(banData);
            await db.set(`banHistory-${userinfo.id}`, banHistory);
            
            await discordLog(
              "anti-alt",
              `User ID: \`${userinfo.id}\` was AUTO-BANNED because their IP is linked to banned account: \`${userIP}\`.`,
              [
                { name: "IP Address", value: ip, inline: true },
                { name: "Linked Banned User", value: userIP, inline: true }
              ],
              false
            );
            
            const theme = await getPages();
            return res.status(500).render(theme.settings.errors.banned, {
              settings,
              reason: `Your account has been automatically banned because your IP is linked to a banned account.`
            });
          }
        }
        
        if (userIP && userIP !== userinfo.id && !bypassFlag) {
          // Send webhook notifications
          await discordLog(
            "anti-alt",
            `User ID: \`${userinfo.id}\` attempted to login from an IP associated with another user ID: \`${userIP}\`.`,
            [
              { name: "IP Address", value: ip, inline: true },
              { name: "Alt User ID", value: userIP, inline: true }
            ],
            false
          );
          
          await discordLog(
            "anti-alt",
            `<@${userinfo.id}> attempted to login from an IP associated with another user ID: <@${userIP}>.`,
            [],
            true
          );
          
          const theme = await getPages();
          return res.status(500).render(theme.settings.errors.antialt);
        } else if (!userIP) {
          await db.set(`ipuser-${ip}`, userinfo.id);
        }
      }

        if (settings.api.client.j4r.enabled) {
          if (guildsinfo.message == "401: Unauthorized")
            return res.send(
              "Please allow us to know what servers you are in to let the J4R system work properly. <a href='/auth'>Login again</a>"
            );
          let userj4r = (await db.get(`j4rs-${userinfo.id}`)) ?? [];
          await guildsinfo;

          let coins = (await db.get(`coins-${userinfo.id}`)) ?? 0;

          // Checking if the user has completed any new j4rs
          for (const guild of settings.api.client.j4r.ads) {
            if (
              guildsinfo.find((g) => g.id === guild.id) &&
              !userj4r.find((g) => g.id === guild.id)
            ) {
              userj4r.push({
                id: guild.id,
                coins: guild.coins,
              });
              coins += guild.coins;
            }
          }

          // Checking if the user has left any j4r servers
          for (const j4r of userj4r) {
            if (!guildsinfo.find((g) => g.id === j4r.id)) {
              userj4r = userj4r.filter((g) => g.id !== j4r.id);
              coins -= j4r.coins;
            }
          }

          await db.set(`j4rs-${userinfo.id}`, userj4r);
          await db.set(`coins-${userinfo.id}`, coins);
        }

        if (settings.api.client.bot.joinguild.enabled == true) {
          if (typeof settings.api.client.bot.joinguild.guildid == "string") {
            await fetch(
              `https://discord.com/api/guilds/${settings.api.client.bot.joinguild.guildid}/members/${userinfo.id}`,
              {
                method: "put",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bot ${settings.api.client.bot.token}`,
                },
                body: JSON.stringify({
                  access_token: codeinfo.access_token,
                }),
              }
            );
          } else if (
            typeof settings.api.client.bot.joinguild.guildid == "object"
          ) {
            if (Array.isArray(settings.api.client.bot.joinguild.guildid)) {
              for (let guild of settings.api.client.bot.joinguild.guildid) {
                await fetch(
                  `https://discord.com/api/guilds/${guild}/members/${userinfo.id}`,
                  {
                    method: "put",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bot ${settings.api.client.bot.token}`,
                    },
                    body: JSON.stringify({
                      access_token: codeinfo.access_token,
                    }),
                  }
                );
              }
            } else {
              return res.send(
                "api.client.bot.joinguild.guildid is not an array not a string."
              );
            }
          } else {
            return res.send(
              "api.client.bot.joinguild.guildid is not an array not a string."
            );
          }
        }

        //give role on login
        if (settings.api.client.bot.giverole.enabled == true) {
          if (
            typeof settings.api.client.bot.giverole.guildid == "string" &&
            typeof settings.api.client.bot.giverole.roleid == "string"
          ) {
            await fetch(
              `https://discord.com/api/guilds/${settings.api.client.bot.giverole.guildid}/members/${userinfo.id}/roles/${settings.api.client.bot.giverole.roleid}`,
              {
                method: "put",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bot ${settings.api.client.bot.token}`,
                },
              }
            );
          } else {
            return res.send(
              "api.client.bot.giverole.guildid or roleid is not a string."
            );
          }
        }

        // Applying role packages
        if (settings.api.client.packages.rolePackages.roles) {
          const member = await fetch(
            `https://discord.com/api/v9/guilds/${settings.api.client.packages.rolePackages.roleServer}/members/${userinfo.id}`,
            {
              headers: {
                Authorization: `Bot ${settings.api.client.bot.token}`,
              },
            }
          );
          const memberinfo = await member.json();
          if (memberinfo.user) {
            const currentpackage = await db.get(`package-${userinfo.id}`);
            if (
              Object.values(
                settings.api.client.packages.rolePackages.roles
              ).includes(currentpackage)
            ) {
              for (const rolePackage of Object.keys(
                settings.api.client.packages.rolePackages.roles
              )) {
                if (
                  settings.api.client.packages.rolePackages.roles[
                    rolePackage
                  ] === currentpackage
                ) {
                  if (!memberinfo.roles.includes(rolePackage)) {
                    await db.set(
                      `package-${userinfo.id}`,
                      settings.api.client.packages.default
                    );
                  }
                }
              }
            }
            for (const role of memberinfo.roles) {
              if (settings.api.client.packages.rolePackages.roles[role]) {
                await db.set(
                  `package-${userinfo.id}`,
                  settings.api.client.packages.rolePackages.roles[role]
                );
              }
            }
          }
        }

        if (!(await db.get("users-" + userinfo.id))) {
          if (!settings.api.client.allow.new_users) {
            return res.send("New users cannot signup currently.");
          }
        const genpassword = settings.api.client.passwordgenerator.signup
          ? makeid(settings.api.client.passwordgenerator["length"])
          : makeid(16);
            try {
              let accountinfo = await AppAPI.createUser({
                  username: userinfo.id,
                  email: userinfo.email,
                  first_name: userinfo.username,
                  last_name: "On Heliactyl",
                  password: genpassword,
              });

              let userids = (await db.get("users"))
                ? await db.get("users")
                : [];
              userids.push(accountinfo.attributes.id);
              await db.set("users", userids);
              await db.set("users-" + userinfo.id, accountinfo.attributes.id);
              req.session.newaccount = true;
              req.session.password = genpassword;
            } catch (error) {
              let accountlist = await AppAPI.listUsers({
                  include: 'servers',
                  'filter[email]': userinfo.email
              });
              
              let user = accountlist.data.filter(
                (acc) => acc.attributes.email == userinfo.email
              );
              if (user.length == 1) {
                let userid = user[0].attributes.id;
                let userids = (await db.get("users"))
                  ? await db.get("users")
                  : [];
                if (userids.filter((id) => id == userid).length == 0) {
                  userids.push(userid);
                  await db.set("users", userids);
                  await db.set("users-" + userinfo.id, userid);
                  req.session.pterodactyl = user[0].attributes;
                } else {
                  return res.send(
                    "We have detected an account with your Discord email on it but the user id has already been claimed on another Discord account."
                  );
                }
              } else {
                return res.send(
                  "An error has occured when attempting to create your account."
                );
              }
            }

            await addNotification(
              db,
              userinfo.id,
              "user:sign-in",
              "Sign in from new account created with Discord OAuth2",
              req.ip,
              req.headers['user-agent']
            );
            
            discordLog(
              "sign in",
              `${userinfo.username} signed in with Discord!`
            );
        }

        const PterodactylUser = await getPteroUser(userinfo.id, db);
        if (!PterodactylUser) {
            res.send("An error has occurred while attempting to update your account information and server list.");
            return;
        }
        
        req.session.pterodactyl = PterodactylUser.attributes;
        req.session.userinfo = userinfo;

        await addNotification(
          db,
          userinfo.id,
          "user:sign-in",
          "Sign in from new location",
          req.ip,
          req.headers['user-agent']
        );

        discordLog(
          "sign up",
          `${userinfo.username} logged in to the dashboard with Discord!`
        );

        if (customredirect) return res.redirect(customredirect);
        return res.redirect(
          "/dashboard"
        );
      }
      res.send(
        "Not verified a Discord account. Please verify the email on your Discord account."
      );
  });
};

function makeid(length) {
  let result = "";
  let characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}