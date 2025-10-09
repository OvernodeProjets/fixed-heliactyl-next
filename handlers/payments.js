const axios = require('axios');
const crypto = require('crypto');

class PaymentProcessor {
  constructor(db, settings) {
    this.db = db;
    this.settings = settings;
    this.hoodpayConfig = {
      apiKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjI0MzU3IiwiZXhwIjoyMDQ3NzQ0OTY1fQ.BAVwDDtMqpylPCoLzoytdmwZbMUH6rA98JqrN6G54-4',
      businessId: '22559',
      baseUrl: 'https://api.hoodpay.io/v1'
    };

    // Conversion rate: €1.80 = 1250 coins
    this.CONVERSION_RATE = 1250 / 1.80;
    this.MIN_PURCHASE_AMOUNT = 0.98; // Minimum purchase amount in EUR

    // Payment status mapping
    this.PAYMENT_STATUS = {
      AWAITING_PAYMENT: 'pending',
      PENDING: 'pending',
      PROCESSING: 'processing',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
      EXPIRED: 'expired'
    };
  }

  generateOrderId() {
    return `order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  calculateCoins(amountEUR) {
    return Math.floor(amountEUR * this.CONVERSION_RATE);
  }

  validateAmount(amount) {
    if (!Number.isFinite(amount) || amount < this.MIN_PURCHASE_AMOUNT) {
      throw new BillingError(`Minimum purchase amount is €${this.MIN_PURCHASE_AMOUNT}`, 'INVALID_AMOUNT');
    }
  }

  formatAmount(amount) {
    // Ensure amount is a number with exactly 2 decimal places
    return parseFloat(amount.toFixed(2));
  }

  async createPayment(userId, amountEUR, customerEmail = null) {
    try {
      this.validateAmount(amountEUR);
      
      const orderId = this.generateOrderId();
      const coinsAmount = this.calculateCoins(amountEUR);
      const formattedAmount = this.formatAmount(amountEUR);

      const paymentData = {
        name: `${coinsAmount} XPL Coins Purchase`,
        description: `Purchase ${coinsAmount} XPL coins for €${formattedAmount}`,
        currency: 'EUR',
        amount: formattedAmount,
        customerEmail: customerEmail || undefined,
        metadata: {
          orderId: orderId.toString(),
          userId: userId.toString(),
          coinsAmount: coinsAmount.toString() // Convert to string
        },
        redirectUrl: 'https://frac.gg/store/payment/complete',
        notifyUrl: 'https://frac.gg/api/payment/webhook'
      };

      // Remove any undefined values
      Object.keys(paymentData).forEach(key => 
        paymentData[key] === undefined && delete paymentData[key]
      );

      console.log('Payment Request Data:', JSON.stringify(paymentData, null, 2));

      const response = await axios.post(
        `${this.hoodpayConfig.baseUrl}/businesses/${this.hoodpayConfig.businessId}/payments`,
        paymentData,
        {
          headers: {
            'Authorization': `Bearer ${this.hoodpayConfig.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Store payment information in our database (here we can keep numbers as numbers)
      await this.db.set(`payment-${orderId}`, {
        orderId,
        userId,
        amount: formattedAmount,
        coins: coinsAmount,
        paymentId: response.data.data.id,
        status: 'pending',
        created: Date.now()
      });

      return {
        orderId,
        paymentUrl: response.data.data.url,
        amount: formattedAmount,
        coins: coinsAmount
      };
    } catch (error) {
      console.error('[ERROR] Failed to create payment:', error.response?.data || error);
      
      if (error.response?.data?.errors) {
        console.log('HoodPay Validation Errors:', error.response.data.errors);
        const errorMessage = error.response.data.errors.join(', ');
        throw new BillingError(errorMessage, 'PAYMENT_CREATION_FAILED');
      }
      
      throw new BillingError('Failed to create payment', 'PAYMENT_CREATION_FAILED');
    }
  }

  async processSuccessfulPayment(orderId) {
    const payment = await this.db.get(`payment-${orderId}`);
    if (!payment || payment.status === 'completed') return;

    const userId = payment.userId;
    const currentCoins = await this.db.get(`coins-${userId}`) || 0;
    
    // Update user's coins
    await this.db.set(`coins-${userId}`, currentCoins + payment.coins);
    
    // Update payment status
    payment.status = 'completed';
    payment.completedAt = Date.now();
    await this.db.set(`payment-${orderId}`, payment);

    // Log the transaction
    await billingManager.logHistory(userId, payment.coins, 'purchase');

    return payment;
  }

  async verifyAndProcessWebhook(paymentId, paymentStatus) {
    try {
      // Verify payment status with Hoodpay
      const response = await axios.get(
        `${this.hoodpayConfig.baseUrl}/businesses/${this.hoodpayConfig.businessId}/payments/${paymentId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.hoodpayConfig.apiKey}`
          }
        }
      );

      const paymentData = response.data.data;
      const orderId = paymentData.metadata?.orderId;

      if (!orderId) {
        throw new Error('Invalid order ID in payment metadata');
      }

      const payment = await this.db.get(`payment-${orderId}`);
      if (!payment) {
        throw new Error('Payment not found');
      }

      // Update payment status
      payment.status = this.PAYMENT_STATUS[paymentStatus];
      await this.db.set(`payment-${orderId}`, payment);

      // Process completed payments
      if (paymentStatus === 'COMPLETED') {
        await this.processSuccessfulPayment(orderId);
      }

      return true;
    } catch (error) {
      console.error('[ERROR] Failed to process webhook:', error);
      return false;
    }
  }
}

module.exports = PaymentProcessor;
