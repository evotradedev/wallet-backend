require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { errorHandler } = require('./middleware/errorHandler');
const exchangeRoutes = require('./routes/exchangeRoutes');
const logger = require('./utils/logger');
const {
  updateTokensWithContractAddresses,
  isFirstTokenMissingContractAddress
} = require('./services/tokensInformationService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Static assets (served from wallet-backend/public)
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'evotrade-backend'
  });
});

// Routes
app.use('/api/exchange', exchangeRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, async () => {
  logger.info(`EvoTrade Backend server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // On startup, update tokens.json from CoinStore only if the first token is missing contract address
  logger.info('Backend startup: checking first token contract address in tokens.json...');
  try {
    const needsUpdate = await isFirstTokenMissingContractAddress();

    if (!needsUpdate) {
      logger.info(
        'Backend startup: first token already has contract address, skipping CoinStore token update'
      );
    } else {
      logger.info(
        'Backend startup: first token missing contract address, updating tokens.json from CoinStore...'
      );
      const result = await updateTokensWithContractAddresses();
      if (result.success) {
        logger.info('Backend startup: token update completed successfully', result);
      } else {
        logger.error('Backend startup: token update failed', result);
      }
    }
  } catch (error) {
    logger.error('Backend startup: error during token update', {
      error: error.message,
      stack: error.stack
    });
  }
});

module.exports = app;
