const path = require('path');
const chalk = require("chalk");
const { getAllJsFiles } = require('./utils');

function validateModules(settings) {
    const runtime = typeof Bun !== 'undefined' ? 'Bun' : 'Node.js';

    console.log(chalk.gray(`Running under a ${runtime} runtime environment`));
    console.log(chalk.gray("Loading modules tree..."));
    console.log(chalk.gray("Graphene 1.1.0"));

    const moduleFiles = getAllJsFiles('./app/modules');
    const compatibility = require('./compatibility');

    console.log(chalk.green(`Validating ${moduleFiles.length} modules...`));

    moduleFiles.forEach(file => {
        try {
            const module = require(path.resolve(file));

            if (!module.heliactylModule) {
                console.log(chalk.red(`Module "${path.basename(file)}" has no manifest`));
                return;
            }

            const { name, target_platform } = module.heliactylModule;
            const version = target_platform === "latest" ? settings.version : target_platform;
            
            const versionCheck = compatibility.isCompatible(version, settings.version);

            if (!versionCheck.compatible) {
                console.log(chalk.red(`Module "${name}" version mismatch`));
            } else if (version !== settings.version) {
                console.log(chalk.yellow(`Module "${name}" different but compatible version`));
            } else {
                //console.log(chalk.green(`Module "${name}" validated`));
            }
        } catch (error) {
            console.log(chalk.red(`Module "${path.basename(file)}" validation failed: ${error.message}`));
        }
    });
}

module.exports = { validateModules };