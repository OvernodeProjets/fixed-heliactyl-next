const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

class I18nManager {
  constructor(defaultLocale = 'en') {
    this.defaultLocale = defaultLocale;
    this.locales = {};
    this.availableLocales = [];
    this.loadLocales();
  }

  loadLocales() {
    const localesDir = path.join(__dirname, '../locales');
    
    if (!fs.existsSync(localesDir)) {
      fs.mkdirSync(localesDir, { recursive: true });
    }

    const files = fs.readdirSync(localesDir).filter(file => file.endsWith('.json'));
    
    files.forEach(file => {
      const locale = file.replace('.json', '');
      const filePath = path.join(localesDir, file);
      
      try {
        this.locales[locale] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        this.availableLocales.push(locale);
        console.log(chalk.gray(`[i18n] Loaded locale: ${locale}`));
      } catch (error) {
        console.error(chalk.red(`[i18n] Error loading locale ${locale}:`), error);
      }
    });

    if (this.availableLocales.length === 0) {
      console.warn(chalk.yellow('[i18n] No locales found, creating default English locale'));
      this.createDefaultLocale();
    }
  }

  createDefaultLocale() {
    const localePath = path.join(__dirname, '../locales/en.json');
    fs.writeFileSync(localePath, JSON.stringify({}, null, 2));
    this.locales['en'] = {};
    this.availableLocales.push('en');
  }

  translate(locale, key, replacements = {}) {
    const selectedLocale = this.locales[locale] || this.locales[this.defaultLocale];
    
    if (!selectedLocale) {
      console.warn(chalk.yellow(`[i18n] No translations available for locale: ${locale}`));
      return key;
    }

    // Navigate the translation object with the key (ex: "dashboard.title")
    const keys = key.split('.');
    let value = selectedLocale;
    
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return key; // return key if path is invalid
      }
    }

    if (!value) {
      console.warn(chalk.yellow(`[i18n] Translation not found for key: ${key} in locale: ${locale}`));
      return key;
    }

    // replace {{variable}} placeholders with actual values
    if (typeof value === 'string') {
      return value.replace(/\{\{(\w+)\}\}/g, (match, variable) => {
        return replacements[variable] || match;
      });
    }

    return value;
  }

  getAvailableLocales() {
    return this.availableLocales.map(locale => ({
      code: locale,
      name: this.locales[locale]?.meta?.name || locale,
      flag: this.locales[locale]?.meta?.flag || '🌐'
    }));
  }

  reloadLocales() {
    this.locales = {};
    this.availableLocales = [];
    this.loadLocales();
  }
}

const i18n = new I18nManager('en');
function i18nMiddleware(req, res, next) {
  let userLocale = req.query.lang ||
                   req.cookies?.locale || 
                   req.session?.locale || 
                   req.get('Accept-Language')?.split(',')[0]?.split('-')[0] || 
                   i18n.defaultLocale;

  userLocale = userLocale.toLowerCase();

  if (!i18n.availableLocales.includes(userLocale)) {
    userLocale = i18n.defaultLocale;
  }

  if (req.query.lang && i18n.availableLocales.includes(req.query.lang.toLowerCase())) {
    res.cookie('locale', userLocale, { maxAge: 900000, httpOnly: true });
    if (req.session) req.session.locale = userLocale;
  }

  res.locals.__ = (key, replacements) => i18n.translate(userLocale, key, replacements);
  res.locals.locale = userLocale;
  res.locals.availableLocales = i18n.getAvailableLocales();
  
  req.__ = res.locals.__;
  req.locale = userLocale;

  next();
}

module.exports = {
  i18n,
  i18nMiddleware
};