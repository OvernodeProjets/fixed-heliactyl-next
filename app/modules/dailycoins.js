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
  
    const per = settings.api.client.coins.daily.per;
    const lastClaimTimestamp = await db.get("dailycoins-" + req.session.userinfo.id);
    const lastClaim = lastClaimTimestamp ? new Date(lastClaimTimestamp) : null;
  
    const today = getPeriodStart(new Date(), per);
    const lastPeriod = lastClaim ? getPeriodStart(lastClaim, per) : null;
  
    if (lastPeriod && lastPeriod.getTime() === today.getTime()) {
      return res.json({ text: '0' }); // Already claimed
    } else {
      return res.json({ text: '1' }); // Can claim
    }
  });
  
  
  router.get('/daily-coins', requireAuth, async (req, res) => {
    if (!settings.api.client.coins.daily.enabled) {
      return res.redirect('../dashboard?err=DISABLED');
    }
  
    const per = settings.api.client.coins.daily.per;
    const lastClaimTimestamp = await db.get("dailycoins-" + req.session.userinfo.id);
    const lastClaim = lastClaimTimestamp ? new Date(lastClaimTimestamp) : null;
  
    const today = getPeriodStart(new Date(), per);
    const lastPeriod = lastClaim ? getPeriodStart(lastClaim, per) : null;
  
    if (lastPeriod && lastPeriod.getTime() === today.getTime()) {
      return res.redirect('../dashboard?err=CLAIMED');
    }
  
    const coins = (await db.get("coins-" + req.session.userinfo.id)) || 0;
    await db.set("coins-" + req.session.userinfo.id, coins + settings.api.client.coins.daily.amount);
  
    discordLog('daily coins', `${req.session.userinfo.username} has claimed their daily reward of ${settings.api.client.coins.daily.amount} ${settings.website.currency}.`);
  
    await db.set("dailycoins-" + req.session.userinfo.id, today.getTime());
    return res.redirect('../dashboard?err=none');
  });
};