/**
 *      __         ___            __        __
 *     / /_  ___  / (_)___ ______/ /___  __/ /
 *    / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 *   / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
 *  /_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
 *                               /____/      
 * 
 *     Heliactyl Next 3.2.0 (Avalanche)
 */

const heliactylModule = {
  "name": "Pages Module",
  "target_platform": "3.2.0"
};
module.exports.heliactylModule = heliactylModule;

const { getPages, renderData } = require("../handlers/theme.js");
const express = require("express");
const path = require("path");
const fs = require("fs");

module.exports.load = async function (app, db) {
  app.all("*", async (req, res, next) => {
    try {
      if (
        req.path.startsWith("/api") ||
        req.path.startsWith("/assets") ||
        req.path.startsWith("/public") ||
        req.path.startsWith("/cdn")
      ) {
        return next();
      }

      if (
        req.session.pterodactyl &&
        req.session.pterodactyl.id !==
        (await db.get("users-" + req.session.userinfo.id))
      ) {
        req.session.destroy();
        return res.redirect("/auth?prompt=none");
      }

      const theme = await getPages(req);
      const settings = require("../handlers/config")("./config.toml");

      if (req.session.userinfo) {
        const banData = (await db.get(`ban-${req.session.userinfo.id}`)) || null;
        if (banData) {
          return res.render(theme.settings.errors.banned, {
            settings,
            banReason: banData.reason,
            banExpiration: banData.expiration
          });
        }
      }

      if (req.path === "/auth" && req.session.pterodactyl && req.session.userinfo) {
        return res.redirect("/dashboard");
      }

      if (theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname)) {
        if (!req.session.userinfo || !req.session.pterodactyl) {
          return res.redirect("/auth");
        }
      }

      if (Array.isArray(theme.settings.mustbeadmin) && theme.settings.mustbeadmin.includes(req._parsedUrl.pathname)) {
        const data = await renderData(req, theme, db);

        if (!req.session.userinfo || !req.session.pterodactyl.root_admin) {
          const notFound = theme.settings.errors.notFound || '404';
          return res.status(404).render(notFound, data);
        }

        const pageName = req._parsedUrl.pathname.slice(1);
        const pageToRender = theme.settings.pages && theme.settings.pages[pageName];
        if (typeof pageToRender === 'string' && pageToRender.length > 0) {
          return res.render(pageToRender, data);
        } else {
          const notFound = theme.settings.errors.notFound || '404';
          return res.status(404).render(notFound, data);
        }
      }

      let pageName = req._parsedUrl.pathname.slice(1);
      const data = await renderData(req, theme, db);

      if (pageName === "" || pageName === "/") {
        return res.render(theme.settings.index, data);
      }

      const pageToRender = theme.settings.pages[pageName];
      if (pageToRender) {
        res.render(pageToRender, data);
      } else {
        res.status(404).render(theme.settings.errors.notFound, data);
      }

    } catch (err) {
      console.error(err);
      const theme = await getPages(req);
      res.status(500).render(theme.settings.errors.internalError, { error: err });
    }
  });

  const PUBLIC_DIR = path.join(__dirname, 'app', 'public');
  if (fs.existsSync(PUBLIC_DIR)) {
    const staticOptions = {
      maxAge: '1d',
      immutable: true
    };

    app.use(express.static(PUBLIC_DIR, staticOptions));
    app.use('/assets', express.static(PUBLIC_DIR, staticOptions));
  }
};