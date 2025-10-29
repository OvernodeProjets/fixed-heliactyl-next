const fs = require('fs').promises;
const path = require('path');

const PAGES_PATH = path.join(__dirname, '..', 'views', 'pages.json');

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

async function getPages() {
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

module.exports = {
    renderData,
    getPages
};