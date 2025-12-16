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
 */

const heliactylModule = {
  "name": "Locale Module",
  "target_platform": "latest"
};

module.exports.heliactylModule = heliactylModule;

const { i18n } = require('../handlers/i18n');
const { requireAuth } = require('../handlers/checkMiddleware');

module.exports.load = async function(router, db) {
  const requireAdmin = (req, res, next) => requireAuth(req, res, next, true, db);
  // GET available locales
  router.get('/locales', async (req, res) => {
    try {
      const locales = i18n.getAvailableLocales();
      res.json({
        success: true,
        current: req.locale,
        available: locales
      });
    } catch (error) {
      console.error('Error fetching locales:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST change locale
  router.post('/locale/change', async (req, res) => {
    try {
      const { locale } = req.body;

      if (!locale) {
        return res.status(400).json({ error: 'Locale is required' });
      }

      if (!i18n.availableLocales.includes(locale)) {
        return res.status(400).json({ error: 'Invalid locale' });
      }

      req.session.locale = locale;

      res.cookie('locale', locale, { 
        maxAge: 365 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
      });

      if (req.session.userinfo) {
        await db.set(`locale-${req.session.userinfo.id}`, locale);
      }

      res.json({
        success: true,
        locale,
        message: 'Locale changed successfully'
      });

    } catch (error) {
      console.error('Error changing locale:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET translation for a specific key (useful for dynamic content)
  router.get('/locale/translate', async (req, res) => {
    try {
      const { key, ...replacements } = req.query;

      if (!key) {
        return res.status(400).json({ error: 'Key is required' });
      }

      const translation = req.__(key, replacements);

      res.json({
        success: true,
        key,
        translation
      });

    } catch (error) {
      console.error('Error translating:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST reload locales 
  router.get('/locale/reload', requireAdmin, async (req, res) => {
    try {
      i18n.reloadLocales();

      res.json({
        success: true,
        message: 'Locales reloaded successfully',
        available: i18n.getAvailableLocales()
      });

    } catch (error) {
      console.error('Error reloading locales:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
};