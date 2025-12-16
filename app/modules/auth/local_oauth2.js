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
  "name": "Local OAuth2 Module",
  "target_platform": "latest"
};

module.exports.heliactylModule = heliactylModule;

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const axios = require('axios');
const { getAppAPI } = require('../../handlers/pterodactylSingleton.js');
const getPteroUser = require('../../handlers/getPteroUser.js');
// todo : replace with an local
const { v4: uuidv4 } = require('uuid');
const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const fetch = require("node-fetch");
const { discordLog, addNotification } = require("../../handlers/log");
const { getPages } = require("../../handlers/theme.js");

// Get Resend API key from environment variables
const RESEND_API_KEY = settings.api.client.resend.RESEND_API_KEY || "";
const RESEND_FROM_EMAIL = settings.api.client.resend.RESEND_FROM_EMAIL || 'noreply@example.com';

if (!RESEND_API_KEY && settings.api?.client?.email?.enabled) {
  console.warn('RESEND_API_KEY not configured. Email functionality will be unavailable.');
}

module.exports.load = async function (router, db) {
  const AppAPI = getAppAPI();

  const verifyCaptcha = async (recaptchaResponse) => {
    if (!settings.security.enableCaptcha) return true;
    if (!recaptchaResponse) return false;

    try {
        const recaptchaVerification = await fetch('https://www.google.com/recaptcha/api/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `secret=${settings.security.recaptchaServerKey}&response=${recaptchaResponse}`
        });
        const data = await recaptchaVerification.json();
        return data.success;
    } catch (error) {
      console.error('Error verifying reCAPTCHA:', error);
      return false;
    }
  };

  const sendEmail = async (to, subject, html) => {
    if (!RESEND_API_KEY) {
      throw new Error('Email service not configured');
    }
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to,
        subject,
        html
      })
    });

    if (!response.ok) {
      throw new Error('Failed to send email');
    }
  };
  
  // Registration route
  router.post("/auth/register", async (req, res) => {
    const { username, email, password, recaptchaResponse } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Check password strength
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      return res.status(400).json({ error: "Password must be at least 12 characters long and contain uppercase, lowercase, number, and special character" });
    }

    // Check if email is already in use
    const existingUser = await db.get(`user-${email}`);
    if (existingUser) {
      return res.status(409).json({ error: "Email already in use" });
    }

    // Check if username is already taken
    const existingUsername = await db.get(`username-${username}`);
    if (existingUsername) {
      return res.status(409).json({ error: "Username already taken" });
    }

    // Verify reCAPTCHA
    const recaptchaResult = await verifyCaptcha(recaptchaResponse);

    if (!recaptchaResult) {
        return res.status(400).json({ error: "reCAPTCHA verification failed" });
    }

    // Generate a unique user ID
    const userId = uuidv4();

    // Hash the password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Store user information
    await db.set(`user-${email}`, {
      id: userId,
      username,
      email,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    });

    await db.set(`userid-${userId}`, email);
    await db.set(`username-${username}`, userId);

    // Create Pterodactyl account
    try {
      const createAccount = await AppAPI.createUser({
        username: userId,
        email,
        first_name: username,
        last_name: "On Heliactyl",
        password: password
      });
    
      const userDataID = createAccount.attributes.id;
    
      const userList = (await db.get("users")) || [];
      userList.push(userDataID);
    
      await db.set("users", userList);
      await db.set(`users-${userId}`, userDataID);
    
    } catch (error) {
      try {
        const accountListResponse = await axios.get(
          `${settings.pterodactyl.domain}/api/application/users?include=servers&filter[email]=${encodeURIComponent(email)}`,
          {
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${settings.pterodactyl.key}`
            }
          }
        );
      
        const accountList = accountListResponse.data;
        const user = accountList.data.find(acc => acc.attributes.email === email);
      
        if (user) {
          const userDB = (await db.get("users")) || [];
          const userDataID = user.attributes.id;
        
          if (!userDB.includes(userDataID)) {
            userDB.push(userDataID);
            await db.set("users", userDB);
            await db.set(`users-${userId}`, userDataID);
          } else {
            return res.send("We have detected an account with your Discord email on it but the user id has already been claimed on another Discord account.");
          }
        } else {
          return res.send("An error occurred while attempting to create the account.");
        }
      } catch (fetchError) {
        console.error("[AUTH] Error fetching existing account:", fetchError.response?.data || fetchError.message);
        return res.send("An error occurred while attempting to create the account.");
      }
    }

    await addNotification(
      db,
      userId,
      "user:sign-in",
      "Account created via Local OAuth2",
      req.ip,
      req.headers['user-agent']
    );

    discordLog(
      "sign up",
      `${username} signed up to the dashboard in local OAuth2!`
    );

    res.status(201).json({ message: "User registered successfully" });
    return;
  });

  // Login route
  router.post("/auth/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const user = await db.get(`user-${email}`);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Regenerate session to prevent session fixation attacks
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Create session
    const userinfo = {
      id: user.id,
      username: user.username,
      email: user.email,
      global_name: user.username
    };

    req.session.userinfo = userinfo;

    const PterodactylUser = await getPteroUser(userinfo.id, db);
    if (!PterodactylUser) {
        res.send("An error has occurred while attempting to update your account information and server list.");
        return;
    }

    req.session.pterodactyl = PterodactylUser.attributes;

    if (settings.whitelist.status && !settings.whitelist.users.includes(userinfo.id)) {
      return res.send("Service is under maintenance.");
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    if (settings.api.client.oauth2.ip.block.includes(ip)) {
      return res.send(
        "You could not sign in, because your IP has been blocked from signing in."
      );
    }

    if (settings.api.client.oauth2.ip["duplicate check"] == true && ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1" && !ip.startsWith("192.168.")) {
      const userIP = await db.get(`ipuser-${ip}`);
      const bypassFlag = await db.get(`antialt-bypass-${userinfo.id}`) || false;
      if (userIP && userIP !== userinfo.id && !bypassFlag) {
        // Send webhook notifications
        await discordLog(
          "anti-alt",
          `User ID: \`${userinfo.id}\` attempted to login from an IP associated with another user ID: \`${userIP}\`.`,
          [
            { name: "IP Address", value: ip, inline: true },
            { name: "Alt User ID", value: userIP, inline: true }
          ],
          false
        );
        
        await discordLog(
          "anti-alt",
          `<@${userinfo.id}> attempted to login from an IP associated with another user ID: <@${userIP}>.`,
          [],
          true
        );
        
        const theme = await getPages();
        return res.status(500).render(theme.settings.errors.antialt);
      } else if (!userIP) {
        await db.set(`ipuser-${ip}`, userinfo.id);
      }
    }

    await addNotification(
      db,
      user.id,
      "user:sign-in",
      "Sign in from new location",
      req.ip,
      req.headers['user-agent']
    );

    discordLog(
      "sign in",
      `${userinfo.username} signed in to the dashboard in local OAuth2!`
    );

    res.json({ message: "Login successful" });
  });

  // Password reset request route
  router.post("/auth/reset-password-request", async (req, res) => {
    const { email, recaptchaResponse } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Verify reCAPTCHA
    const recaptchaResult = await verifyCaptcha(recaptchaResponse);

    if (!recaptchaResult) {
        return res.status(400).json({ error: "reCAPTCHA verification failed" });
    }

    const user = await db.get(`user-${email}`);
    if (!user) {
      return res.json({ message: "If the email exists, a reset link will be sent" });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now

    await db.set(`reset-${resetToken}`, {
      userId: user.id,
      expiry: resetTokenExpiry
    });

    const resetLink = `${settings.website.domain}/api/auth/reset-password?token=${resetToken}`;

    try {
      await sendEmail(
        email,
        `Reset Your ${settings.name} Password`,
        `<h1>Reset Your Password</h1><p>Click the link below to reset your password:</p><a href="${resetLink}">${resetLink}</a><p>This link will expire in 1 hour.</p>`
      );
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      return res.status(500).json({ error: "Failed to send reset email" });
    }

    res.json({ message: "If the email exists, a reset link will be sent" });
  });

  // Password reset route
  router.post("/auth/reset-password", async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required" });
    }

    const resetInfo = await db.get(`reset-${token}`);
    if (!resetInfo || resetInfo.expiry < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    // Check password strength
    if (newPassword.length < 12 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      return res.status(400).json({ error: "Password must be at least 12 characters long and contain uppercase, lowercase, number, and special character" });
    }

    const userEmail = await db.get(`userid-${resetInfo.userId}`);
    const user = await db.get(`user-${userEmail}`);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Hash the new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update user's password
    user.password = hashedPassword;
    await db.set(`user-${userEmail}`, user);

    // Delete the used reset token
    await db.delete(`reset-${token}`);

    res.json({ message: "Password reset successful" });
  });

  // Magic link login request
  router.post("/auth/magic-link", async (req, res) => {
    const { email, recaptchaResponse } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Verify reCAPTCHA
    const recaptchaResult = await verifyCaptcha(recaptchaResponse);

    if (!recaptchaResult) {
        return res.status(400).json({ error: "reCAPTCHA verification failed" });
    }

    const user = await db.get(`user-${email}`);
    if (!user) {
      return res.json({ message: "If the email exists, a magic link will be sent" });
    }

    const magicToken = crypto.randomBytes(32).toString('hex');
    const magicTokenExpiry = Date.now() + 600000; // 10 minutes from now

    await db.set(`magic-${magicToken}`, {
      userId: user.id,
      expiry: magicTokenExpiry
    });

    const magicLink = `${settings.website.domain}/api/auth/magic-login?token=${magicToken}`;

    try {
      await sendEmail(
        email,
        `Login to ${settings.name}`,
        `<h1>Login to ${settings.name}</h1><p>Click the link below to log in:</p><a href="${magicLink}">${magicLink}</a><p>This link will expire in 10 minutes.</p>`
      );
    } catch (error) {
      console.error('Failed to send magic link email:', error);
      return res.status(500).json({ error: "Failed to send magic link email" });
    }

    res.json({ message: "If the email exists, a magic link will be sent" });
  });

  // Magic link login verification
  router.get("/auth/magic-login", async (req, res) => {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: "Token is required" });
    }

    // Validate token format (should be hex string)
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ error: "Invalid token format" });
    }

    const magicInfo = await db.get(`magic-${token}`);
    if (!magicInfo) {
      return res.status(400).json({ error: "Invalid token" });
    }

    if (magicInfo.expiry < Date.now()) {
      await db.delete(`magic-${token}`);
      return res.status(400).json({ error: "Token expired" });
    }

    // Validate userId
    const userId = magicInfo.userId;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: "Invalid user mapping" });
    }

    const userEmail = await db.get(`userid-${userId}`);
    if (!userEmail || typeof userEmail !== 'string') {
      return res.status(400).json({ error: "User mapping not found" });
    }

    const user = await db.get(`user-${userEmail}`);
    if (!user || !user.id) {
      return res.status(404).json({ error: "User not found" });
    }

    // Delete the used magic token immediately
    await db.delete(`magic-${token}`);

    // Create session
    req.session.userinfo = {
      id: user.id,
      username: user.username,
      email: user.email,
      global_name: user.username
    };

    try {
      const PterodactylUser = await getPteroUser(user.id, db);
      if (!PterodactylUser) {
        req.session.destroy();
        return res.status(401).json({ error: "Failed to authenticate with Pterodactyl" });
      }
      req.session.pterodactyl = PterodactylUser.attributes;

      await addNotification(
        db,
        user.id,
        "user:sign-in",
        "Sign in using magic link",
        req.ip,
        req.headers['user-agent']
      );

      res.redirect("/dashboard");
      //res.json({ message: "Logged in successfully" });
    } catch (error) {
      console.error('Magic link login error:', error);
      req.session.destroy();
      return res.status(500).json({ error: "Authentication failed" });
    }
  });
};