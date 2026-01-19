const coinstoreService = require('../services/coinstoreService');
const logger = require('../utils/logger');

const exchangeController = {
  /**
   * Execute token swap
   */
  executeSwap: async (req, res, next) => {
    try {
      const { 
        fromTokenSymbol, 
        fromTokenAddress, 
        toTokenSymbol, 
        toTokenAddress, 
        inputValue, 
        outputValue,
        chainId,
        chainName
      } = req.body;

      // Log the swap request
      logger.info('Swap request received:', {
        fromTokenSymbol,
        fromTokenAddress,
        toTokenSymbol,
        toTokenAddress,
        inputValue,
        outputValue,
        chainId,
        chainName
      });

      // Step 1: Create BUY order
      // BUY order: Buy TO tokens (symbol: TOUSDT) with quantity = FROM input value
      // Note: For MARKET BUY orders, we should use ordAmt (amount in quote currency)
      // but per user requirements, using ordQty
      const buyOrderResult = await coinstoreService.createOrder({
        symbol: `${fromTokenSymbol}USDT`, // Trading pair: TO token vs USDT
        side: 'BUY',
        ordType: 'MARKET',
        ordQty: inputValue // FROM input value (as per user requirement)
      });

      if (!buyOrderResult.success) {
        return res.status(400).json({
          swapResult: false,
          message: 'Failed to create BUY order',
          error: buyOrderResult.error
        });
      }

      logger.info('BUY order created successfully:', buyOrderResult.data);

      // Step 2: Create SELL order
      // SELL order: Sell FROM tokens (symbol: FROMUSDT) with quantity = TO output value
      // Note: This may need adjustment based on actual trading logic
      const sellOrderResult = await coinstoreService.createOrder({
        symbol: `${toTokenSymbol}USDT`, // Trading pair: FROM token vs USDT
        side: 'SELL',
        ordType: 'MARKET',
        ordQty: outputValue // TO output value (as per user requirement)
      });

      if (!sellOrderResult.success) {
        return res.status(400).json({
          swapResult: false,
          message: 'Failed to create SELL order',
          error: sellOrderResult.error
        });
      }

      logger.info('SELL order created successfully:', sellOrderResult.data);

      // Step 3: Withdraw TO output value
      // Determine chain type from chain name
      const chainTypeMap = {
        'Ethereum': 'erc20',
        'BSC': 'bep20',
        'Tron': 'trc20',
        'Solana': 'sol'
      };
      const chainType = chainTypeMap[chainName] || 'erc20';

      const withdrawResult = await coinstoreService.withdraw(
        toTokenSymbol,
        outputValue,
        toTokenAddress || '0x0000000000000000000000000000000000000000',
        chainType,
        ''
      );

      if (!withdrawResult.success) {
        return res.status(400).json({
          swapResult: false,
          message: 'Withdrawal failed',
          withdrawalError: withdrawResult.error
        });
      }

      // Success response
      logger.info('Swap completed successfully:', {
        buyOrder: buyOrderResult.data,
        sellOrder: sellOrderResult.data,
        withdrawal: withdrawResult.data
      });

      res.json({
        swapResult: true,
        message: 'Swap completed successfully',
        orders: {
          buy: buyOrderResult.data,
          sell: sellOrderResult.data
        },
        withdrawal: {
          id: withdrawResult.data?.data?.id,
          currencyCode: toTokenSymbol,
          amount: outputValue,
          address: toTokenAddress,
          chainType,
          status: 'success'
        }
      });
    } catch (error) {
      logger.error('Error in executeSwap controller:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      res.status(400).json({
        swapResult: false,
        message: error.message || "Swap failed"
      });
    }
  },

  /**
   * Execute withdrawal
   */
  withdraw: async (req, res, next) => {
    try {
      const { currencyCode, amount, address, chainType, tag } = req.body;

      const result = await coinstoreService.withdraw(
        currencyCode,
        amount,
        address,
        chainType,
        tag
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
      logger.error('Error in withdraw controller:', error);
      next(error);
    }
  },

  /**
   * Get deposit address from Coinstore
   */
  getDepositAddress: async (req, res, next) => {
    try {
      const { currencyCode, chain } = req.body;

      logger.info('Get deposit address request received:', {
        currencyCode,
        chain
      });

      const result = await coinstoreService.getDepositAddress(currencyCode, chain);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error?.message || 'Failed to get deposit address',
          error: result.error
        });
      }

      res.json({
        success: true,
        data: result.data
      });
    } catch (error) {
      logger.error('Error in getDepositAddress controller:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to get deposit address'
      });
    }
  }
};

module.exports = exchangeController;
