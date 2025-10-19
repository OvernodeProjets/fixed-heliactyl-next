/**
 *      __         ___            __        __
 *     / /_  ___  / (_)___ ______/ /___  __/ /
 *    / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 *   / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
 *  /_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
 *                               /____/      
 * 
 *     Heliactyl Next 3.2.0 (Avalanche)
 * 
 */

const heliactylModule = {
  "name": "XRS Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const { requireAuth } = require("../handlers/requireAuth.js");

module.exports.load = async function(app, db) {
  const lvcodes = {}
  const cooldowns = {}
  const dailyLimits = {}

  app.get(`/lv/gen`, requireAuth, async (req, res) => {
    // Check for the presence of specific cookies
    const requiredCookies = ["x5385", "x4634", "g9745", "h2843"];
    const hasCookie = requiredCookies.some(cookieName => req.cookies[cookieName] !== undefined);

    if (!hasCookie) {
      return res.status(403).send('Access denied.');
    }

    // Delete the matching cookie
    requiredCookies.forEach(cookieName => {
      if (req.cookies[cookieName]) {
        res.clearCookie(cookieName);
      }
    });

    const userId = req.session.userinfo.id;
    const now = Date.now();

    // Check daily limit
    if (!dailyLimits[userId] || dailyLimits[userId].date !== new Date().toDateString()) {
      dailyLimits[userId] = { count: 0, date: new Date().toDateString() };
    }
    if (dailyLimits[userId].count >= 50) {
      return res.status(429).send('Daily limit reached. Please try again tomorrow.');
    }

    // Check cooldown
    if (cooldowns[userId] && now < cooldowns[userId]) {
      const remainingTime = msToHoursAndMinutes(cooldowns[userId] - now);
      return res.status(429).send(`Please wait ${remainingTime} before generating another LV link.`);
    }

    const code = makeid(12);
    const referer = req.headers.referer || req.headers.referrer || '';
    const lvurl = linkvertise('1196418', referer + `redeem?code=${code}`);

    lvcodes[userId] = {
      code: code,
      user: userId,
      generated: now
    };

    cooldowns[userId] = now + 10000; // 10 second cooldown
    dailyLimits[userId].count++;

    res.redirect(lvurl);
  });

  app.get(`/afkredeem`, requireAuth, async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('An error occurred with your browser!');
    if (!req.headers.referer || !req.headers.referer.includes('linkvertise.com')) return res.redirect('/afk?err=BYPASSER');

    const userId = req.session.userinfo.id;
    const usercode = lvcodes[userId];
    if (!usercode) return res.redirect(`/afk`);
    if (usercode.code !== code) return res.redirect(`/afk`);
    delete lvcodes[userId];

    // Adding coins
    const coins = await db.get(`coins-${userId}`) || 0;
    await db.set(`coins-${userId}`, coins + 10);

    res.redirect(`/afk?err=none`);
  });

  // New API endpoint to get the user's limit
  app.get(`/api/lv/limit`, requireAuth, async (req, res) => {
    const userId = req.session.userinfo.id;
    const limit = dailyLimits[userId] || { count: 0, date: new Date().toDateString() };
    const remaining = 50 - limit.count;

    res.json({
      daily_limit: 50,
      used_today: limit.count,
      remaining: remaining,
      reset_time: new Date(new Date().setHours(24, 0, 0, 0)).toISOString()
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