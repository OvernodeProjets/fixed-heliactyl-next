/**
 * Heliactyl Next - Module Compatibility Handler
 * Manages semantic versioning and API level compatibility checks for modules
 */

/**
 * Checks if a module version is compatible with the platform version using semantic versioning rules
 * - Compatible if same MAJOR version AND module's MINOR version <= platform's MINOR version
 * - Patch versions are ignored in compatibility check
 * 
 * @param {string} moduleVersion - The module's version (format: MAJOR.MINOR.PATCH)
 * @param {string} platformVersion - The platform's version (format: MAJOR.MINOR.PATCH)
 * @returns {object} Compatibility status and details
 */
function isCompatible(moduleVersion, platformVersion) {
    const [moduleMajor, moduleMinor] = moduleVersion.split('.').map(Number);
    const [platformMajor, platformMinor] = platformVersion.split('.').map(Number);

    const isFullyCompatible = moduleMajor === platformMajor && moduleMinor <= platformMinor;
    const hasMajorMismatch = moduleMajor !== platformMajor;
    const hasNewerMinor = moduleMinor > platformMinor;

    return {
        compatible: isFullyCompatible,
        details: {
            majorMismatch: hasMajorMismatch,
            newerMinor: hasNewerMinor,
            versions: {
                module: { major: moduleMajor, minor: moduleMinor },
                platform: { major: platformMajor, minor: platformMinor }
            }
        }
    };
}


module.exports = {
    isCompatible
};