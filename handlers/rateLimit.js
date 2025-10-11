const rateLimit = require('express-rate-limit');
const loadConfig = require('./config');

/**
 * Create a rate limiter based on config.toml settings
 * @returns {Object} Object with global and specific rate limiters
 */
function createRateLimiter() {
  const settings = loadConfig('./config.toml');
  const rateLimits = settings.api.client.ratelimits;

  // Create a map of path-specific limiters
  const specificLimiters = {};

  Object.entries(rateLimits).forEach(([path, windowSeconds]) => {
    specificLimiters[path] = rateLimit({
      windowMs: windowSeconds * 1000,
      max: 1,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'Too many requests, please try again later.',
        retryAfter: windowSeconds
      },
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      keyGenerator: (req) => {
        return req.session?.userinfo?.id || req.ip;
      },
      handler: (req, res) => {
        const allQueries = Object.entries(req.query);
        let queryString = '';
        
        for (let query of allQueries) {
          queryString += `&${query[0]}=${query[1]}`;
        }
        
        if (queryString) {
          queryString = '?' + queryString.slice(1);
        }

        const pathname = req._parsedUrl?.pathname || req.path;
        const redirectPath = (pathname.startsWith('/') ? pathname : '/' + pathname) + queryString;
        
        setTimeout(() => {
          res.redirect(redirectPath);
        }, 1000);
      }
    });
  });

  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Max 100 requests per 15 minutes per IP/user
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: 900 // 15 minutes in seconds
    },
    keyGenerator: (req) => {
      return req.session?.userinfo?.id || req.ip;
    },
    // Skip static files and assets
    skip: (req) => {
      const path = req.path;
      return path.startsWith('/static') || 
             path.startsWith('/assets') || 
             path.startsWith('/public') ||
             path.match(/\.(css|js|jpg|jpeg|png|gif|svg|ico|woff|woff2|ttf)$/);
    }
  });

  // Return middleware that applies both limiters
  return {
    // Global limiter to apply first
    global: globalLimiter,
    
    // Specific limiter to apply after
    specific: (req, res, next) => {
      const pathname = req._parsedUrl?.pathname || req.path;
      
      if (specificLimiters[pathname]) {
        return specificLimiters[pathname](req, res, next);
      }
      
      next();
    }
  };
}

module.exports = createRateLimiter;