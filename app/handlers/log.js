const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const fetch = require('node-fetch')
const crypto = require('crypto');
const { default: axios } = require("axios");

async function addNotification(db, userId, action, name, ip) {
  const notifications = (await db.get(`notifications-${userId}`)) || [];
  notifications.push({
    action,
    name,
    ip,
    timestamp: new Date().toISOString()
  });
  await db.set(`notifications-${userId}`, notifications);
}

// Helper function to log a transaction
const logTransaction = async (db, userId, type, amount, balanceAfter, details = {}) => {
  if (details.currency === undefined) {
    details.currency = settings.website.currency;
}
  const transactionKey = `transaction-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const transaction = {
    transactionKey,
    status: 'completed',
    type, // 'debit' or 'credit'
    amount,
    balanceAfter,
    timestamp: Date.now(),
    ...details
  };

  const userTransactions = await db.get(`transactions-${userId}`) || [];
  userTransactions.push(transaction);
  await db.set(`transactions-${userId}`, userTransactions);

  discordLog('transaction', `User ID: \`${userId}\` | Type: \`${type}\` | Amount: \`${amount}\` | Balance After: \`${balanceAfter}\` | Details: \`${JSON.stringify(details)}\``);

  return transactionKey;
};

const serverActivityLog = async (db, serverId, action, details) => {
    const timestamp = new Date().toISOString();
    const activityLog = await db.get(`activity_log_${serverId}`) || [];
  
    activityLog.unshift({ timestamp, action, details });
  
    // Keep only the last 100 activities
    if (activityLog.length > 100) {
      activityLog.pop();
    }
  
    await db.set(`activity_log_${serverId}`, activityLog);
}

const discordLog = async (action, message, isPublic = false) => {
  if (!settings.logging.status) return;

  const isUserAction = settings.logging.actions.user[action];
  const isAdminAction = settings.logging.actions.admin[action];

  if (!isUserAction && !isAdminAction) return;

  const embed = {
    embeds: [
      {
        color: hexToDecimal('#FFFFFF'),
        title: `Event: \`${action}\``,
        description: message,
        author: { name: isPublic ? 'Heliactyl Public Logging' : 'Heliactyl Logging' },
        thumbnail: {
          url: settings.website.domain + "/assets/logo.png" || "https://i.imgur.com/5D0jaaX.png"  // Default Heliactyl logo
        },
      },
    ],
  };

  // Public logging (if enabled)
  if (isPublic && settings.logging.public) {
    try {
      await axios.post(settings.logging.public, embed, {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.error('Public log failed:', e.message);
    }
  }

  // Private logging (always send if defined)
  if (settings.logging.private) {
    try {
      await axios.post(settings.logging.private, embed, {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.error('Private log failed:', e.message);
    }
  }
};

function hexToDecimal(hex) {
    return parseInt(hex.replace("#", ""), 16)
}

module.exports = {
    discordLog,
    serverActivityLog,
    logTransaction,
    addNotification
}