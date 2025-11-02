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
  "name": "Extras Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const { requireAuth } = require("../handlers/checkMiddleware.js");
const { discordLog } = require("../handlers/log.js");
const NodeCache = require("node-cache");

module.exports.load = async function(router, db) {
  const myCache = new NodeCache({ deleteOnExpire: true, stdTTL: 59 });

  function getPeriodStart(date, per) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    switch (per) {
      case "week":
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        break;
      case "month":
        d.setDate(1);
        break;
    }
    return d;
  }

  router.get('/dailystatus', requireAuth, async (req, res) => {
    if (!settings.api.client.coins.daily.enabled) {
      return res.json({ text: 'DISABLED' });
    }

    const userId = req.session.userinfo.id;
    const cacheKey = `dailystatus-${userId}`;

    if (myCache.has(cacheKey)) {
      return res.json(myCache.get(cacheKey));
    }

    const per = settings.api.client.coins.daily.per;
    const lastClaimTimestamp = await db.get("dailycoins-" + userId);
    const lastClaim = lastClaimTimestamp ? new Date(lastClaimTimestamp) : null;

    const today = getPeriodStart(new Date(), per);
    const lastPeriod = lastClaim ? getPeriodStart(lastClaim, per) : null;

    let response;
    if (lastPeriod && lastPeriod.getTime() === today.getTime()) {
      response = { text: '0' }; // Already claimed
    } else {
      response = { text: '1' }; // Can claim
    }

    myCache.set(cacheKey, response);
    return res.json(response);
  });

  router.get('/daily-coins', requireAuth, async (req, res) => {
    if (!settings.api.client.coins.daily.enabled) {
      return res.redirect('../dashboard?err=DISABLED');
    }

    const userId = req.session.userinfo.id;
    const cacheKey = `dailystatus-${userId}`;

    const per = settings.api.client.coins.daily.per;
    const lastClaimTimestamp = await db.get("dailycoins-" + userId);
    const lastClaim = lastClaimTimestamp ? new Date(lastClaimTimestamp) : null;

    const today = getPeriodStart(new Date(), per);
    const lastPeriod = lastClaim ? getPeriodStart(lastClaim, per) : null;

    if (lastPeriod && lastPeriod.getTime() === today.getTime()) {
      return res.redirect('../dashboard?err=CLAIMED');
    }

    const coins = (await db.get("coins-" + userId)) || 0;
    await db.set("coins-" + userId, coins + settings.api.client.coins.daily.amount);

    discordLog('daily coins', `${req.session.userinfo.username} has claimed their daily reward of ${settings.api.client.coins.daily.amount} ${settings.website.currency}.`);

    await db.set("dailycoins-" + userId, today.getTime());

    myCache.del(cacheKey);

    return res.redirect('../dashboard?err=none');
  });
};