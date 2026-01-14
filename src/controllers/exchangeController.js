const coinstoreService = require('../services/coinstoreService');
const logger = require('../utils/logger');

const exchangeController = {
  /**
   * Get exchange quote
   */
  getQuote: async (req, res, next) => {
    try {
      const { fromToken, toToken, amount, chainId } = req.body;

      const result = await coinstoreService.getQuote(fromToken, toToken, amount, chainId);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        data: result.data
      });
    } catch (error) {
      logger.error('Error in getQuote controller:', error);
      next(error);
    }
  },

  /**
   * Execute token swap
   */
  executeSwap: async (req, res, next) => {
    try {
      const { fromToken, toToken, amount, recipient, chainId, ...additionalParams } = req.body;

      const result = await coinstoreService.executeSwap(
        fromToken,
        toToken,
        amount,
        recipient,
        chainId,
        additionalParams
      );

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        data: result.data
      });
    } catch (error) {
      logger.error('Error in executeSwap controller:', error);
      next(error);
    }
  },

  /**
   * Get supported tokens
   */
  getSupportedTokens: async (req, res, next) => {
    try {
      const { chainId } = req.params;

      const result = await coinstoreService.getSupportedTokens(parseInt(chainId));

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        data: result.data
      });
    } catch (error) {
      logger.error('Error in getSupportedTokens controller:', error);
      next(error);
    }
  },

  /**
   * Get transaction status
   */
  getTransactionStatus: async (req, res, next) => {
    try {
      const { txHash } = req.params;

      const result = await coinstoreService.getTransactionStatus(txHash);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

      res.json({
        success: true,
        data: result.data
      });
    } catch (error) {
      logger.error('Error in getTransactionStatus controller:', error);
      next(error);
    }
  }
};

module.exports = exchangeController;
