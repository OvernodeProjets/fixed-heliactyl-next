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
  "name": "Referrals (legacy) Module",
  "target_platform": "3.2.1"
};

module.exports.heliactylModule = heliactylModule;

const { requireAuth } = require("../handlers/checkMiddleware.js");
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");

module.exports.load = async function (router, db) {
router.get('/referrals/generate', requireAuth, async (req, res) => {
  if (!settings.api.client.coins.referral.enabled) return res.status(403).json({ error: 'Referral system is disabled.' });
  
  if (!req.query.code) {
    return res.status(400).json({ error: 'Referral code is required.' });
  }

  let referralCode = req.query.code;
  // check if the referral code is less than 16 characters and has no spaces
  if(referralCode.length > 15 || referralCode.includes(" ")) {
    return res.status(400).json({ error: 'Invalid referral code. Must be less than 16 characters and contain no spaces.' });
  }
  // check if the referral code already exists
  if(await db.get(referralCode)){
    return res.status(400).json({ error: 'Referral code already exists.' });
  }
  // Save the referral code in the Keyv store along with the user's information
  await db.set(referralCode, {
    userId: req.session.userinfo.id,
    createdAt: new Date()
  });

  // Render the referral code view
  res.status(200).json({ message: 'Referral code generated successfully.', code: referralCode });
});

router.get('/referrals/claim', requireAuth, async (req, res) => {
  if (!settings.api.client.coins.referral.enabled) return res.status(403).json({ error: 'Referral system is disabled.' });
  
  // Get the referral code from the request body
  if (!req.query.code) {
    return res.status(400).json({ error: 'Referral code is required.' });
  }

  const referralCode = req.query.code;

  // Retrieve the referral code from the Keyv store
  const referral = await db.get(referralCode);

  if (!referral) {
    return res.status(404).json({ error: 'Invalid referral code.' });
  }

  // Check if user has already claimed a code
  if (await db.get("referral-" + req.session.userinfo.id) == "1") {
    return res.status(400).json({ error: 'Cannot claim referral code, already claimed.' });
  }

  // Check if the referral code was created by the user
  if (referral.userId === req.session.userinfo.id) {
    // Return an error if the referral code was created by the user
    return res.status(400).json({ error: 'Cannot claim your own referral code.' });
  }

  // Award the referral bonus to the user who claimed the code
  const ownercoins = await db.get("coins-" + referral.userId);
  const usercoins = await db.get("coins-" + req.session.userinfo.id);

  db.set("coins-" + referral.userId, ownercoins + settings.api.client.coins.referral.owner)
  db.set("coins-" + req.session.userinfo.id, usercoins + settings.api.client.coins.referral.referee)
  db.set("referral-" + req.session.userinfo.id, 1)

  // Render the referral claimed view
  res.status(200).json({ message: 'Referral code claimed successfully. You have been awarded ' + settings.api.client.coins.referral.referee + ' ' + settings.website.currency + '!' });
});

};