const chalk = require('chalk');
const cluster = require('cluster');
const chokidar = require('chokidar');

function startCluster(settings, db) {
    const numCPUs = parseInt(settings.clusters) - 1;

    console.log(chalk.gray(`Starting workers on Heliactyl Next ${settings.version} (${settings.platform_codename})`));
    console.log(chalk.gray(`Master ${process.pid} is running`));
    console.log(chalk.gray(`Forking ${numCPUs} workers...`));

    // Validate number of clusters
    if (numCPUs > 130 || numCPUs < 1) {
        console.log(chalk.red('Error: Clusters amount must be between 1 and 128.'));
        process.exit(1);
    }

    let firstWorkerStarted = false;

    // Create workers
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

    // Handle worker death
    cluster.on('exit', (worker, code, signal) => {
        console.log(chalk.red(`Worker ${worker.process.pid} died. Forking a new worker...`));
        cluster.fork();
    });

    // File watcher for hot reload
    const watchDirs = ['./modules', './handlers'];
    watchDirs.forEach(dir => {
        const watcher = chokidar.watch(dir, {
            ignored: /(^|[\/\\])\../, // Ignore dotfiles
            persistent: true
        });

        watcher.on('change', async (filePath) => {
            console.log(chalk.yellow(`File changed: ${filePath}. Rebooting workers...`));

            // If it's the AFK module, clear sessions
            if (filePath.includes('afk.js') || filePath.includes('modules/afk')) {
                console.log(chalk.cyan('AFK module modified, clearing AFK sessions...'));
                await db.set('afkSessions', {});
                const keys = await db.list('afk_session-');
                for (const key of keys) {
                    await db.delete(key);
                }
            }

            // Restart all workers
            for (const id in cluster.workers) {
                cluster.workers[id].kill();
            }
        });
    });
}

module.exports = { startCluster };