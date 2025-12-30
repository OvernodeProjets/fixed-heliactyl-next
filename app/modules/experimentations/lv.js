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
  "name": "Linkvertise Module",
  "target_platform": "3.2.1-beta.1"
};

module.exports.heliactylModule = heliactylModule;

const { requireAuth } = require("../../handlers/checkMiddleware.js");
const loadConfig = require("../../handlers/config");
const settings = loadConfig("./config.toml");

module.exports.load = async function(app, db) {
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);
  const lvcodes = {}
  const cooldowns = {}
  const dailyLimits = {}

  const lvConfig = settings.api.client.linkvertise || {
    enabled: false,
    userid: "000000",
    coins_reward: 10,
    daily_limit: 50,
    reset_interval_hours: 12
  };

  app.get(`/lv/gen`, authMiddleware, async (req, res) => {
    if (!lvConfig.enabled) {
        return res.status(404).send('Linkvertise integration is disabled.');
    }

    const userId = req.session.userinfo.id;
    const now = Date.now();
    const resetInterval = (lvConfig.reset_interval_hours || 12) * 60 * 60 * 1000;

    // Initialize or reset limit if expired
    if (!dailyLimits[userId] || now >= dailyLimits[userId].resetAt) {
      dailyLimits[userId] = { 
          count: 0, 
          resetAt: now + resetInterval 
      };
    }

    if (dailyLimits[userId].count >= lvConfig.daily_limit) {
      return res.status(429).send('Limit reached. Please try again later.');
    }

    // Check cooldown
    if (cooldowns[userId] && now < cooldowns[userId]) {
      const remainingTime = msToHoursAndMinutes(cooldowns[userId] - now);
      return res.status(429).send(`Please wait ${remainingTime} before generating another LV link.`);
    }

    const code = makeid(12);
    // Construct the callback URL dynamically based on the request host
    const protocol = req.protocol;
    const host = req.get('host');
    const callbackUrl = `${protocol}://${host}/api/afkredeem?code=${code}`;
    
    const lvurl = linkvertise(lvConfig.userid, callbackUrl);

    lvcodes[userId] = {
      code: code,
      user: userId,
      generated: now
    };

    // Store pending code with a short expiration (e.g., 10 minutes) to prevent memory leaks
    setTimeout(() => {
        if (lvcodes[userId] && lvcodes[userId].code === code) {
            delete lvcodes[userId];
        }
    }, 10 * 60 * 1000);

    const cooldownInterval = ((lvConfig.reset_interval_hours || 12) * 60 * 60 * 1000) / (lvConfig.daily_limit || 50);
    cooldowns[userId] = now + cooldownInterval;
    dailyLimits[userId].count++;

    res.redirect(lvurl);
  });

  app.get(`/afkredeem`, authMiddleware, async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/linkvertise?err=MISSING_CODE');
    
    // Basic referer check - note that this is easily spoofed and not a security guarantee
    // but Linkvertise should forward the user to the destination we set.
    // if (!req.headers.referer || !req.headers.referer.includes('linkvertise.com')) return res.redirect('/linkvertise?err=BYPASSER');

    const userId = req.session.userinfo.id;
    const usercode = lvcodes[userId];
    
    if (!usercode) return res.redirect(`/linkvertise?err=INVALID_SESSION`);
    if (usercode.code !== code) return res.redirect(`/linkvertise?err=INVALID_CODE`);
    
    delete lvcodes[userId];

    const coins = await db.get(`coins-${userId}`) || 0;
    const reward = lvConfig.coins_reward || 10;
    await db.set(`coins-${userId}`, coins + reward);

    res.redirect(`/linkvertise?success=true&reward=${reward}`);
  });

  app.get(`/lv/stats`, authMiddleware, async (req, res) => {
    if (!lvConfig.enabled) return res.json({ enabled: false });

    const userId = req.session.userinfo.id;
    const now = Date.now();
    const resetInterval = (lvConfig.reset_interval_hours || 12) * 60 * 60 * 1000;

    // Check if we need to reset for display purposes (if user hasn't generated a link properly to trigger the reset)
    if (!dailyLimits[userId] || now >= dailyLimits[userId].resetAt) {
         // Don't modify state in a GET request ideally, but we need to return accurate info.
         // We can just calculate what it WOULD be.
         dailyLimits[userId] = { count: 0, resetAt: now + resetInterval };
    }

    const limit = dailyLimits[userId];
    const max = lvConfig.daily_limit;
    
    const cooldown = cooldowns[userId] || 0;
    const cooldownInterval = ((lvConfig.reset_interval_hours || 12) * 60 * 60 * 1000) / (lvConfig.daily_limit || 50);
    
    res.json({
        enabled: true,
        daily_limit: max,
        used_today: limit.count,
        remaining: Math.max(0, max - limit.count),
        reset_time: new Date(limit.resetAt).toISOString(),
        next_available: cooldown > now ? new Date(cooldown).toISOString() : null,
        cooldown_interval: cooldownInterval
    });
  });
}

function linkvertise(userid, link) {
  var base_url = `https://link-to.net/${userid}/${Math.random() * 1000}/dynamic`;
  var href = base_url + "?r=" + btoa(encodeURI(link));
  return href;
}

function btoa(str) {
  var buffer;
  if (str instanceof Buffer) {
    buffer = str;
  } else {
    buffer = Buffer.from(str.toString(), "binary");
  }
  return buffer.toString("base64");
}

function makeid(length) {
  let result = '';
  let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

function msToHoursAndMinutes(ms) {
  const msInHour = 3600000
  const msInMinute = 60000

  const hours = Math.floor(ms / msInHour)
  const minutes = Math.round((ms - (hours * msInHour)) / msInMinute * 100) / 100

  let pluralHours = `s`
  if (hours === 1) {
    pluralHours = ``
  }
  let pluralMinutes = `s`
  if (minutes === 1) {
    pluralMinutes = ``
  }

  return `${hours} hour${pluralHours} and ${minutes} minute${pluralMinutes}`
}