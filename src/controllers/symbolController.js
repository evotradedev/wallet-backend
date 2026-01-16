const coinstoreService = require('../services/coinstoreService');
const logger = require('../utils/logger');

const symbolController = {
  /**
   * Get all symbols with latest prices
   * Fetches symbol price data from CoinStore ticker API
   */
  getAllSymbolsWithDetails: async (req, res, next) => {
    const startTime = Date.now();
    
    try {
      logger.info('Symbol API Request: getAllSymbolsWithDetails', {
        timestamp: new Date().toISOString(),
        ip: req.ip
      });

      // Get all symbols with prices from CoinStore
      const symbolsResult = await coinstoreService.getAllSymbols();
      
      if (!symbolsResult.success) {
        logger.error('Failed to fetch symbols', symbolsResult.error);
        return res.status(400).json({
          success: false,
          error: symbolsResult.error
        });
      }

      const symbols = symbolsResult.data?.data || [];
      logger.info(`Fetched ${symbols.length} symbols from CoinStore`);

      const duration = Date.now() - startTime;
      logger.info('Symbol API Response: getAllSymbolsWithDetails - Success', {
        symbolCount: symbols.length,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        data: symbols,
        count: symbols.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error in getAllSymbolsWithDetails controller:', {
        error: error.message,
        stack: error.stack,
        duration: `${duration}ms`
      });
      next(error);
    }
  }
};

module.exports = symbolController;
