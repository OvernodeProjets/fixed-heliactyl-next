/**
    __         ___            __        __
   / /_  ___  / (_)___ ______/ /___  __/ /
  / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
/_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
                              /____/ 

*/

"use strict";

require("./app/handlers/console.js")();

const fs = require('fs');
const path = require('path');
const chalk = require("chalk");
const cluster = require("cluster");

const express = require("express");
const session = require("express-session");
const cookieParser = require('cookie-parser');
const favicon = require('serve-favicon');
const nocache = require('nocache');

const settings = require("./app/handlers/config")("./config.toml");

const VIEWS_DIR = path.join(__dirname, 'app', 'views');
const PUBLIC_DIR = path.join(__dirname, 'app', 'public');
const FAVICON_PATH = path.join(PUBLIC_DIR, 'favicon.ico');

const app = express();
require("express-ws")(app);

app.set('view engine', 'ejs');
app.set('views', VIEWS_DIR);

app.use(favicon(FAVICON_PATH));

const sessionStore = require("./app/handlers/sessionStore");
const updateManager = require('./app/handlers/updateManager');

const { renderData, getPages } = require('./app/handlers/theme');
const { consoleLogo, consoleSpin, getAllJsFiles } = require('./app/handlers/utils');
const { validateModules } = require('./app/handlers/moduleValidator');
const { startCluster } = require('./app/handlers/clusterManager');
const { i18nMiddleware } = require('./app/handlers/i18n');

global.Buffer = global.Buffer || require("buffer").Buffer;
process.emitWarning = function () { };

if (typeof btoa === "undefined") {
  global.btoa = (str) => Buffer.from(str, "binary").toString("base64");
}
if (typeof atob === "undefined") {
  global.atob = (b64Encoded) => Buffer.from(b64Encoded, "base64").toString("binary");
}

const Database = require("./db.js");
const db = new Database(settings.database);

if (cluster.isMaster) {
  consoleLogo();

  const workerId = cluster.isWorker ? "worker" : "master";
  const spinner = consoleSpin(workerId);

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

  app.use(async (err, req, res, next) => {
    try {
      const theme = await getPages();
      if (err.status === 500 && err.message === 'Gateway Timeout') {
        res.status(500).render(theme.settings.errors.internalError, { error: 'Gateway Timeout' });
      } else {
        res.status(err.status || 500).render(theme.settings.errors.internalError, { 
          error: process.env.NODE_ENV === 'production' ? 'Internal Error' : err.message 
        });
      }
    } catch (renderError) {
      res.status(500).send('Critical error');
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

  app.use(i18nMiddleware);

  const userCache = new Map();
  app.use(async (req, res, next) => {
    if (req.ws || !req.session.userinfo?.id) return next();

    const userId = req.session.userinfo.id;
    if (!userCache.has(userId)) {
      const coins = await db.get(`coins-${userId}`);
      if (coins == null) {
        await db.set('coins-' + userId, 0);
      }
      userCache.set(userId, true);
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
      try {
        await updateManager.initialize(db);
      } catch (error) {
        console.error(`[Worker ${process.pid}] Failed to initialize UpdateManager:`, error);
      }
    }
    console.log(
      chalk.white(chalk.gray("[cluster]") + " Cluster state updated: ") + chalk.green('running')
    );
    console.log(
      chalk.gray(`Heliactyl Next ${settings.version} (${settings.platform_codename}) - webserver is now listening on port ${settings.website.port}`)
    );
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(chalk.yellow(`[cluster ${process.pid}] Port ${settings.website.port} is already in use, this is normal for worker processes`));
    } else {
      console.error(chalk.red(`[cluster ${process.pid}] Error starting server:`, err));
    }
  });

  const createRateLimiter = require('./app/handlers/rateLimit.js');
  const rateLimiters = createRateLimiter();

  app.use(rateLimiters.global);
  app.use(rateLimiters.specific);

  const APIFiles = getAllJsFiles('./app/modules');
  console.log(chalk.gray(`Loading ${APIFiles.length} modules...`));

  for (const file of APIFiles) {
    const startTime = Date.now();
    try {
      const absolutePath = path.resolve(file);
      const APIFile = require(absolutePath);

      if (!APIFile.load || typeof APIFile.load !== 'function') {
        throw new Error(`⚠ Module ${file} missing load() function`); 
      }

      const router = express.Router();
      APIFile.load(router, db);

      if (path.basename(file) !== "pages.js") {
        app.use('/api', router);
      } else {
        app.use(router);
      }
      console.log(chalk.green(`✓ Loaded: ${path.basename(file)} in ${Date.now() - startTime} ms`));
    } catch (error) {
      console.error(chalk.red(`✗ CRITICAL: Failed to load ${file}:`), error);
    }
  }

  /* Log all registered routes */
  /* Uncomment to enable route logging */
  /*  
  const { collectRoutes } = require('./handlers/utils');
  const routes = collectRoutes(app);
  console.log(chalk.gray(`Registered ${routes.length} routes:`));
  routes.forEach(route => {
    console.log(chalk.gray(`- ${route}`));
  });*/

}

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