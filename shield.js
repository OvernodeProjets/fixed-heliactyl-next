const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const { LRUCache } = require('lru-cache');

class MemoryStore {
  constructor() {
    // Rate limits cache: Store IP/user request counts
    this.rateLimits = new LRUCache({
      max: 50000, // Maximum number of IPs to track
      ttl: 60 * 1000, // 1 minute TTL
      updateAgeOnGet: true
    });

    // Blacklist cache: Store blocked IPs
    this.blacklist = new LRUCache({
      max: 10000, // Maximum number of blocked IPs
      ttl: 60 * 60 * 1000, // 1 hour TTL
      updateAgeOnGet: true
    });

    // Suspicious activity cache: Track potential threats
    this.suspiciousActivities = new LRUCache({
      max: 25000, // Maximum number of suspicious IPs to track
      ttl: 15 * 60 * 1000, // 15 minutes TTL
      updateAgeOnGet: true
    });

    // Request timing cache: Track request timestamps for rate analysis
    this.requestTimings = new LRUCache({
      max: 100000, // Maximum number of IPs to track timings for
      ttl: 5 * 1000, // 5 seconds TTL
      updateAgeOnGet: true
    });
  }

  // Methods for rate limiting
  async incr(key, options) {
    const current = this.rateLimits.get(key) || 0;
    this.rateLimits.set(key, current + 1);
    return current + 1;
  }

  async decr(key) {
    const current = this.rateLimits.get(key) || 0;
    if (current > 0) {
      this.rateLimits.set(key, current - 1);
    }
  }

  async resetKey(key) {
    this.rateLimits.delete(key);
  }
}

// Create memory store instance
const store = new MemoryStore();

// Key generator function with additional entropy
const keyGenerator = (req) => {
  const userId = req.session?.userinfo?.id;
  const forwardedFor = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const ip = forwardedFor || realIp || req.ip;
  const userAgent = req.headers['user-agent'] || 'no-ua';
  return userId ? `${ip}-${userId}-${userAgent.slice(0, 32)}` : `${ip}-${userAgent.slice(0, 32)}`;
};

// Burst detection configuration
const burstConfig = {
  maxBurst: 20, // Maximum requests in burst window
  burstWindow: 1000, // 1 second window for burst detection
  blockDuration: 300000 // 5 minutes block for burst violations
};

// Rate limiter configuration with adaptive limits
const rateLimiter = rateLimit({
  store: store,
  windowMs: 60 * 1000, // 1 minute window
  max: (req) => {
    // Adjust rate limit based on user type and suspicious score
    const suspiciousScore = store.suspiciousActivities.get(keyGenerator(req)) || 0;
    if (req.session?.userinfo?.admin) return 300; // Higher limit for admins
    if (suspiciousScore > 5) return 20; // Lower limit for suspicious IPs
    return 60; // Default limit
  },
  message: {
    status: 429,
    error: 'Too many requests, please try again later.'
  },
  keyGenerator,
  skip: (req) => {
    const trustedIPs = ['127.0.0.1', '::1']; // Add your trusted IPs
    return trustedIPs.includes(req.ip) || req.session?.userinfo?.admin === true;
  }
});

// Speed limiter with adaptive delays
const speedLimiter = slowDown({
  store: store,
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: (req) => {
    // Adjust delay threshold based on suspicious score
    const suspiciousScore = store.suspiciousActivities.get(keyGenerator(req)) || 0;
    return Math.max(30, 100 - (suspiciousScore * 10)); // Reduce threshold for suspicious IPs
  },
  delayMs: (used, req) => {
    // Exponential backoff with maximum delay
    return Math.min(2000, Math.pow(1.5, used - 100));
  },
  keyGenerator
});

// DDoS protection middleware
const ddosProtection = (app) => {
  // Apply rate and speed limiters globally
  app.use(rateLimiter);
  app.use(speedLimiter);

  // Burst detection and advanced threat middleware
  app.use((req, res, next) => {
    const key = keyGenerator(req);
    
    // Check if IP is blacklisted
    if (store.blacklist.get(key)) {
      return res.status(403).json({
        status: 403,
        error: 'Access temporarily blocked due to suspicious activity'
      });
    }

    // Burst detection logic
    const now = Date.now();
    const requestTimings = store.requestTimings.get(key) || [];
    requestTimings.push(now);
    
    // Keep only requests within burst window
    const windowStart = now - burstConfig.burstWindow;
    const recentRequests = requestTimings.filter(time => time > windowStart);
    store.requestTimings.set(key, recentRequests);

    // Check for burst violations
    if (recentRequests.length > burstConfig.maxBurst) {
      store.blacklist.set(key, true);
      return res.status(429).json({
        status: 429,
        error: 'Rate limit exceeded due to burst traffic'
      });
    }

    // Pattern detection
    const suspicious = checkSuspiciousPatterns(req);
    if (suspicious) {
      const currentScore = store.suspiciousActivities.get(key) || 0;
      const newScore = currentScore + 1;
      store.suspiciousActivities.set(key, newScore);

      // Block if suspicion threshold exceeded
      if (newScore > 10) {
        store.blacklist.set(key, true);
        return res.status(403).json({
          status: 403,
          error: 'Access denied due to suspicious activity'
        });
      }
    }

    next();
  });

  // Add security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });
};

// Helper function to check for suspicious patterns
function checkSuspiciousPatterns(req) {
  // Check headers
  if (!req.headers['user-agent'] || 
      !req.headers['accept'] || 
      req.headers['accept'].includes('*/*')) {
    return true;
  }

  // Check payload size
  if (req.headers['content-length'] && 
      parseInt(req.headers['content-length']) > 1e6) {
      return true;
  }

  // Check request method pattern
  if (req.method !== 'GET' && 
      !req.headers['content-type']) {
      return true;
  }

  // Check for suspicious query strings
  if (req.query && Object.keys(req.query).length > 20) {
    return true;
  }

  // Check for suspicious URL patterns
  const suspiciousPatterns = [
    /\.\.[\/\\]/,  // Directory traversal attempts
    /(exec|eval|function|alert)\(/i,  // Code injection attempts
    /<script|javascript:/i,  // XSS attempts
    /union.*select|insert.*into|delete.*from/i  // SQL injection attempts
  ];

  const url = req.originalUrl || req.url;
  return suspiciousPatterns.some(pattern => pattern.test(url));
}

module.exports = ddosProtection;