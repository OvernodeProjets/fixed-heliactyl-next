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
const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");

module.exports.load = async function (app, db) {
  const router = express.Router();

  // Helper function to get user's balance
  const getUserBalance = async (userId, currency) => {
    if (currency === (settings.website.currency)) {
      return await db.get(`coins-${userId}`) || 0;
    } else {
      throw new Error('Invalid currency');
    }
  };

  // Helper function to update user's balance
  const updateUserBalance = async (userId, currency, amount) => {
    let key;
    if (currency === (settings.website.currency)) {
      key = `coins-${userId}`;
    } else {
      throw new Error('Invalid currency');
    }
    const currentBalance = await db.get(key) || 0;
    await db.set(key, currentBalance + amount);
  };

  // Constants for validation
  const MAX_CURRENCY_AMOUNT = 999999999999999; // 1 quadrillion - maximum reasonable amount for our system
  const MIN_CURRENCY_AMOUNT = 1; // Minimum transfer amount
  
  router.post('/transfer',
    requireAuth,
    [
      body('receiverId').isString().notEmpty(),
      body('amount').isInt({ min: MIN_CURRENCY_AMOUNT, max: MAX_CURRENCY_AMOUNT }),
      body('currency').isIn([settings.website.currency]),
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
      let existingSenderTransactions = await db.get(`transactions-${senderId}`) || [];
      let existingReceiverTransactions = await db.get(`transactions-${receiverId}`) || [];

      try {
        const senderBalance = await getUserBalance(senderId, currency);
        if (senderBalance < amount) {
          return res.status(400).json({ error: "Insufficient balance" });
        }

        // Log the transaction
        const transactionSender = {
          transactionKey,
          status: 'pending',
          senderId,
          receiverId,
          amount: -amount,
          currency,
          transactionKey,
          timestamp: Date.now()
        };

        const transactionReceiver = {
          transactionKey,
          status: 'pending',
          senderId,
          receiverId,
          amount: +amount,
          currency,
          transactionKey,
          timestamp: Date.now()
        };
          

        existingSenderTransactions.push(transactionSender);
        existingReceiverTransactions.push(transactionReceiver);

        try {
          // Deduct from sender
          await updateUserBalance(senderId, currency, -amount);
          
          // Add to receiver
          await updateUserBalance(receiverId, currency, amount);

          // Mark transaction as completed
          existingSenderTransactions.push({ ...transactionSender, status: 'completed' });
          existingReceiverTransactions.push({ ...transactionReceiver, status: 'completed' });
        } catch (error) {
          // If anything fails, revert the sender's balance
          await updateUserBalance(senderId, currency, amount);
          throw error;
        }

        await db.set(`transactions-${senderId}`, existingSenderTransactions);
        await db.set(`transactions-${receiverId}`, existingReceiverTransactions);

        res.status(200).json({ message: "Transfer successful" });
      } catch (error) {
        console.error('Transfer error:', error);
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
        const balance = await db.get('coins-' + userId);
        res.status(200).json({ balance });
      } catch (error) {
        console.error('Balance fetch error:', error);
        res.status(500).json({ error: "An error occurred while fetching the balance" });
      }
    }
  );

  router.get('/transactions',
    requireAuth,
    async (req, res) => {
      const userId = req.session.userinfo.id;
      try {
        const transactions = await db.get(`transactions-${userId}`) || [];
        res.status(200).json({ transactions });
      } catch (error) {
        console.error('Transactions fetch error:', error);
        res.status(500).json({ error: "An error occurred while fetching transactions" });
      }
    });
  
  app.use('/wallet', router);
};

