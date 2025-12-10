/**
 *      __         ___            __        __
 *     / /_  ___  / (_)___ ______/ /___  __/ /
 *    / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 *   / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
 *  /_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
 *                               /____/      
 * 
 *     Heliactyl Next 3.2.1-beta.1 (Avalanche)
 * 
 *     Pterodactyl API Singleton
 *     Provides shared instances of Pterodactyl API clients
 */

const PterodactylClientModule = require('./ClientAPI');
const PterodactylApplicationModule = require('./ApplicationAPI');
const loadConfig = require('./config');
const settings = loadConfig('./config.toml');

let clientInstance = null;
let appInstance = null;

/**
 * Get the singleton instance of PterodactylClientModule
 * Uses the client_key for user-level API operations
 */
function getClientAPI() {
  if (!clientInstance) {
    clientInstance = new PterodactylClientModule(
      settings.pterodactyl.domain,
      settings.pterodactyl.client_key
    );
    console.log('[PteroSingleton] Created ClientAPI instance');
  }
  return clientInstance;
}

/**
 * Get the singleton instance of PterodactylApplicationModule
 * Uses the admin key for application-level API operations
 */
function getAppAPI() {
  if (!appInstance) {
    appInstance = new PterodactylApplicationModule(
      settings.pterodactyl.domain,
      settings.pterodactyl.key
    );
    console.log('[PteroSingleton] Created ApplicationAPI instance');
  }
  return appInstance;
}

/**
 * Reset instances (useful for testing or config reload)
 */
function resetInstances() {
  clientInstance = null;
  appInstance = null;
  console.log('[PteroSingleton] Instances reset');
}

module.exports = {
  getClientAPI,
  getAppAPI,
  resetInstances
};
