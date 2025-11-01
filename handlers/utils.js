/**
 * Utility functions for handling page settings.
 * PS: Temporary solution until refactoring.
 */

const fs = require('fs');
const path = require('path');
const chalk = require("chalk");
const settings = require("./config")("./config.toml");

function consoleLogo() {
    process.stdout.write('='.repeat(60) + '\n');
    const asciiPath = path.join(__dirname, '../assets', 'ascii.txt');
    let asciiArt = fs.readFileSync(asciiPath, 'utf8');
    asciiArt = asciiArt.replace('{version}', `v${settings.version} - ${settings.platform_codename}`);

    process.stdout.write(asciiArt + '\n');
    process.stdout.write('='.repeat(60) + '\n');
}

function consoleSpin(workerId) {
    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let currentFrame = 0;

    process.stdout.write('\n');
    const spinner = setInterval(() => {
        process.stdout.write('\r' + chalk.gray.bold(`${workerId}   │   `) + chalk.gray(spinnerFrames[currentFrame++] + ' Initializing Graphene...'));
        currentFrame %= spinnerFrames.length;
    }, 100);
    process.stdout.write('\n\n');

    return spinner;
}

function getAllJsFiles(dir, options = {}) {
    const {
        recursive = true,
        extensions = ['.js'],
        exclude = []
    } = options;

    const files = [];

    try {
        const items = fs.readdirSync(dir, { withFileTypes: true });

        for (const item of items) {
            const fullPath = path.join(dir, item.name);

            // Skip excluded paths
            if (exclude.some(pattern => fullPath.includes(pattern))) {
                continue;
            }

            if (item.isDirectory() && recursive) {
                files.push(...getAllJsFiles(fullPath, options));
            } else if (item.isFile()) {
                const ext = path.extname(item.name);
                if (extensions.includes(ext)) {
                    files.push(fullPath);
                }
            }
        }
    } catch (error) {
        if (error.code !== 'EACCES') { // Skip permission errors
            throw error;
        }
    }

    return files;
}

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

async function isLimited() {
    return cache == true ? false : true;
};

module.exports = {
    consoleLogo,
    consoleSpin,
    getAllJsFiles,
    collectRoutes,
    isLimited
}