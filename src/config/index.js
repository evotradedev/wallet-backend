require('dotenv').config();

module.exports = {
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development'
  },
  coinstore: {
    apiUrl: process.env.COINSTORE_API_URL || 'https://api.coinstore.com',
    apiKey: process.env.COINSTORE_API_KEY,
    apiSecret: process.env.COINSTORE_API_SECRET,
    timeout: 30000 // 30 seconds
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};
