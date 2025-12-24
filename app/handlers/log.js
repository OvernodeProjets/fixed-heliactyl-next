const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const crypto = require('crypto');
const { default: axios } = require("axios");

async function addNotification(db, userId, action, name, ip, userAgent = null) {
  const notifications = (await db.get(`notifications-${userId}`)) || [];
  notifications.push({
    action,
    name,
    ip,
    userAgent: userAgent,
    timestamp: new Date().toISOString()
  });
  await db.set(`notifications-${userId}`, notifications);
}

/**
 * Log a transaction to the database and Discord
 * 
 * @param {Object} db - Database instance
 * @param {string} userId - User ID for the transaction
 * @param {string} type - Transaction type: 'credit' (receiving) or 'debit' (sending)
 * @param {number} amount - Amount of the transaction (always positive)
 * @param {number} balanceAfter - User's balance after the transaction
 * @param {Object} details - Additional transaction details
 * @param {string} [details.description] - Description of the transaction
 * @param {string} [details.senderId] - ID of the sender (use system name for rewards, e.g., 'daily-rewards', 'afk-rewards')
 * @param {string} [details.receiverId] - ID of the receiver (usually the userId for credits)
 * @param {string} [details.currency] - Currency name (defaults to settings.website.currency)
 * 
 * @returns {Promise<string>} Transaction key
 * 
 * @example
 * // User receives coins (e.g., daily reward, AFK reward)
 * await logTransaction(db, userId, 'credit', 150, currentBalance + 150, {
 *   description: 'Daily coins reward',
 *   senderId: 'daily-rewards',
 *   receiverId: userId
 * });
 * 
 * @example
 * // User spends coins (e.g., store purchase)
 * await logTransaction(db, userId, 'debit', 500, currentBalance - 500, {
 *   description: 'Purchased 1GB RAM',
 *   senderId: userId,
 *   receiverId: 'store'
 * });
 */
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

const discordLog = async (action, message = '', fields = [], isPublic = false) => {
  if (!settings.logging.status) return;

  const isUserAction = settings.logging.actions.user[action];
  const isAdminAction = settings.logging.actions.admin[action];
  const isApiAction = settings.logging.actions.api[action];

  if (!isUserAction && !isAdminAction && !isApiAction) return;

  const embed = {
    embeds: [
      {
        color: hexToDecimal('#FFFFFF'),
        title: `Event: \`${action}\``,
        description: message,
        fields : fields,
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
      return;
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