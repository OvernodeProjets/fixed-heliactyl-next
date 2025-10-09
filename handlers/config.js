const fs = require('fs');
const toml = require('@iarna/toml');

let config = null;
let watcher = null;

/**
 * Loads and parses a TOML file and returns it as a JSON object.
 *
 * @param {string} filePath - The path to the TOML file.
 * @returns {object} - The parsed TOML content as a JSON object.
 */
function loadConfig(filePath = 'config.toml') {
  try {
    // Read the TOML file
    const tomlString = fs.readFileSync(filePath, 'utf8');
    
    // Parse the TOML string to a JavaScript object
    config = toml.parse(tomlString);
    
    // Set up file watcher if not already watching
    if (!watcher) {
      watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change') {
          try {
            const updatedTomlString = fs.readFileSync(filePath, 'utf8');
            config = toml.parse(updatedTomlString);
            console.log('Configuration updated');
          } catch (watcherErr) {
            console.error('Error updating configuration:', watcherErr);
          }
        }
      });
    }
    
    // Return the parsed configuration object
    return config;
  } catch (err) {
    console.error('Error reading or parsing the TOML file:', err);
    throw err;
  }
}

module.exports = loadConfig;