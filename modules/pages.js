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
  "name": "Pages Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const { getPages, renderData } = require("../handlers/theme.js");
const express = require("express");
const path = require("path");

module.exports.load = async function (app, db) {
  app.all("/", async (req, res) => {
    try {
      if (
        req.session.pterodactyl &&
        req.session.pterodactyl.id !==
          (await db.get("users-" + req.session.userinfo.id))
      ) {
        req.session.destroy();
        return res.redirect("/auth?prompt=none");
      }

      let theme = await getPages(req);

      if (
        theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname) &&
        (!req.session.userinfo || !req.session.pterodactyl)
      ) {
        return res.redirect("/auth");
      }

      if (theme.settings.mustbeadmin.includes(req._parsedUrl.pathname)) {
        const renderData = await renderData(req, theme, db);
        res.render(theme.settings.index, renderData);
        return;
      }

      const renderDataPromise = renderData(req, theme, db);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Database Failure')), 3000)
      );

      try {
        const renderData = await Promise.race([renderDataPromise, timeoutPromise]);
        res.render(theme.settings.index, renderData);
      } catch (error) {
        if (error.message === 'Database Failure') {
          res.status(500).render(theme.settings.errors.internalError, { error: 'Database Failure' });
        } else {
          throw error;
        }
      }
    } catch (err) {
      console.log(err);
      res.status(500).render(theme.settings.errors.internalError, { error: err });
    }
  });
  
  app.use('/assets', express.static(path.join(__dirname, '../assets')));
};