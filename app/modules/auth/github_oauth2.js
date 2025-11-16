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
  "name": "GitHub OAuth2 Module",
  "target_platform": "3.2.1-beta.1"
};

module.exports.heliactylModule = heliactylModule;

const crypto = require('crypto');
const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const getPteroUser = require('../../handlers/getPteroUser.js');

const fetch = require("node-fetch");
const { discordLog, addNotification } = require("../../handlers/log");
const { getPages } = require("../../handlers/theme.js");

// todo : implement that in frontend and review code 
module.exports.load = async function (router, db) {
  router.get("/github/login", (req, res) => {
    if (req.query.redirect) req.session.redirect = "/" + req.query.redirect;
    
    const loginAttemptId = crypto.randomBytes(16).toString('hex');
    res.cookie('loginAttempt', loginAttemptId, { httpOnly: true, maxAge: 5 * 60 * 1000 });

    if (settings.api.client.oauth2.github.enable == false) return res.redirect("/auth");
    
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${settings.api.client.oauth2.github.id}&redirect_uri=${encodeURIComponent(`${settings.website.domain}/auth/github/callback`)}&scope=read:user,user:email`;
    res.redirect(authUrl);
  });

  router.get(settings.api.client.oauth2.github.callbackpath.replace(/^\/api/, ''), async (req, res) => {
    if (!req.query.code) return res.redirect(`/auth`);

    if (settings.api.client.oauth2.github.enable == false) return res.redirect("/auth");

    const loginAttemptId = req.cookies.loginAttempt;

    res.clearCookie('loginAttempt');

    try {
      // Exchange code for access token
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          client_id: settings.api.client.oauth2.github.id,
          client_secret: settings.api.client.oauth2.github.secret,
          code: req.query.code,
          redirect_uri: settings.api.client.oauth2.github.callback
        })
      });

      const tokenData = await tokenResponse.json();
      if (!tokenData.access_token) {
        throw new Error('Failed to obtain access token');
      }

      // Fetch user data
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${tokenData.access_token}`,
          'Accept': 'application/json'
        }
      });

      const userinfo = await userResponse.json();

      // Fetch user email
      const emailResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `token ${tokenData.access_token}`,
          'Accept': 'application/json'
        }
      });

      const emails = await emailResponse.json();
      const primaryEmail = emails.find(email => email.primary);

      if (settings.whitelist.status && !settings.whitelist.users.includes(userinfo.id.toString())) {
        return res.send("Service is under maintenance.");
      }

      const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
      if (settings.api.client.oauth2.ip.block.includes(ip)) {
        return res.send(
          "You could not sign in, because your IP has been blocked from signing in."
        );
      }

      // Set a cookie with the user's ID
      res.cookie('userId', userinfo.id.toString(), { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });

      if (settings.api.client.oauth2.ip["duplicate check"] == true) {
        const userIP = await db.get(`ipuser-${ip}`);
        const bypassFlag = await db.get(`antialt-bypass-${userinfo.id}`) || false;
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

      if (!(await db.get("users-" + userinfo.id))) {
        if (settings.api.client.allow.new_users) {
        const genpassword = settings.api.client.passwordgenerator.signup
          ? makeid(settings.api.client.passwordgenerator["length"])
          : makeid(16);
          
          let accountjson = await fetch(
            settings.pterodactyl.domain + "/api/application/users",
            {
              method: "post",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${settings.pterodactyl.key}`,
              },
              body: JSON.stringify({
                username: userinfo.login,
                email: primaryEmail.email,
                first_name: userinfo.name ? userinfo.name.split(' ')[0] : userinfo.login,
                last_name: userinfo.name ? userinfo.name.split(' ').slice(1).join(' ') : '',
                password: genpassword,
              }),
            }
          );

          if ((await accountjson.status) == 201) {
            let accountinfo = JSON.parse(await accountjson.text());
            let userids = (await db.get("users")) ? await db.get("users") : [];
            userids.push(accountinfo.attributes.id);
            await db.set("users", userids);
            await db.set("users-" + userinfo.id, accountinfo.attributes.id);
            req.session.newaccount = true;
            req.session.password = genpassword;
          } else {
            // Handle error or existing account
            let accountlistjson = await fetch(
              settings.pterodactyl.domain + "/api/application/users?include=servers&filter[email]=" + encodeURIComponent(primaryEmail.email),
              {
                method: "get",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${settings.pterodactyl.key}`,
                },
              }
            );
            let accountlist = await accountlistjson.json();
            let user = accountlist.data.filter((acc) => acc.attributes.email == primaryEmail.email);
            if (user.length == 1) {
              let userid = user[0].attributes.id;
              let userids = (await db.get("users")) ? await db.get("users") : [];
              if (userids.filter((id) => id == userid).length == 0) {
                userids.push(userid);
                await db.set("users", userids);
                await db.set("users-" + userinfo.id, userid);
                req.session.pterodactyl = user[0].attributes;
              } else {
                return res.send("An account with your GitHub email already exists but is associated with a different GitHub account.");
              }
            } else {
              return res.send("An error has occurred when attempting to create your account.");
            }
          }

          await addNotification(
            db,
            userinfo.id,
            "user:sign-in",
            "Sign in from new account created with GitHub OAuth2",
            req.ip
          );

          discordLog("sign in", `${userinfo.login} signed in to the dashboard with GitHub!`);
        } else {
          return res.send("New users cannot sign up currently.");
        }
      }

      const PterodactylUser = await getPteroUser(userinfo.id, db);
      if (!PterodactylUser) {
          res.send("An error has occurred while attempting to update your account information and server list.");
          return;
      }

      req.session.pterodactyl = PterodactylUser.attributes;

      req.session.userinfo = {
        ...userinfo,
        username: userinfo.login,
        global_name: userinfo.login,
        id: userinfo.id.toString(),
        email: primaryEmail.email
      };

      await addNotification(
        db,
        userinfo.id,
        "user:sign-in",
        "Sign in from new location",
        req.ip
      );

      discordLog("sign up", `${userinfo.login} logged in to the dashboard with GitHub!`);

      const customredirect = req.session.redirect;
      delete req.session.redirect;
      if (customredirect) return res.redirect(customredirect);
      return res.redirect("/dashboard");
    } catch (error) {
      console.error('Error during GitHub OAuth:', error);
      res.redirect('/auth');
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