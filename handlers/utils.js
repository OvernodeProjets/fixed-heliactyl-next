/**
 * Utility functions for handling page settings.
 * PS: Temporary solution until refactoring.
 */

const fs = require('fs');
const path = require('path');

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

async function isLimited() {
    return cache == true ? false : true;
};

module.exports = {
    getAllJsFiles,
    isLimited
}