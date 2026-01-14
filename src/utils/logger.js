const config = require('../config');

const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = logLevels[config.logging.level] || logLevels.info;

const logger = {
  error: (...args) => {
    if (logLevels.error <= currentLevel) {
      console.error('[ERROR]', new Date().toISOString(), ...args);
    }
  },
  warn: (...args) => {
    if (logLevels.warn <= currentLevel) {
      console.warn('[WARN]', new Date().toISOString(), ...args);
    }
  },
  info: (...args) => {
    if (logLevels.info <= currentLevel) {
      console.info('[INFO]', new Date().toISOString(), ...args);
    }
  },
  debug: (...args) => {
    if (logLevels.debug <= currentLevel) {
      console.debug('[DEBUG]', new Date().toISOString(), ...args);
    }
  }
};

module.exports = logger;
