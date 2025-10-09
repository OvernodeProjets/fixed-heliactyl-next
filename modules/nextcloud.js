const fetch = require("node-fetch");
const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const xml2js = require('xml2js');

// Nextcloud API configuration
const NEXTCLOUD_URL = 'http://77.68.90.37';  // Replace with your Nextcloud URL
const ADMIN_USERNAME = 'admin';  // Replace with your Nextcloud admin username
const ADMIN_PASSWORD = '18YJ05@nq6';  // Replace with your admin password

const heliactylModule = {
  "name": "Nextcloud Integration Module",
  "api_level": 3,
  "target_platform": "19.1.1"
};

if (heliactylModule.target_platform !== settings.version) {
  console.log('Module ' + heliactylModule.name + ' does not support this platform release of Heliactyl. The module was built for platform ' + heliactylModule.target_platform + ' but is attempting to run on version ' + settings.version + '.')
  process.exit()
}

async function parseResponse(responseText, contentType) {
  try {
    // First try to parse as JSON
    if (responseText.trim().startsWith('{')) {
      return JSON.parse(responseText);
    }
    
    // If not JSON, try to parse as XML
    return new Promise((resolve, reject) => {
      xml2js.parseString(responseText, { explicitArray: false }, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  } catch (error) {
    throw new Error(`Failed to parse response: ${error.message}`);
  }
}

async function nextcloudRequest(endpoint, method = 'GET', body = null) {
  try {
    const auth = Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).toString('base64');
    
    console.log(`Making ${method} request to ${endpoint}`);
    if (body) {
      console.log('Request body:', body);
    }

    const response = await fetch(`${NEXTCLOUD_URL}/ocs/v1.php/cloud/${endpoint}`, {
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'OCS-APIRequest': 'true',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'  // Prefer JSON responses
      },
      body: body ? new URLSearchParams(body) : null
    });

    const contentType = response.headers.get('content-type');
    const responseText = await response.text();
    console.log('Response:', responseText);

    const parsedResponse = await parseResponse(responseText, contentType);
    
    // Handle both JSON and XML response structures
    let statusCode;
    let message;
    let data;

    if (parsedResponse.ocs) {
      // XML-style response structure
      statusCode = parseInt(parsedResponse.ocs.meta.statuscode);
      message = parsedResponse.ocs.meta.message;
      data = parsedResponse.ocs.data;
    } else {
      // Direct JSON response
      statusCode = parsedResponse.statuscode || 100;
      message = parsedResponse.message;
      data = parsedResponse.data || parsedResponse;
    }

    if (statusCode !== 100) {
      throw new Error(message || `Nextcloud API Error: Status code ${statusCode}`);
    }

    return data;
  } catch (error) {
    console.error('Nextcloud API Request Failed:', error);
    throw error;
  }
}

function generatePassword() {
  const length = 16;
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

function formatQuota(quota) {
  // Use a very large number for "unlimited" quota (1 PB = 1024^5 bytes)
  return quota === 'unlimited' ? '1152921504606846976' : quota;
}

module.exports.heliactylModule = heliactylModule;
module.exports.load = async function (app, db) {
  app.post("/nextcloud/activate", async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const userEmail = req.session.userinfo.email;
      const username = req.session.userinfo.username;

      const existingAccount = await db.get(`nextcloud-account-${userId}`);
      if (existingAccount) {
        return res.status(409).json({ error: "Nextcloud account already exists" });
      }

      const nextcloudPassword = generatePassword();
      const login = `user${userId}`;

      // Create Nextcloud user with formatted quota
      const userData = {
        userid: login,
        password: nextcloudPassword,
        displayName: username,
        email: userEmail,
        quota: formatQuota('unlimited')
      };

      const createResponse = await nextcloudRequest('users', 'POST', userData);

      // Store account info in database
      await db.set(`nextcloud-account-${userId}`, {
        login: login,
        password: nextcloudPassword,
        createdAt: new Date().toISOString(),
        status: 'active'
      });

      res.json({
        message: "Nextcloud account created successfully",
        credentials: {
          username: login,
          password: nextcloudPassword,
          url: NEXTCLOUD_URL
        }
      });
    } catch (error) {
      console.error('Activation error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get account information
  app.get("/nextcloud/account", async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      
      const nextcloudAccount = await db.get(`nextcloud-account-${userId}`);
      if (!nextcloudAccount) {
        return res.status(404).json({ error: "No Nextcloud account found" });
      }

      // Get user details from Nextcloud
      const userInfo = await nextcloudRequest(`users/${nextcloudAccount.login}`);
      
      res.json({
        username: nextcloudAccount.login,
        url: NEXTCLOUD_URL,
        status: nextcloudAccount.status,
        createdAt: nextcloudAccount.createdAt,
        pw: nextcloudAccount.password,
        quota: userInfo.quota || 'unlimited',
        email: userInfo.email,
        displayName: userInfo.displayname
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update account settings
  app.put("/nextcloud/account", async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const { displayName, email } = req.body;
      
      const nextcloudAccount = await db.get(`nextcloud-account-${userId}`);
      if (!nextcloudAccount) {
        return res.status(404).json({ error: "No Nextcloud account found" });
      }

      if (displayName) {
        await nextcloudRequest(`users/${nextcloudAccount.login}`, 'PUT', {
          key: 'displayname',
          value: displayName
        });
      }

      if (email) {
        await nextcloudRequest(`users/${nextcloudAccount.login}`, 'PUT', {
          key: 'email',
          value: email
        });
      }

      res.json({ status: "success" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Change password
  app.put("/nextcloud/password", async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      const { newPassword } = req.body;
      
      if (!newPassword) {
        return res.status(400).json({ error: "New password is required" });
      }

      const nextcloudAccount = await db.get(`nextcloud-account-${userId}`);
      if (!nextcloudAccount) {
        return res.status(404).json({ error: "No Nextcloud account found" });
      }

      await nextcloudRequest(`users/${nextcloudAccount.login}`, 'PUT', {
        key: 'password',
        value: newPassword
      });

      // Update stored password
      await db.set(`nextcloud-account-${userId}`, {
        ...nextcloudAccount,
        password: newPassword
      });

      res.json({ status: "success" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Disable account
  app.post("/nextcloud/disable", async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      
      const nextcloudAccount = await db.get(`nextcloud-account-${userId}`);
      if (!nextcloudAccount) {
        return res.status(404).json({ error: "No Nextcloud account found" });
      }

      await nextcloudRequest(`users/${nextcloudAccount.login}/disable`, 'PUT');

      // Update account status
      await db.set(`nextcloud-account-${userId}`, {
        ...nextcloudAccount,
        status: 'disabled'
      });

      res.json({ status: "success" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Enable account
  app.post("/nextcloud/enable", async (req, res) => {
    try {
      const userId = req.session.userinfo.id;
      
      const nextcloudAccount = await db.get(`nextcloud-account-${userId}`);
      if (!nextcloudAccount) {
        return res.status(404).json({ error: "No Nextcloud account found" });
      }

      await nextcloudRequest(`users/${nextcloudAccount.login}/enable`, 'PUT');

      // Update account status
      await db.set(`nextcloud-account-${userId}`, {
        ...nextcloudAccount,
        status: 'active'
      });

      res.json({ status: "success" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
};