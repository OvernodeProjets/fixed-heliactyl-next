const indexjs = require("../app.js");
const ejs = require("ejs");
const express = require("express");
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const fetch = require("node-fetch");
const arciotext = require("../handlers/afk.js");

/* Ensure platform release target is met */
const heliactylModule = { "name": "Pages", "api_level": 3, "target_platform": "19.1.1" };

if (heliactylModule.target_platform !== settings.version) {
  console.log('Module ' + heliactylModule.name + ' does not support this platform release of Heliactyl. The module was built for platform ' + heliactylModule.target_platform + ' but is attempting to run on version ' + settings.version + '.')
  process.exit()
}

/* Module */
module.exports.heliactylModule = heliactylModule;
module.exports.load = async function (app, db) {
  app.all("/", async (req, res) => {
    try {
      if (
        req.session.pterodactyl &&
        req.session.pterodactyl.id !==
          (await db.get("users-" + req.session.userinfo.id))
      ) {
        return res.redirect("/login?prompt=none");
      }

      let theme = indexjs.get(req);
      if (
        theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname) &&
        (!req.session.userinfo || !req.session.pterodactyl)
      ) {
        return res.redirect("/login");
      }

      if (theme.settings.mustbeadmin.includes(req._parsedUrl.pathname)) {
        const renderData = await indexjs.renderdataeval(req, theme);
        res.render(theme.settings.index, renderData);
        return;
      }

      const renderDataPromise = indexjs.renderdataeval(req, theme);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Database Failure')), 3000)
      );

      try {
        const renderData = await Promise.race([renderDataPromise, timeoutPromise]);
        res.render(theme.settings.index, renderData);
      } catch (error) {
        if (error.message === 'Database Failure') {
          res.status(500).render("500.ejs", { err: 'Database Failure' });
        } else {
          throw error;
        }
      }
    } catch (err) {
      console.log(err);
      res.status(500).render("500.ejs", { err });
    }
  });

  app.use("/assets", express.static("./assets"));
};