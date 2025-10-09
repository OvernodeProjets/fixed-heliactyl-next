/**
 
Heliactyl Next - Avalanche

*/

"use strict";

// Load logging.
require("./handlers/console.js")();

// Load packages.
const fs = require("fs");
const chalk = require("chalk");
const arciotext = require("./handlers/afk.js");
const cluster = require("cluster");
const chokidar = require('chokidar');
global.Buffer = global.Buffer || require("buffer").Buffer;
process.emitWarning = function() {};

if (typeof btoa === "undefined") {
  global.btoa = function (str) {
    return Buffer.from(str, "binary").toString("base64");
  };
}
if (typeof atob === "undefined") {
  global.atob = function (b64Encoded) {
    return Buffer.from(b64Encoded, "base64").toString("binary");
  };
}

// Load settings.
const loadConfig = require("./handlers/config");
const settings = loadConfig("./config.toml");


const defaultthemesettings = {
  index: "index.ejs",
  notfound: "index.ejs",
  redirect: {},
  pages: {},
  mustbeloggedin: [],
  mustbeadmin: [],
  variables: {},
};

/**
 * Renders data for the theme.
 * @param {Object} req - The request object.
 * @param {Object} theme - The theme object.
 * @returns {Promise<Object>} The rendered data.
 */
async function renderData(req, theme) {
  const JavaScriptObfuscator = require('javascript-obfuscator');
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

  renderdata.arcioafktext = JavaScriptObfuscator.obfuscate(`
    let everywhat = ${settings.api.afk.every};
    let gaincoins = ${settings.api.afk.coins};
    let wspath = "ws";

    ${arciotext}
  `).getObfuscatedCode();

  return renderdata;
}

module.exports.renderdataeval = renderData;

// Load database
const Database = require("./db.js");
const db = new Database(settings.database);

module.exports.db = db;
let isFirstWorker = false;

if (cluster.isMaster) {
// Read the ASCII art
const asciiArt = fs.readFileSync('./handlers/ascii.txt', 'utf8');

// Split the ASCII art into lines
const lines = asciiArt.split('\n');

// Calculate the step for each line to create a gradient
const step = 1 / (lines.length - 1);

// Function to interpolate between two colors
function interpolateColor(color1, color2, factor) {
  const result = color1.map((channel, index) => {
    return Math.round(channel + factor * (color2[index] - channel));
  });
  return result;
}

// Display the ASCII art with gradient
console.log('\n'); // Add a newline before the ASCII art

  let spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let currentFrame = 0;
  const workerId = cluster.isWorker ? `worker` : "master";
  const prefix = chalk.gray.bold(`${workerId}   │   `);
  
  const spinner = setInterval(() => {
    process.stdout.write('\r' + prefix + chalk.gray(spinnerFrames[currentFrame++] + ' Initializing Graphene...'));
    currentFrame %= spinnerFrames.length;
  }, 100);
  
  setTimeout(() => {
    clearInterval(spinner);
    startApp();
  }, 1);

  function startApp() {
    // Create tree view of modules in /modules/
    let moduleFiles = fs.readdirSync("./modules").filter((file) => file.endsWith(".js"));
    const settingsVersion = settings.version;

    const runtime = typeof Bun !== 'undefined' ? 'Bun' : 'Node.js';
    console.log(chalk.gray(`Running under a ${runtime} runtime environment`));
  
    console.log(chalk.gray("Loading modules tree..."));
    console.log(chalk.gray("Graphene 1.1.0"));
    let modulesTable = [];

    moduleFiles.forEach(file => {
      const module = require('./modules/' + file);
      if (!module.load || !module.heliactylModule) {
        console.log(chalk.yellowBright("Module \"" + file + `" has an error: No module manifest or load function was specified in the file.`));
        modulesTable.push({ File: file, Status: 'No module information', 'API Level': 0, 'Target Platform': 'Unknown' });
        process.exit()
        return;
      }
    
      const { name, api_level, target_platform } = module.heliactylModule;
  
      if (target_platform !== settingsVersion) {
        console.log(chalk.yellowBright("Module \"" + name + `" has an error: Target platform mismatch (expected: ${settingsVersion}, found: ${target_platform}`));
        modulesTable.push({ File: file, Name: name, Status: `Error: Target platform mismatch (expected: ${settingsVersion}, found: ${target_platform})`, 'API Level': api_level, 'Target Platform': target_platform });
        process.exit()
        return;
      }
  
      modulesTable.push({ File: file, Name: name, Status: 'Module loaded!', 'API Level': api_level, 'Target Platform': target_platform });
    });

    //console.table(modulesTable);
  
    const numCPUs = parseInt(settings.clusters) - 1;
    console.log(chalk.gray('Starting workers...'));
    console.log(chalk.gray(`Master ${process.pid} is running`));
    console.log(chalk.gray(`Forking ${numCPUs} workers...`));
  
    if (numCPUs > 130 || numCPUs < 1) {
      console.log(chalk.red('Error: Clusters amount was either below 1, or above 128.'))
      process.exit()
    }

    for (let i = 0; i < numCPUs; i++) {
      const worker = cluster.fork();
      if (i === 0) {
        worker.send({ type: 'FIRST_WORKER' });
      }
    }
  
    cluster.on('exit', (worker, code, signal) => {
      console.log(chalk.red(`Worker ${worker.process.pid} died. Forking a new worker...`));
      cluster.fork();
    });
    
    // Watch for file changes and reboot workers
    const watcher = chokidar.watch('./modules');
    watcher.on('change', (path) => {
      console.log(chalk.yellow(`File changed: ${path}. Rebooting workers...`));
      for (const id in cluster.workers) {
        cluster.workers[id].kill();
      }
    });

    // Watch for file changes and reboot workers
    const watcher2 = chokidar.watch('./handlers');
    watcher2.on('change', (path) => {
      console.log(chalk.yellow(`File changed: ${path}. Rebooting workers...`));
      for (const id in cluster.workers) {
        cluster.workers[id].kill();
      }
    });
  }
  
  cluster.on('online', (worker) => {
    const workerTree = Object.values(cluster.workers).map(worker => ({
      id: worker.id,
      pid: worker.process.pid,
      state: worker.state,
    }));
  });

} else {
  // Worker process
  process.on('message', (msg) => {
    if (msg.type === 'FIRST_WORKER') {
      isFirstWorker = true;
      console.log(`Worker ${process.pid} is designated as the first worker.`);
      console.log(`Graphene's webserver is now listening on port ` + settings.website.port);
    }
  });

  // Create a wrapper function for setInterval
  global.clusterSafeInterval = function(callback, delay) {
    if (isFirstWorker) {
      return setInterval(callback, delay);
    } else {
      // Return a dummy interval object for non-first workers
      return {
        unref: () => {},
        ref: () => {},
        close: () => {}
      };
    }
  };

  global.setInterval = function(callback, delay) {
     return clusterSafeInterval(callback, delay);
  };

  // Load websites.
  const express = require("express");
  const nocache = require('nocache');
  const app = express();
  app.set('view engine', 'ejs');
  require("express-ws")(app);

  const cookieParser = require('cookie-parser');
  app.use(cookieParser());
  app.use(express.text());

  // Load express addons.
  const session = require("express-session");
  const SessionStore = require("./handlers/session");
  const indexjs = require("./app.js");

  // Load the website.
  module.exports.app = app;

  app.use(nocache());
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader("X-Powered-By", `13rd Gen Heliactyl Next (${settings.platform_codename})`);
    res.setHeader("X-Heliactyl", `Heliactyl Next v${settings.version} - "${settings.platform_codename}"`);
    next();
  });

  app.use((err, req, res, next) => {
    if (err.status === 500 && err.message === 'Gateway Timeout') {
      let theme = indexjs.get(req);
      const renderData = {
        err: 'Gateway Timeout'
      };
      res.status(500).render('500', renderData);
    } else {
      next(err);
    }
  });

  app.use(
    session({
      secret: settings.website.secret,
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false }, // Set to true if using https
      proxy: true
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


app.set('trust proxy', true);

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
    await db.set('afkSessions', {});
    console.log(
      chalk.white(chalk.gray("[cluster]") + " Cluster state updated: ") + chalk.green('running')
    );
  });

  var cache = false;
  app.use(function (req, res, next) {
    let manager = loadConfig("./config.toml").api
      .client.ratelimits;
    if (manager[req._parsedUrl.pathname]) {
      if (cache == true) {
        setTimeout(async () => {
          let allqueries = Object.entries(req.query);
          let querystring = "";
          for (let query of allqueries) {
            querystring = querystring + "&" + query[0] + "=" + query[1];
          }
          querystring = "?" + querystring.slice(1);
          res.redirect(
            (req._parsedUrl.pathname.slice(0, 1) == "/"
              ? req._parsedUrl.pathname
              : "/" + req._parsedUrl.pathname) + querystring
          );
        }, 1000);
        return;
      } else {
        cache = true;
        setTimeout(async () => {
          cache = false;
        }, 1000 * manager[req._parsedUrl.pathname]);
      }
    }
    next();
  });

  // Add this new function to collect routes
  function collectRoutes(app) {
    const routes = [];
    app._router.stack.forEach(function(middleware){
      if(middleware.route){ // routes registered directly on the app
        routes.push(middleware.route.path);
      } else if(middleware.name === 'router'){ // router middleware 
        middleware.handle.stack.forEach(function(handler){
          if(handler.route){
            routes.push(handler.route.path);
          }
        });
      }
    });
    return routes;
  }

  // Modify the API loading section
  //console.log(chalk.gray("Loading API routes:"));
  let apifiles = fs.readdirSync("./modules").filter((file) => file.endsWith(".js"));

  apifiles.forEach((file) => {
    let apifile = require(`./modules/${file}`);
    apifile.load(app, db);
  });

      
    // After loading each module, collect and log its routes
    const routes = collectRoutes(app);
    routes.forEach(route => {
      //console.log(chalk.green(`${route}`));
    });

  app.all("*", async (req, res) => {
    if (req.session.pterodactyl)
      if (
        req.session.pterodactyl.id !==
        (await db.get("users-" + req.session.userinfo.id))
      )
        return res.redirect("/login?prompt=none");
    let theme = indexjs.get(req);
    if (settings.api.afk.enabled == true)
      req.session.arcsessiontoken = Math.random().toString(36).substring(2, 15);
    if (theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname))
      if (!req.session.userinfo || !req.session.pterodactyl)
        return res.redirect(
          "/auth"
        );
    if (theme.settings.mustbeadmin.includes(req._parsedUrl.pathname)) {
      const renderData = await renderData(req, theme);
      res.render(theme.settings.notfound, renderData);
      return;
    }
    const data = await renderData(req, theme);
    res.render(theme.settings.pages[req._parsedUrl.pathname.slice(1)] || theme.settings.notfound, data);
  });

  module.exports.get = function (req) {
    return {
      settings: fs.existsSync(`./views/pages.json`)
        ? JSON.parse(fs.readFileSync(`./views/pages.json`).toString())
        : defaultthemesettings
    };
  };

  module.exports.islimited = async function () {
    return cache == true ? false : true;
  };

  module.exports.ratelimits = async function (length) {
    if (cache == true) return setTimeout(indexjs.ratelimits, 1);
    cache = true;
    setTimeout(async function () {
      cache = false;
    }, length * 1000);
  };

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
  });

const shimPromiseWithStackCapture = () => {
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

// Apply the shim
shimPromiseWithStackCapture();

// Set up the unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:');
  console.error(promise);
  console.error('Reason:');
  console.error(reason);
});
}