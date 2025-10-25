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
  "name": "Local OAuth2 Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const axios = require('axios');
const PterodactylApplicationModule = require('../../handlers/ApplicationAPI.js');
const getPteroUser = require('../../handlers/getPteroUser.js');
// todo : replace with an local
const { v4: uuidv4 } = require('uuid');
const loadConfig = require("../../handlers/config.js");
const settings = loadConfig("./config.toml");
const fetch = require("node-fetch");
const indexjs = require("../../app.js");
const { discordLog } = require("../../handlers/log.js");
const fs = require("fs");
const { renderFile } = require("ejs");

// Add Resend API key to your settings
// todo : move to config file
const RESEND_API_KEY = 're_GqVR7va3_8z8QuYyECBEDYKYdvrf9iqbb';


module.exports.load = async function (app, db) {
  const AppAPI = new PterodactylApplicationModule(settings.pterodactyl.domain, settings.pterodactyl.key);

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

  // todo : remove that
  const rateLimit = (req, res, next) => {
    if (!req.session.lastAuthAttempt) {
      req.session.lastAuthAttempt = Date.now();
      return next();
    }

    const timeElapsed = Date.now() - req.session.lastAuthAttempt;
    if (timeElapsed < 1000) {
      return res.status(429).json({ error: "Too many requests. Please try again in " + (1000 - timeElapsed) + " ms." });
    }

    req.session.lastAuthAttempt = Date.now();
    next();
  };

  const sendEmail = async (to, subject, html) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'fractal@mail.turing.su',
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
  app.post("/auth/register", rateLimit, async (req, res) => {
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
        username,
        email,
        first_name: username,
        last_name: "on Heliactyl",
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
        console.error("Error fetching existing account:", fetchError.response?.data || fetchError.message);
        return res.send("An error occurred while attempting to create the account.");
      }
    }

    // Auth notification
    let notifications = await db.get('notifications-' + userId) || [];
    let notification = {
      "action": "user:signup",
      "name": "Account created via Local OAuth2",
      "ip": req.ip,
      "timestamp": new Date().toISOString()
    }

    notifications.push(notification)
    await db.set('notifications-' + userId, notifications)

    res.status(201).json({ message: "User registered successfully" });
    return;
  });

  // Login route
  app.post("/auth/login", rateLimit, async (req, res) => {
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

    // Auth notification
    let notifications = await db.get('notifications-' + user.id) || [];
    let notification = {
      "action": "user:auth",
      "name": "Sign in from new location",
      "ip": req.ip,
      "timestamp": new Date().toISOString()
    }

    notifications.push(notification)
    await db.set('notifications-' + user.id, notifications)

    res.json({ message: "Login successful" });
  });

  // Password reset request route
  app.post("/auth/reset-password-request", async (req, res) => {
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

    const resetLink = `${settings.website.domain}/auth/reset-password?token=${resetToken}`;

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
  app.post("/auth/reset-password", async (req, res) => {
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
  app.post("/auth/magic-link", rateLimit, async (req, res) => {
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

    const magicLink = `${settings.website.domain}/auth/magic-login?token=${magicToken}`;

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
  app.get("/auth/magic-login", async (req, res) => {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    const magicInfo = await db.get(`magic-${token}`);
    if (!magicInfo || magicInfo.expiry < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const userEmail = await db.get(`userid-${magicInfo.userId}`);
    const user = await db.get(`user-${userEmail}`);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Create session
    req.session.userinfo = {
      id: user.id,
      username: user.username,
      email: user.email,
      global_name: user.username
    };

    const PterodactylUser = await getPteroUser(userinfo.id, db);
    if (!PterodactylUser) {
        res.send("An error has occurred while attempting to update your account information and server list.");
        return;
    }
    req.session.pterodactyl = PterodactylUser.attributes;

    // Delete the used magic token
    await db.delete(`magic-${token}`);

    // Auth notification
    let notifications = await db.get('notifications-' + user.id) || [];
    let notification = {
      "action": "user:auth",
      "name": "Sign in using magic link",
      "ip": req.ip,
      "timestamp": new Date().toISOString()
    }

    notifications.push(notification)
    await db.set('notifications-' + user.id, notifications)

    res.redirect('/dashboard'); // Redirect to dashboard after successful login
  });
};