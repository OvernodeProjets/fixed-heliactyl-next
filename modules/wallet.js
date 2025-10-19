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
  "name": "Wallet Module",
  "target_platform": "3.2.0"
};

module.exports.heliactylModule = heliactylModule;

const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { requireAuth } = require("../handlers/requireAuth.js");

module.exports.load = async function (app, db) {
  const router = express.Router();

  const BLOCK_INTERVAL = 15 * 60 * 1000;

  // Helper function to get all addresses from the blockchain
  const getAllAddresses = async () => {
    const transactions = await db.get('transactions') || [];
    const addresses = new Set();
    transactions.forEach(tx => {
      addresses.add(tx.senderId);
      addresses.add(tx.receiverId);
    });
    return Array.from(addresses);
  }

  // Helper function to get all user IDs
  const getAllUserIds = async () => {
    const transactions = await db.get('transactions') || [];
    const userIds = new Set();
    transactions.forEach(tx => {
      if (tx.senderId !== 'MASTER') userIds.add(tx.senderId);
      if (tx.receiverId !== 'MASTER') userIds.add(tx.receiverId);
    });
    return Array.from(userIds);
  };

  // Helper function to get user's balance
  const getUserBalance = async (userId, currency) => {
    if (currency === 'XPL') {
      return await db.get(`coins-${userId}`) || 0;
    } else if (currency === 'XRS') {
      const xrsBalance = await db.get(`xrs-${userId}`) || 0;
      const lockedXRS = await db.get(`xrs-locked-${userId}`) || 0;
      return xrsBalance - lockedXRS;
    } else if (currency === 'XTC') {
      return await db.get(`xtc-${userId}`) || 0; // Added XTC support
    } else {
      throw new Error('Invalid currency');
    }
  };

  // Helper function to update user's balance
  const updateUserBalance = async (userId, currency, amount) => {
    let key;
    if (currency === 'XPL') {
      key = `coins-${userId}`;
    } else if (currency === 'XRS') {
      key = `xrs-${userId}`;
    } else if (currency === 'XTC') {
      key = `xtc-${userId}`; // Added XTC support
    } else {
      throw new Error('Invalid currency');
    }
    const currentBalance = await db.get(key) || 0;
    await db.set(key, currentBalance + amount);
  };

  // Helper function to get external wallet balance
  const getExternalWalletBalance = async (address, currency) => {
    const wallets = await db.get('external_wallets') || [];
    const wallet = wallets.find(w => w.address === address);
    if (!wallet) {
      throw new Error('External wallet not found');
    }
    return wallet[currency.toLowerCase()]; // Handles XTC as well
  };

  // Helper function to update external wallet balance
  const updateExternalWalletBalance = async (address, currency, amount) => {
    const wallets = await db.get('external_wallets') || [];
    const walletIndex = wallets.findIndex(w => w.address === address);
    if (walletIndex === -1) {
      throw new Error('External wallet not found');
    }
    wallets[walletIndex][currency.toLowerCase()] += amount; // Handles XTC as well
    await db.set('external_wallets', wallets);
  };

    // Buy XTC endpoint (GET)
router.get('/xtc/buy/:amount', requireAuth, async (req, res) => {
  const { amount } = req.params; // The amount of XTC the user wants to buy
  const userId = req.session.userinfo.id;
  
  // 1 XTC costs 1 million XPL
  const xplCostPerXTC = 1000000;
  const xtcToBuy = parseInt(amount, 10);
  const totalCostInXPL = xtcToBuy * xplCostPerXTC;

  try {
    // Fetch user's XPL balance
    const userXPLBalance = await getUserBalance(userId, 'XPL');
    
    // Check if user has enough XPL to buy the XTC
    if (userXPLBalance < totalCostInXPL) {
      return res.status(400).json({ error: "Insufficient XPL balance to buy the requested XTC amount." });
    }

    // Deduct the XPL from user's balance
    await updateUserBalance(userId, 'XPL', -totalCostInXPL);
    
    // Add the XTC to user's balance
    await updateUserBalance(userId, 'XTC', xtcToBuy);
    
    // Respond with success message
    res.status(200).json({
      message: `Successfully bought ${xtcToBuy} XTC for ${totalCostInXPL} XPL.`,
      remainingXPLBalance: await getUserBalance(userId, 'XPL'), // Fetch updated XPL balance
      xtcBalance: await getUserBalance(userId, 'XTC') // Fetch updated XTC balance
    });
  } catch (error) {
    console.error('Error during XTC purchase:', error);
    res.status(500).json({ error: "An error occurred during the XTC purchase." });
  }
});

// 1. GET /api/votes
router.get('/votes', requireAuth, async (req, res) => {
    try {
        const votes = await db.get('votes') || [];
        res.status(200).json(votes);
    } catch (error) {
        console.error('Error fetching votes:', error);
        res.status(500).json({ error: 'An error occurred while fetching votes.' });
    }
});

// Liste unerwünschter Wörter
const badWords = ['Fuck', 'Fucking', 'KYS', 'kys', 'shit', 'fucking', 'atqr']; // Füge hier die schlechten Wörter hinzu

// Funktion zur Zensur von Wörtern
function censorBadWords(text) {
    return badWords.reduce((censoredText, badWord) => {
        const regex = new RegExp(`\\b${badWord}\\b`, 'gi'); // Regulärer Ausdruck für Wortgrenzen
        return censoredText.replace(regex, (match) => match[0] + '*'.repeat(match.length - 1));
    }, text);
}

  // Constants for validation
  const MAX_CURRENCY_AMOUNT = 999999999999999; // 1 quadrillion - maximum reasonable amount for our system
  const MIN_CURRENCY_AMOUNT = 1; // Minimum transfer amount
  
  // Updated Transfer endpoint with XTC
  router.post('/transfer',
    requireAuth,
    [
      body('receiverId').isString().notEmpty(),
      body('amount').isInt({ min: MIN_CURRENCY_AMOUNT, max: MAX_CURRENCY_AMOUNT }),
      body('currency').isIn(['XPL', 'XRS', 'XTC']), // Added XTC
    ],
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { receiverId, amount, currency } = req.body;
      const senderId = req.session.userinfo.id;

      if (senderId === receiverId) {
        return res.status(400).json({ error: "Cannot transfer to yourself" });
      }

      // Start a transaction-like operation
      const transactionKey = `transaction-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      
      try {
        const senderBalance = await getUserBalance(senderId, currency);
        if (senderBalance < amount) {
          return res.status(400).json({ error: "Insufficient balance" });
        }

        // Check if receiver is an external wallet or a user
        const externalWallets = await db.get('external_wallets') || [];
        const isExternalReceiver = externalWallets.some(w => w.address === receiverId);

        // Save transaction state
        await db.set(transactionKey, {
          status: 'pending',
          senderId,
          receiverId,
          amount,
          currency,
          isExternalReceiver
        });

        try {
          // Perform the transfer
          await updateUserBalance(senderId, currency, -amount);
          
          if (isExternalReceiver) {
            await updateExternalWalletBalance(receiverId, currency, amount);
          } else {
            await updateUserBalance(receiverId, currency, amount);
          }

          // Mark transaction as completed
          await db.set(transactionKey, { status: 'completed' });
        } catch (error) {
          // If anything fails, revert the sender's balance
          await updateUserBalance(senderId, currency, amount);
          throw error;
        }

        // Log the transaction
        const transaction = {
          senderId,
          receiverId,
          amount,
          currency,
          timestamp: Date.now()
        };

        res.status(200).json({ message: "Transfer successful" });
      } catch (error) {
        console.error('Transfer error:', error);
        res.status(500).json({ error: "An error occurred during the transfer" });
      }
    }
  );

  // Updated external transfer endpoint with XTC
  router.post('/external/transfer',
    [
      body('senderAddress').isString().notEmpty(),
      body('privateKey').isString().notEmpty(),
      body('receiverId').isString().notEmpty(),
      body('amount').isInt({ min: 1 }),
      body('currency').isIn(['XPL', 'XRS', 'XTC']), // Added XTC
    ],
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { senderAddress, privateKey, receiverId, amount, currency } = req.body;

      try {
        const wallets = await db.get('external_wallets') || [];
        const senderWallet = wallets.find(w => w.address === senderAddress && w.privateKey === privateKey);

        if (!senderWallet) {
          return res.status(401).json({ error: "Invalid wallet credentials" });
        }

        if (senderWallet[currency.toLowerCase()] < amount) {
          return res.status(400).json({ error: "Insufficient balance" });
        }

        // Perform the transfer
        senderWallet[currency.toLowerCase()] -= amount;

        // Check if receiver is an external wallet or a user
        const receiverWallet = wallets.find(w => w.address === receiverId);
        if (receiverWallet) {
          receiverWallet[currency.toLowerCase()] += amount;
        } else {
          await updateUserBalance(receiverId, currency, amount);
        }

        await db.set('external_wallets', wallets);

        res.status(200).json({ message: "Transfer successful" });
      } catch (error) {
        console.error('External transfer error:', error);
        res.status(500).json({ error: "An error occurred during the transfer" });
      }
    }
  );

  // Get balance endpoint updated to include XTC
  router.get('/balance',
    requireAuth,
    async (req, res) => {
      const userId = req.session.userinfo.id;
      try {
        const xplBalance = await db.get('coins-' + userId);
        const xrsBalance = await db.get('xrs-' + userId);
        const xtcBalance = await db.get('xtc-' + userId);
        res.status(200).json({ XPL: xplBalance, XRS: xrsBalance || 0, XTC: xtcBalance });
      } catch (error) {
        console.error('Balance fetch error:', error);
        res.status(500).json({ error: "An error occurred while fetching the balance" });
      }
    }
  );

  // Generate a new wallet address (public key)
  function generateWalletAddress() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Generate a new private key
  function generatePrivateKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Create an external wallet
  router.post('/external/create', async (req, res) => {
    const address = generateWalletAddress();
    const privateKey = generatePrivateKey();

    try {
      const wallets = await db.get('external_wallets') || [];
      wallets.push({ address, privateKey, xpl: 0, xrs: 0, xtc: 0 });
      await db.set('external_wallets', wallets);

      res.status(200).json({ address, privateKey, xpl: 0, xrs: 0, xtc: 0 });
    } catch (error) {
      console.error('Error creating external wallet:', error);
      res.status(500).json({ error: "An error occurred while creating the wallet" });
    }
  });

  // View external wallet
  router.get('/external/:address', async (req, res) => {
    const { address } = req.params;

    try {
      const wallets = await db.get('external_wallets') || [];
      const wallet = wallets.find(w => w.address === address);

      if (!wallet) {
        return res.status(404).json({ error: "Wallet not found" });
      }

      res.status(200).json({ address: wallet.address, xpl: wallet.xpl, xrs: wallet.xrs, xtc: wallet.xtc });
    } catch (error) {
      console.error('Error fetching external wallet:', error);
      res.status(500).json({ error: "An error occurred while fetching the wallet" });
    }
  });

  // View transactions for an external wallet
  router.get('/external/:address/transactions', async (req, res) => {
    const { address } = req.params;

    try {
      res.status(200).json({});
    } catch (error) {
      console.error('Error fetching external wallet transactions:', error);
      res.status(500).json({ error: "An error occurred while fetching transactions" });
    }
  });

  // Transfer from external wallet
  router.post('/external/transfer', 
    [
      body('senderAddress').isString().notEmpty(),
      body('privateKey').isString().notEmpty(),
      body('receiverId').isString().notEmpty(),
      body('amount').isInt({ min: 1 }),
      body('currency').isIn(['XPL', 'XRS']),
    ],
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { senderAddress, privateKey, receiverId, amount, currency } = req.body;

      try {
        const wallets = await db.get('external_wallets') || [];
        const senderWallet = wallets.find(w => w.address === senderAddress && w.privateKey === privateKey);

        if (!senderWallet) {
          return res.status(401).json({ error: "Invalid wallet credentials" });
        }

        if (senderWallet[currency.toLowerCase()] < amount) {
          return res.status(400).json({ error: "Insufficient balance" });
        }

        // Perform the transfer
        senderWallet[currency.toLowerCase()] -= amount;

        // Check if receiver is an external wallet or a user
        const receiverWallet = wallets.find(w => w.address === receiverId);
        if (receiverWallet) {
          receiverWallet[currency.toLowerCase()] += amount;
        } else {
          await updateUserBalance(receiverId, currency, amount);
        }

        await db.set('external_wallets', wallets);

        // Log the transaction
        const transaction = {
          senderId: senderAddress,
          receiverId,
          amount,
          currency,
          timestamp: Date.now()
        };

        res.status(200).json({ message: "Transfer successful" });
      } catch (error) {
        console.error('External transfer error:', error);
        res.status(500).json({ error: "An error occurred during the transfer" });
      }
    }
  );

 // Custom streaming solution for large JSON object
function createJsonObjectReadStream(jsonObject) {
  const keys = Object.keys(jsonObject);
  let index = 0;

  return new Readable({
    objectMode: true,
    read() {
      if (index < keys.length) {
        const key = keys[index];
        this.push({ key, value: jsonObject[key] });
        index++;
      } else {
        this.push(null);
      }
    }
  });
}

// Modified processTransactions function
const processTransactions = (filter, limit = Infinity) => {
  return new Promise((resolve, reject) => {
    db.get('transactions')
      .then(transactions => {
        if (!transactions) {
          resolve([]);
          return;
        }

        const results = [];
        const transactionArray = Object.values(transactions);

        // Process transactions in chunks
        const chunkSize = 10000; // Adjust this value based on your system's capabilities
        for (let i = 0; i < transactionArray.length && results.length < limit; i += chunkSize) {
          const chunk = transactionArray.slice(i, i + chunkSize);
          chunk.forEach(transaction => {
            if (filter(transaction) && results.length < limit) {
              results.push(transaction);
            }
          });
        }

        resolve(results);
      })
      .catch(reject);
  });
};

  // Optimized organizeTransactions function
const organizeTransactions = (transactions, startTime, endTime) => {
  const blocks = {};
  let start = startTime;
  let end = endTime;

  // If start and end times are not provided, calculate them
  if (!start || !end) {
    transactions.forEach(t => {
      if (!start || t.timestamp < start) start = t.timestamp;
      if (!end || t.timestamp > end) end = t.timestamp;
    });
  }

  // Process transactions in chunks to avoid stack overflow
  const chunkSize = 10000; // Adjust this value based on your system's capabilities
  for (let i = 0; i < transactions.length; i += chunkSize) {
    const chunk = transactions.slice(i, i + chunkSize);
    
    chunk.forEach(transaction => {
      if (transaction.timestamp >= start && transaction.timestamp <= end) {
        const blockNumber = Math.floor((transaction.timestamp - start) / BLOCK_INTERVAL);
        if (!blocks[blockNumber]) {
          blocks[blockNumber] = {
            blockNumber,
            timestamp: start + blockNumber * BLOCK_INTERVAL,
            transactions: []
          };
        }
        blocks[blockNumber].transactions.push(transaction);
      }
    });
  }

  return Object.values(blocks).sort((a, b) => b.blockNumber - a.blockNumber);
};

  // Explorer endpoints
router.get('/explorer/blocks', async (req, res) => {
  try {
    //const transactions = await processTransactions(() => true);
    //const blocks = organizeTransactions(transactions).reverse();
    res.status(200).json({});
  } catch (error) {
    console.error('Error fetching blocks:', error);
    res.status(500).json({ error: "An error occurred while fetching blocks" });
  }
});

  router.get('/explorer/block/:blockNumber', async (req, res) => {
    const blockNumber = parseInt(req.params.blockNumber);
    try {
      res.status(200).json({});
    } catch (error) {
      console.error('Error fetching block:', error);
      res.status(500).json({ error: "An error occurred while fetching the block" });
    }
  });

  router.get('/explorer/latest-transactions', async (req, res) => {
    try {
      res.status(200).json({});
    } catch (error) {
      console.error('Error fetching latest transactions:', error);
      res.status(500).json({ error: "An error occurred while fetching latest transactions" });
    }
  });

  router.get('/explorer/24h-volume', async (req, res) => {
    try {
      res.status(200).json({
        
      });
    } catch (error) {
      console.error('Error calculating 24h volume:', error);
      res.status(500).json({ error: "An error occurred while calculating 24h volume" });
    }
  });

  router.get('/explorer/address/:address', async (req, res) => {
    const { address } = req.params;
    try {
      res.status(200).json({});
    } catch (error) {
      console.error('Error fetching address transactions:', error);
      res.status(500).json({ error: "An error occurred while fetching address transactions" });
    }
  });

  router.get('/explorer/:currency', async (req, res) => {
    const { currency } = req.params;
    if (currency !== 'XPL' && currency !== 'XRS') {
      return res.status(400).json({ error: "Invalid currency. Use XPL or XRS." });
    }
    try {
      res.status(200).json({});
    } catch (error) {
      console.error(`Error fetching ${currency} transactions:`, error);
      res.status(500).json({ error: `An error occurred while fetching ${currency} transactions` });
    }
  });

  router.get('/balance/:address', async (req, res) => {
    const address = req.params.address;
    try {
      const xplBalance = await db.get('coins-' + address) || 0;
      const xrsBalance = await db.get('xrs-' + address) || 0;
      res.status(200).json({ XPL: xplBalance, XRS: xrsBalance });
    } catch (error) {
      console.error('Balance fetch error:', error);
      res.status(500).json({ error: "An error occurred while fetching the balance" });
    }
  });
  
  app.use('/wallet', router);
};

