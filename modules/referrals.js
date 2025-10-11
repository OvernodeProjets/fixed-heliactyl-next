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
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

module.exports.load = async function (app, db) {
app.get('/generate', async (req, res) => {
  if (!req.session) return res.redirect("/auth");
  if (!req.session.pterodactyl) return res.redirect("/auth");

  if (!req.query.code) {
    return res.redirect('../account?err=INVALIDCODE')
  }

  let referralCode = req.query.code;
  // check if the referral code is less than 16 characters and has no spaces
  if(referralCode.length > 15 || referralCode.includes(" ")) {
    return res.redirect('../referrals?err=INVALIDCODE')
  }
  // check if the referral code already exists
  if(await db.get(referralCode)){
    return res.redirect('../referrals?err=ALREADYEXISTS');
  }
  // Save the referral code in the Keyv store along with the user's information
  await db.set(referralCode, {
    userId: req.session.userinfo.id,
    createdAt: new Date()
  });

  // Render the referral code view
  res.redirect('../referrals?err=none')
});

app.get('/claim', async (req, res) => {
  if (!req.session) return res.redirect("/auth");
  if (!req.session.pterodactyl) return res.redirect("/auth");

  // Get the referral code from the request body
  if (!req.query.code) {
    return res.redirect('../account?err=INVALIDCODE')
  }

  const referralCode = req.query.code;

  // Retrieve the referral code from the Keyv store
  const referral = await db.get(referralCode);

  if (!referral) {
    return res.redirect('../account?err=INVALIDCODE')
  }

  // Check if user has already claimed a code
  if (await db.get("referral-" + req.session.userinfo.id) == "1") {
    return res.redirect('../account?err=CANNOTCLAIM')
  }

  // Check if the referral code was created by the user
  if (referral.userId === req.session.userinfo.id) {
    // Return an error if the referral code was created by the user
    return res.redirect('../account?err=CANNOTCLAIM')
  }

  // Award the referral bonus to the user who claimed the code
  const ownercoins = await db.get("coins-" + referral.userId);
  const usercoins = await db.get("coins-" + req.session.userinfo.id);

  db.set("coins-" + referral.userId, ownercoins + 80)
  db.set("coins-" + req.session.userinfo.id, usercoins + 250)
  db.set("referral-" + req.session.userinfo.id, 1)

  // Render the referral claimed view
  res.redirect('../account?err=none')
});

};