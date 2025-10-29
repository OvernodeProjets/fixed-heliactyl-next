/**
 
Heliactyl Next - Avalanche

    __         ___            __        __
   / /_  ___  / (_)___ ______/ /___  __/ /
  / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
/_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
                              /____/ 

*/

"use strict";

require("./handlers/console.js")();

const fs = require("fs");
const path = require('path');
const chalk = require("chalk");
const cluster = require("cluster");

const express = require("express");
const session = require("express-session");
const cookieParser = require('cookie-parser');
const nocache = require('nocache');

const app = express();
require("express-ws")(app);

const sessionStore = require("./handlers/sessionStore");

const { renderData, getPages } = require('./handlers/theme');
const { getAllJsFiles } = require('./handlers/utils');
const { validateModules } = require('./handlers/moduleValidator');
const { startCluster } = require('./handlers/clusterManager');

const { collectRoutes } = require('./handlers/utils');

global.Buffer = global.Buffer || require("buffer").Buffer;
process.emitWarning = function () { };

if (typeof btoa === "undefined") {
  global.btoa = (str) => Buffer.from(str, "binary").toString("base64");
}
if (typeof atob === "undefined") {
  global.atob = (b64Encoded) => Buffer.from(b64Encoded, "base64").toString("binary");
}

// Load settings.
const loadConfig = require("./handlers/config");
const settings = loadConfig("./config.toml");

// Load database
const Database = require("./db.js");
const db = new Database(settings.database);
module.exports.db = db;

if (cluster.isMaster) {
  const asciiArt = fs.readFileSync('./handlers/ascii.txt', 'utf8');
  console.log('\n' + asciiArt + '\n');

  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let currentFrame = 0;
  const workerId = cluster.isWorker ? "worker" : "master";
  const prefix = chalk.gray.bold(`${workerId}   │   `);

  const spinner = setInterval(() => {
    process.stdout.write('\r' + prefix + chalk.gray(spinnerFrames[currentFrame++] + ' Initializing Graphene...'));
    currentFrame %= spinnerFrames.length;
  }, 100);

  setTimeout(() => {
    clearInterval(spinner);
    process.stdout.write('\r');
    validateModules(settings);
    startCluster(settings, db);
  }, 2000); // Simulate loading time, just for fun ?
} else {
  // Worker process
  if (cluster.worker.id === 1) {
    console.log(chalk.cyan(`Worker ${process.pid} is designated as the first worker.`));
    console.log(
      chalk.gray(`Heliactyl Next ${settings.version} (${settings.platform_codename}) - webserver is now listening on port ${settings.website.port}`)
    );
  }

  // Send ready message to master when worker is ready
  if (process.send) {
    process.send({ type: 'WORKER_READY', pid: process.pid });
  }

  // Store the original setInterval
  const originalSetInterval = global.setInterval;

  // Create a wrapper function for setInterval
  global.clusterSafeInterval = function (callback, delay) {
    if (cluster.worker.id === 1) {
      return originalSetInterval(callback, delay);
    } else {
      // Return a dummy interval object for non-first workers
      return {
        unref: () => { },
        ref: () => { },
        close: () => { }
      };
    }
  };

  // Replace the global setInterval with our cluster-safe version
  global.setInterval = global.clusterSafeInterval;

  // Load the website.
  module.exports.app = app; // ??? why here

  app.set('view engine', 'ejs');
  app.set('trust proxy', true);

  app.use(cookieParser());
  app.use(express.text());
  app.use(nocache());



  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    res.setHeader('Access-Control-Allow-Origin', '*');

    res.setHeader("X-Powered-By", `13rd Gen Heliactyl Next (${settings.platform_codename})`);
    res.setHeader("X-Heliactyl", `Heliactyl Next v${settings.version} - "${settings.platform_codename}"`);
    next();
  });

  app.use((err, req, res, next) => {
    if (err.status === 500 && err.message === 'Gateway Timeout') {
      const theme = getPages();
      res.status(500).render(theme.settings.internalError, { error: 'Gateway Timeout' });
      return;
    } else {
      next(err);
      return;
    }
  });

  app.use(
    session({
      store: sessionStore,
      secret: settings.website.secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: settings.website.domain.startsWith('https') ? true : false,
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
      }
    })
  );

  app.use(
    express.json({
      inflate: true,
      limit: "500kb",
      reviver: null,
      strict: true,
      type: "application/json",
      verify: undefined,
    })
  );

  app.use(async (req, res, next) => {
    if (req.ws) {
      // Skip session handling for WebSocket connections
      return next();
    }

    // Check if user is logged in and not accessing the /banned route
    if (req.session.userinfo?.id) {
      const userId = req.session.userinfo.id;
      const coinsKey = await db.get(`coins-${userId}`);

      if (coinsKey == null) {
        await db.set('coins-' + userId, 0);
      }
    }

    next();
  });


  const listener = app.listen(settings.website.port, async function () {
    /* clear all afk sessions */
    if (cluster.worker.id === 1) {
      await db.set('afkSessions', {});
      const keys = await db.list('afk_session-*');
      for (const key of keys) {
        await db.delete(key);
      }
      console.log(
        chalk.white(chalk.gray('[cluster]') + " Cleared all AFK sessions on startup.")
      );
    }
    console.log(
      chalk.white(chalk.gray("[cluster]") + " Cluster state updated: ") + chalk.green('running')
    );
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(chalk.yellow(`[cluster ${process.pid}] Port ${settings.website.port} is already in use, this is normal for worker processes`));
    } else {
      console.error(chalk.red(`[cluster ${process.pid}] Error starting server:`, err));
    }
  });

  const createRateLimiter = require('./handlers/rateLimit.js');
  const rateLimiters = createRateLimiter();

  app.use(rateLimiters.global);
  app.use(rateLimiters.specific);

  const APIFiles = getAllJsFiles('./modules');
  console.log(chalk.gray(`Loading ${APIFiles.length} modules...`));

  for (const file of APIFiles) {
    try {
      const absolutePath = path.resolve(file);
      const APIFile = require(absolutePath);

      if (APIFile.load && typeof APIFile.load === 'function') {
        APIFile.load(app, db);
        console.log(chalk.green(`✓ Loaded: ${path.basename(file)}`));
      } else {
        console.warn(`⚠ Module ${file} does not export a load function`);
      }
    } catch (error) {
      console.error(`✗ Failed to load ${file}:`, error.message);
    }
  }

  /* Log all registered routes */
  /* Uncomment to enable route logging */
  /*
  const routes = collectRoutes(app);
  console.log(chalk.gray(`Registered ${routes.length} routes:`));
  routes.forEach(route => {
    console.log(chalk.gray(`- ${route}`));
  });*/

  app.all("*", async (req, res) => {
    // Validate session
    if (
      req.session.pterodactyl &&
      req.session.pterodactyl.id !==
      (await db.get("users-" + req.session.userinfo.id))
    ) {
      req.session.destroy();
      return res.redirect("/auth?prompt=none");
    }

    const theme = await getPages();
    //console.dir(theme, { depth: null, colors: true });

    // Check if user is banned
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

    // Redirect already logged in users away from auth page
    if (req.path === "/auth" && req.session.pterodactyl && req.session.userinfo) {
      return res.redirect("/dashboard");
    }

    // AFK session token
    if (settings.api.afk.enabled === true) {
      req.session.arcsessiontoken = Math.random().toString(36).substring(2, 15);
    }

    // Check authentication requirements
    if (theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname)) {
      if (!req.session.userinfo || !req.session.pterodactyl) {
        return res.redirect("/auth");
      }
    }

    // Check admin requirements
    if (Array.isArray(theme.settings.mustbeadmin) && theme.settings.mustbeadmin.includes(req._parsedUrl.pathname)) {
      const data = await renderData(req, theme);

      // Not admin -> show forbidden
      if (!req.session.userinfo || !req.session.pterodactyl.root_admin) {
        const notFound = theme.settings.errors.notFound || '404';
        res.status(404).render(notFound, data);
        return;
      }

      // Admin -> render the requested admin page 
      const pageName = req._parsedUrl.pathname.slice(1);
      const pageToRender = theme.settings.pages && theme.settings.pages[pageName];
      if (typeof pageToRender === 'string' && pageToRender.length > 0) {
        res.render(pageToRender, data);
      } else {
        // fallback to notFound if page not configured
        const notFound = theme.settings.errors.notFound || '404';
        res.status(404).render(notFound, data);
      }
      return;
    }

    const pageName = req._parsedUrl.pathname.slice(1);
    const pageToRender = theme.settings.pages[pageName];

    const data = await renderData(req, theme);

    if (pageToRender) {
      res.render(pageToRender, data);
    } else {
      res.status(404).render(theme.settings.errors.notFound, data);
    }
  });

  /* Une horreur !!
  module.exports.ratelimits = async function (length) {
    const indexjs = require("./app.js");
    if (cache == true) return setTimeout(indexjs.ratelimits, 1);
    cache = true;
    setTimeout(async () => {
      cache = false;
    }, length * 1000);
  };*/
};

function shimPromiseWithStackCapture() {
  const originalPromise = global.Promise;
  const captureStack = () => new Error().stack;

  function PromiseWithStack(executor) {
    const stack = captureStack();
    return new originalPromise((resolve, reject) => {
      return executor(resolve, (reason) => {
        if (reason instanceof Error) {
          if (!reason.stack) {
            reason.stack = stack;
          }
        } else {
          const err = new Error(reason);
          err.stack = stack;
          reject(err);
          return;
        }
        reject(reason);
      });
    });
  }

  PromiseWithStack.prototype = originalPromise.prototype;
  PromiseWithStack.all = originalPromise.all;
  PromiseWithStack.race = originalPromise.race;
  PromiseWithStack.resolve = originalPromise.resolve;
  PromiseWithStack.reject = originalPromise.reject;

  global.Promise = PromiseWithStack;
};

shimPromiseWithStackCapture();

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:');
  console.error(promise);
  console.error('Reason:');
  console.error(reason);
});