const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const fetch = require('node-fetch')

// Helper function to log a transaction
const logTransaction = async (db, userId, type, amount, balanceAfter, details = {}) => {
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

const discordLog = async (action, message) => {
    if (!settings.logging.status) return
    if (!settings.logging.actions.user[action] && !settings.logging.actions.admin[action]) return

    fetch(settings.logging.private, {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            embeds: [
                {
                    color: hexToDecimal('#FFFFFF'),
                    title: `Event: \`${action}\``,
                    description: message,
                    author: {
                        name: 'Heliactyl Logging'
                    },
                    thumbnail: {
                        url: 'https://atqr.pages.dev/favicon2.png' // This is the default Heliactyl logo, you can change it if you want.
                    }
                }
            ]
        })
    })
    .catch(() => {})
}

function hexToDecimal(hex) {
    return parseInt(hex.replace("#", ""), 16)
}

module.exports = {
    discordLog,
    serverActivityLog,
    logTransaction
}