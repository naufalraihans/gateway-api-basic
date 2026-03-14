const pino = require('pino');

// Baileys requires a pino logger instance.
const logger = pino({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
});

module.exports = logger;
