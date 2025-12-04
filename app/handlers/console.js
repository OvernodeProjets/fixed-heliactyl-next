const winston = require("winston");
const cluster = require("cluster");
const path = require("path");
const fs = require("fs");

function createLogger() {
  // Determine context (master or worker)
  const processContext = cluster.isMaster 
    ? "master" 
    : `worker-${cluster.worker?.id || 'unknown'}`;
  
  // Custom format with better object/error handling
  const customFormat = winston.format.printf(({ level, message, timestamp, context, ...meta }) => {
    const ctx = context || processContext;
    let output = `${timestamp} [${ctx}] ${level}: ${message}`;
    
    // Append metadata if present
    if (Object.keys(meta).length > 0) {
      output += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return output;
  });

  // Create logs directory if it doesn't exist
  const logsDir = path.join(__dirname, '../../logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }), // Capture stack traces
      customFormat
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize({ all: true }),
          customFormat
        )
      }),
      // Optional file transport (errors only)
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
      // All logs
      new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      })
    ],
  });

  // Helper to format any value for logging
  const formatValue = (value) => {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (value instanceof Error) {
      return `${value.name}: ${value.message}\n${value.stack}`;
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return value.toString();
      }
    }
    return String(value);
  };

  // Store original console methods
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  // Replace console methods with Winston logger
  console.log = function (...args) {
    const message = args.map(formatValue).join(' ');
    logger.info(message);
  };

  console.info = function (...args) {
    const message = args.map(formatValue).join(' ');
    logger.info(message);
  };

  console.warn = function (...args) {
    const message = args.map(formatValue).join(' ');
    logger.warn(message);
  };

  console.error = function (...args) {
    const message = args.map(formatValue).join(' ');
    logger.error(message);
  };

  console.debug = function (...args) {
    const message = args.map(formatValue).join(' ');
    logger.debug(message);
  };

  // Expose original methods if needed (e.g., for debugging the logger itself)
  logger.originalConsole = originalConsole;

  return logger;
}

module.exports = createLogger;
