/**
 
Heliactyl Next - Avalanche

*/

"use strict";

// Load logging.
require("./handlers/console.js")();

// Load packages.
const fs = require("fs");
const chalk = require("chalk");
const cluster = require("cluster");
const chokidar = require('chokidar');

global.Buffer = global.Buffer || require("buffer").Buffer;
process.emitWarning = function() {};

if (typeof btoa === "undefined") {
  global.btoa = (str) => Buffer.from(str, "binary").toString("base64");
}
if (typeof atob === "undefined") {
  global.atob = (b64Encoded) => Buffer.from(b64Encoded, "base64").toString("binary");
}

// Load settings.
const loadConfig = require("./handlers/config");
const settings = loadConfig("./config.toml");

/**
 * Renders data for the theme.
 * @param {Object} req - The request object.
 * @param {Object} theme - The theme object.
 * @returns {Promise<Object>} The rendered data.
 */
async function renderData(req, theme) {
  let userinfo = req.session.userinfo;
  let userId = userinfo ? userinfo.id : null;
  let packageId = userId ? await db.get("package-" + userId) || settings.api.client.packages.default : null;
  let extraresources = userId ? await db.get("extra-" + userId) || { ram: 0, disk: 0, cpu: 0, servers: 0 } : null;
  let coins = settings.api.client.coins.enabled && userId ? await db.get("coins-" + userId) || 0 : null;
  let plesk = userId ? await db.get("plesk-" + userId) || null : null;

  let renderdata = {
    req,
    settings,
    userinfo,
    packagename: packageId,
    extraresources,
    packages: userId ? settings.api.client.packages.list[packageId] : null,
    coins,
    plesk,
    pterodactyl: req.session.pterodactyl,
    extra: theme.settings.variables,
    db
  };

  return renderdata;
}

module.exports.renderData = renderData;

// Load database
const Database = require("./db.js");
const db = new Database(settings.database);
module.exports.db = db;

function getAllJsFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = `${dir}/${item.name}`;
    if (item.isDirectory()) {
      files.push(...getAllJsFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

if (cluster.isMaster) {
  // Display ASCII art and loading spinner
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
    startApp();
  }, 2000);

  function startApp() {
    const moduleFiles = getAllJsFiles('./modules').map(file => file.replace('./modules/', ''));
    const compatibility = require('./handlers/compatibility');
    const runtime = typeof Bun !== 'undefined' ? 'Bun' : 'Node.js';

    console.log(chalk.gray(`Running under a ${runtime} runtime environment`));
    console.log(chalk.gray("Loading modules tree..."));
    console.log(chalk.gray("Graphene 1.1.0"));


    const modulesTable = [];
    const moduleLoadTimes = {};

    moduleFiles.forEach(file => {
      let moduleState = 'Initializing';
      const startTime = process.hrtime();
      
      try {
        const module = require('./modules/' + file);
        const loadTime = process.hrtime(startTime);
        const loadTimeMs = (loadTime[0] * 1000 + loadTime[1] / 1000000).toFixed(2);
        moduleLoadTimes[file] = loadTimeMs;
        
        if (!module.heliactylModule) {
          console.log(chalk.red(`Module "${file}" has an error: No module manifest was found in the file.`));
          modulesTable.push({ File: file, Status: '❌ No module manifest', State: 'Error', 'Target Platform': 'N/A', 'Load Time': `${loadTimeMs}ms` });
          return;
        }

        const { name, target_platform } = module.heliactylModule;
        moduleState = 'Loaded';

        // Check version compatibility
        const versionCheck = compatibility.isCompatible(target_platform, settings.version);
        
        if (!versionCheck.compatible) {
           moduleState = 'Version Mismatch';
          if (versionCheck.details.majorMismatch) {
            console.log(chalk.red(`Module "${name}" has an error: Major version mismatch (expected: ${settings.version}, found: ${target_platform})`));
            modulesTable.push({ File: file, Name: name, Status: '❌ Major version mismatch', State: moduleState, 'Target Platform': target_platform });
          } else if (versionCheck.details.newerMinor) {
            console.log(chalk.red(`Module "${name}" has an error: Module requires a newer platform version (module: ${target_platform}, platform: ${settings.version})`));
            modulesTable.push({ File: file, Name: name, Status: '❌ Newer version required', State: moduleState, 'Target Platform': target_platform });
          }
          return;
        }

        // Version is compatible but different
        if (target_platform !== settings.version) {
        moduleState = 'Compatible';
        console.log(chalk.yellow(`Module "${name}" notice: Different but compatible version (platform: ${settings.version}, module: ${target_platform}) in ${moduleLoadTimes[file]}ms`));
        modulesTable.push({ 
          File: file, 
          Name: name, 
          Status: '⚠️ Module loaded (different version)', 
          State: moduleState, 
          'Target Platform': target_platform,
          'Load Time': `${moduleLoadTimes[file]}ms` 
        });
          return;
        }

        moduleState = 'Active';
        modulesTable.push({ 
          File: file, 
          Name: name, 
          Status: '✓ Module loaded!', 
          State: moduleState, 
          'Target Platform': target_platform,
          'Load Time': `${moduleLoadTimes[file]}ms`
        });
        console.log(chalk.green(`Module "${name}" loaded successfully (${target_platform}) in ${moduleLoadTimes[file]}ms`));
        
      } catch (error) {
        moduleState = 'Error';
        console.log(chalk.red(`Module "${file}" failed to load: ${error.message}`));
        modulesTable.push({ File: file, Status: '❌ Module load failed', State: moduleState, 'Target Platform': 'N/A' });
      }
    });

    //console.table( modulesTable);
  
    const numCPUs = parseInt(settings.clusters) - 1;
    console.log(chalk.gray(`Starting workers on Heliactyl Next ${settings.version} (${settings.platform_codename})`));
    console.log(chalk.gray(`Master ${process.pid} is running`));
    console.log(chalk.gray(`Forking ${numCPUs} workers...`));
  
    if (numCPUs > 130 || numCPUs < 1) {
      console.log(chalk.red('Error: Clusters amount was either below 1, or above 128.'));
      process.exit();
    }

    let firstWorkerStarted = false;
    
    for (let i = 0; i < numCPUs; i++) {
      const worker = cluster.fork();
      console.log(chalk.cyan(`Creating worker ${i + 1} of ${numCPUs}`));
      
      if (!firstWorkerStarted) {
        worker.send({ type: 'FIRST_WORKER' });
        firstWorkerStarted = true;
        console.log(chalk.cyan(`Designated primary worker: ${worker.process.pid}`));
      }
      
      worker.on('online', () => {
        console.log(chalk.green(`Worker ${worker.process.pid} is online`));
      });
      
      worker.on('message', (msg) => {
        if (msg.type === 'WEB_SERVER_STARTED') {
          console.log(chalk.green(`Web server started on worker ${worker.process.pid}`));
        }
      });
    }
  
    cluster.on('exit', (worker, code, signal) => {
      console.log(chalk.red(`Worker ${worker.process.pid} died. Forking a new worker...`));
      cluster.fork();
    });

    cluster.on('online', (worker) => {
      const workerTree = Object.values(cluster.workers).map(w => ({
        id: w.id,
        pid: w.process.pid,
        state: w.state,
      }));
    });
    
    const watchDirs = ['./modules', './handlers'];

    watchDirs.forEach(dir => {
      const watcher = chokidar.watch(dir);
      watcher.on('change', async (path) => {
        console.log(chalk.yellow(`File changed: ${path}. Rebooting workers...`));
        
        if (path.includes('afk.js') || path.includes('modules/afk')) {
          console.log(chalk.cyan('AFK module modified, clearing AFK sessions...'));
          await db.set('afkSessions', {});
          const keys = await db.list('afk_session-*');
          for (const key of keys) {
            await db.delete(key);
          }
        }

        for (const id in cluster.workers) {
          cluster.workers[id].kill();
        }
      });
    });
  }

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
  global.clusterSafeInterval = function(callback, delay) {
    if (cluster.worker.id === 1) {
      return originalSetInterval(callback, delay);
    } else {
      // Return a dummy interval object for non-first workers
      return {
        unref: () => {},
        ref: () => {},
        close: () => {}
      };
    }
  };

  // Replace the global setInterval with our cluster-safe version
  global.setInterval = global.clusterSafeInterval;

  // Load websites.
  const express = require("express");
  const cookieParser = require('cookie-parser');
  const nocache = require('nocache');
  const app = express();
  require("express-ws")(app);

  // Load the website.
  module.exports.app = app;

  app.set('view engine', 'ejs');
  app.set('trust proxy', true);

  app.use(cookieParser());
  app.use(express.text());
  app.use(nocache());

  // Load express addons.
  const session = require("express-session");
  const sessionStore = require("./handlers/sessionStore");
  const indexjs = require("./app.js");

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
      const theme = indexjs.get(req);
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
      await db.set('coins-'+userId, 0);
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

    APIFiles.forEach((file) => {
      const APIFile = require(file);
      APIFile.load(app, db);
  });

  collectRoutes(app);


  // Add this new function to collect routes
  function collectRoutes(app) {
    const routes = [];
    app._router.stack.forEach((middleware) => {
      if (middleware.route) {
        routes.push(middleware.route.path);
      } else if (middleware.name === 'router') {
        middleware.handle.stack.forEach((handler) => {
          if (handler.route) {
            routes.push(handler.route.path);
          }
        });
      }
    });
    return routes;
  }

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

  // Redirect already logged in users away from auth page
  if (req.path === "/auth" && req.session.pterodactyl && req.session.userinfo) {
    return res.redirect("/dashboard");
  }

  const theme = indexjs.get(req);

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
  if (theme.settings.mustbeadmin.includes(req._parsedUrl.pathname)) {
    const data = await renderData(req, theme);
    res.render(theme.settings.notfound, data);
    return;
  }

  const pageName = req._parsedUrl.pathname.slice(1);
  const pageToRender = theme.settings.pages[pageName];

  const data = await renderData(req, theme);

  if (pageToRender) {
    res.render(pageToRender, data);
  } else {
    res.status(404).render(theme.settings.notFound, data);
  }
});


  module.exports.get = function (req) {
    return {
      settings: fs.existsSync(`./views/pages.json`) ? JSON.parse(fs.readFileSync(`./views/pages.json`).toString()) : []
    };
  };

  module.exports.islimited = async function () {
    return cache == true ? false : true;
  };

  module.exports.ratelimits = async function (length) {
    const indexjs = require("./app.js");
    if (cache == true) return setTimeout(indexjs.ratelimits, 1);
    cache = true;
    setTimeout(async () => {
      cache = false;
    }, length * 1000);
  };
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