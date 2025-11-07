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
  "name": "Plesk Integration Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const fetch = require("node-fetch");
const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const { requireAuth } = require("../handlers/checkMiddleware.js");

// Plesk API configuration
const PLESK_URL = settings.api.client.plesk.PLESK_URL;
const PLESK_USERNAME = settings.api.client.plesk.PLESK_USERNAME;
const PLESK_PASSWORD = settings.api.client.plesk.PLESK_PASSWORD;
const SERVER_IP = settings.api.client.plesk.SERVER_IP;

async function pleskRequest(endpoint, method = 'GET', body = null) {
  try {
    const auth = Buffer.from(`${PLESK_USERNAME}:${PLESK_PASSWORD}`).toString('base64');
    
    console.log(`Making ${method} request to ${endpoint}`);
    if (body) {
      console.log('Request body:', JSON.stringify(body, null, 2));
    }

    const response = await fetch(`${PLESK_URL}/api/v2${endpoint}`, {
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: body ? JSON.stringify(body) : null
    });

    const responseText = await response.text();
    console.log('Response:', responseText);
    
    if (responseText.trim().startsWith('<html>')) {
      throw new Error('Invalid API response received');
    }

    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      throw new Error('Invalid JSON response: ' + responseText);
    }

    if (!response.ok) {
      throw new Error(`Plesk API Error: ${JSON.stringify(responseData)}`);
    }

    return responseData;
  } catch (error) {
    console.error('Plesk API Request Failed:', error);
    throw error;
  }
}

function generatePassword() {
  const length = 16;
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV0123456789";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

function generateFtpUsername(domain) {
  return domain.replace(/[^a-z0-9]/g, '').substring(0, 16);
}

module.exports.load = async function (router, db) {
  const authMiddleware = (req, res, next) => requireAuth(req, res, next, false, db);
  const checkPleskEnabled = async (req, res, next) => {
    if (!settings.api.client.plesk.enabled || settings.api.client.plesk.enabled === false) {
      return res.redirect('/dashboard');
    }
    next();
  };

  // Activate Plesk account
  router.post("/plesk/activate", authMiddleware, checkPleskEnabled, async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const userEmail = req.session.userinfo.email;
      const username = req.session.userinfo.username;

      const existingAccount = await db.get(`plesk-account2-${userId}`);
      if (existingAccount) {
        return res.status(409).json({ error: "Plesk account already exists" });
      }

      const pleskPassword = generatePassword();
      const login = `${settings.name}	_${userId}`;

      const customerData = {
        login: login,
        password: pleskPassword,
        type: "customer",
        name: username,
        company: "Heliactyl User",
        email: `${settings.name}-${userEmail}`,
        locale: "en-US",
        description: "Created via Heliactyl"
      };

      const customer = await pleskRequest('/clients', 'POST', customerData);

      await db.set(`plesk-account2-${userId}`, {
        pleskId: customer.id,
        login: login,
        password: pleskPassword,
        createdAt: new Date().toISOString(),
        status: 'active'
      });

      await db.set(`plesk-${userId}`, {
        pleskId: customer.id,
        login: login,
        password: pleskPassword,
        createdAt: new Date().toISOString(),
        status: 'active'
      });

      res.json({
        message: "Plesk account created successfully",
        credentials: {
          username: login,
          password: pleskPassword,
          url: PLESK_URL
        }
      });
    } catch (error) {
      console.error('Activation error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create website
  router.post("/plesk/websites", authMiddleware, checkPleskEnabled, async (req, res) => {
    try {
      const { domain } = req.body;
      const userId = req.session.userinfo.id;

      if (!domain) {
        return res.status(400).json({ error: "Domain name is required" });
      }

      const pleskAccount = await db.get(`plesk-account2-${userId}`);
      if (!pleskAccount) {
        return res.status(404).json({ error: "Please activate your Plesk account first" });
      }

      const ftpUsername = generateFtpUsername(domain);
      const ftpPassword = generatePassword();

      // Create domain with all required settings
      const domainData = {
        name: domain,
        hosting_type: "virtual",
        hosting_settings: {
          ftp_login: ftpUsername,
          ftp_password: ftpPassword,
          php: true,
          php_handler_type: "fastcgi",
          webstat: true,
          www_root: `/var/www/vhosts/${domain}/httpdocs`
        },
        owner_client: {
          id: pleskAccount.pleskId
        },
        ip_addresses: [SERVER_IP],
        plan: {
          name: "Unlimited"
        }
      };

      console.log('Creating domain with data:', JSON.stringify(domainData, null, 2));
      const website = await pleskRequest('/domains', 'POST', domainData);

      // After domain creation, verify and update hosting settings if needed
      const hostingSettings = {
        ftp: {
          username: ftpUsername,
          password: ftpPassword
        },
        php: {
          handler_type: "fastcgi",
          version: "8.2"
        },
        www_root: `/var/www/vhosts/${domain}/httpdocs`
      };

      // Ensure hosting is properly configured
      try {
        await pleskRequest(`/domains/${website.id}/hosting`, 'PUT', {
          type: "virtual",
          settings: hostingSettings
        });
      } catch (error) {
        console.error('Failed to update hosting settings:', error);
      }

      // Set up DNS records
      const dnsRecords = [
        {
          type: "A",
          host: "@",
          value: SERVER_IP,
          ttl: 1800
        },
        {
          type: "A",
          host: "www",
          value: SERVER_IP,
          ttl: 1800
        },
        {
          type: "TXT",
          host: "@",
          value: "v=spf1 a mx ~all",
          ttl: 1800
        }
      ];

      try {
        for (const record of dnsRecords) {
          await pleskRequest(`/dns/records?domain=${domain}`, 'POST', record);
        }
      } catch (error) {
        console.error('Failed to create DNS records:', error);
      }

      // Store website info in database
      let userWebsites = await db.get(`plesk-websites-${userId}`) || [];
      userWebsites.push({
        id: website.id,
        domain,
        createdAt: new Date().toISOString(),
        ip: SERVER_IP,
        ftpUsername,
        ftpPassword
      });
      await db.set(`plesk-websites-${userId}`, userWebsites);

      res.json({
        website,
        pleskUrl: PLESK_URL,
        credentials: {
          plesk_username: pleskAccount.login,
          plesk_password: pleskAccount.password,
          ftp_username: ftpUsername,
          ftp_password: ftpPassword
        },
        ip: SERVER_IP
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get website details
  router.get("/plesk/websites/:id", authMiddleware, checkPleskEnabled, async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const websiteId = req.params.id;
      
      const pleskAccount = await db.get(`plesk-account2-${userId}`);
      if (!pleskAccount) {
        return res.status(404).json({ error: "Please activate your Plesk account first" });
      }

      // Get domain details including hosting info
      const domain = await pleskRequest(`/domains/${websiteId}`);
      const hosting = await pleskRequest(`/domains/${websiteId}/hosting`);

      res.json({
        ...domain,
        hosting
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // List websites
  router.get("/plesk/websites", authMiddleware, checkPleskEnabled, async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      
      const pleskAccount = await db.get(`plesk-account2-${userId}`);
      if (!pleskAccount) {
        return res.status(404).json({ error: "Please activate your Plesk account first" });
      }

      const domains = await pleskRequest(`/clients/${pleskAccount.pleskId}/domains`);

      // Fetch hosting info for each domain
      const websitesWithDetails = await Promise.all(domains.map(async (domain) => {
        try {
          const hosting = await pleskRequest(`/domains/${domain.id}/hosting`);
          const storedWebsites = await db.get(`plesk-websites-${userId}`) || [];
          const storedWebsite = storedWebsites.find(site => site.id === domain.id);

          return {
            ...domain,
            hosting,
            ftpCredentials: storedWebsite ? {
              username: storedWebsite.ftpUsername,
              password: storedWebsite.ftpPassword
            } : null
          };
        } catch (error) {
          return domain;
        }
      }));

      res.json(websitesWithDetails);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete website
  router.delete("/plesk/websites/:id", authMiddleware, checkPleskEnabled, async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const domainId = req.params.id;

      const pleskAccount = await db.get(`plesk-account2-${userId}`);
      if (!pleskAccount) {
        return res.status(404).json({ error: "Please activate your Plesk account first" });
      }

      // Verify domain ownership
      const domains = await pleskRequest(`/clients/${pleskAccount.pleskId}/domains`);
      const domainExists = domains.some(domain => domain.id.toString() === domainId);

      if (!domainExists) {
        return res.status(404).json({ error: "Website not found or access denied" });
      }

      await pleskRequest(`/domains/${domainId}`, 'DELETE');

      // Update database
      const userWebsites = await db.get(`plesk-websites-${userId}`) || [];
      const updatedWebsites = userWebsites.filter(site => site.id !== parseInt(domainId));
      await db.set(`plesk-websites-${userId}`, updatedWebsites);

      res.json({ status: "success" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get account information
  router.get("/plesk/account", authMiddleware, checkPleskEnabled, async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      
      const pleskAccount = await db.get(`plesk-account2-${userId}`);
      if (!pleskAccount) {
        return res.status(404).json({ error: "No Plesk account found" });
      }

      const clientInfo = await pleskRequest(`/clients/${pleskAccount.pleskId}`);

      res.json({
        ...clientInfo,
        login: pleskAccount.login,
        pleskUrl: PLESK_URL
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};