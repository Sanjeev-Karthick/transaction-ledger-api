const pino = require('pino');

function createLogger(config) {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'transaction-ledger-api' },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[REDACTED]',
    },
  });
}

module.exports = { createLogger };
