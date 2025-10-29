/**
 * Utility functions for handling page settings.
 * PS: Temporary solution until refactoring.
 */

const fs = require('fs').promises;
const path = require('path');

const PAGES_PATH = path.join(__dirname, '..', 'views', 'pages.json');

getPages = async function () {
    try {
        const data = await fs.readFile(PAGES_PATH, 'utf-8');
        return {
            settings: JSON.parse(data)
        };
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { settings: [] };
        }
        throw error;
    }
};

module.exports.islimited = async function () {
    return cache == true ? false : true;
};

module.exports = {
    getPages
}