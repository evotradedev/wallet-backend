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
        fromTokenChainId,
        fromTokenChainName,
        toTokenChainId,
        toTokenChainName,
        // Keep backward compatibility with old parameters
        chainId,
        chainName
      } = req.body;

      // Use new parameters if available, otherwise fallback to old ones
      const finalFromTokenChainId = fromTokenChainId || chainId;
      const finalFromTokenChainName = fromTokenChainName || chainName;
      const finalToTokenChainId = toTokenChainId || chainId;
      const finalToTokenChainName = toTokenChainName || chainName;

      // Log the swap request
      logger.info('Swap request received:', {
        fromTokenSymbol,
        fromTokenAddress,
        toTokenSymbol,
        toTokenAddress,
        inputValue,
        outputValue,
        fromTokenChainId: finalFromTokenChainId,
        fromTokenChainName: finalFromTokenChainName,
        toTokenChainId: finalToTokenChainId,
        toTokenChainName: finalToTokenChainName
      });

      let buyOrderResult = null;
      let sellOrderResult = null;
      let buyOrderInfo = null;
      let sellOrderInfo = null;
      let ordAmt = null;
      let withdrawAmount = null;

      // Step 1: Create SELL order if fromTokenSymbol is not USDT
      // SELL order: Sell FROM tokens to get USDT
      if (fromTokenSymbol !== 'USDT') {
        sellOrderResult = await coinstoreService.createOrder({
          symbol: `${fromTokenSymbol}USDT`, // Trading pair: FROM token vs USDT
          side: 'SELL',
          ordType: 'MARKET',
          ordQty: inputValue // FROM input value
        });

        if (!sellOrderResult.success) {
          return res.status(400).json({
            swapResult: false,
            message: 'Failed to create SELL order',
            error: sellOrderResult.error
          });
        }

        logger.info('SELL order created successfully:', sellOrderResult.data);

        // Get SELL order information to extract ordAmt
        const sellOrderId = sellOrderResult.data?.ordId;
        if (sellOrderId) {
          sellOrderInfo = await coinstoreService.getOrderInfo(sellOrderId);
          
          if (!sellOrderInfo.success) {
            return res.status(400).json({
              swapResult: false,
              message: 'Failed to get SELL order information',
              error: sellOrderInfo.error
            });
          }

          ordAmt = sellOrderInfo.data?.ordAmt;
          logger.info('SELL order information retrieved:', {
            ordId: sellOrderId,
            ordAmt: ordAmt
          });
        }
      } else {
        // If FROM token is USDT, ordAmt is inputValue
        ordAmt = inputValue;
        logger.info('FROM token is USDT, using inputValue as ordAmt:', ordAmt);
      }

      // Step 2: Create BUY order if toTokenSymbol is not USDT
      // BUY order: Buy TO tokens using USDT
      if (toTokenSymbol !== 'USDT') {
        if (!ordAmt) {
          return res.status(400).json({
            swapResult: false,
            message: 'ordAmt is required for BUY order but not available'
          });
        }

        buyOrderResult = await coinstoreService.createOrder({
          symbol: `${toTokenSymbol}USDT`, // Trading pair: TO token vs USDT
          side: 'BUY',
          ordType: 'MARKET',
          ordAmt: ordAmt // Use ordAmt from SELL order or inputValue if FROM is USDT
        });

        if (!buyOrderResult.success) {
          return res.status(400).json({
            swapResult: false,
            message: 'Failed to create BUY order',
            error: buyOrderResult.error
          });
        }

        logger.info('BUY order created successfully:', buyOrderResult.data);

        // Get BUY order information to extract ordQty for withdrawal
        const buyOrderId = buyOrderResult.data?.ordId;
        if (buyOrderId) {
          buyOrderInfo = await coinstoreService.getOrderInfo(buyOrderId);
          
          if (!buyOrderInfo.success) {
            return res.status(400).json({
              swapResult: false,
              message: 'Failed to get BUY order information',
              error: buyOrderInfo.error
            });
          }

          withdrawAmount = buyOrderInfo.data?.ordQty;
          logger.info('BUY order information retrieved:', {
            ordId: buyOrderId,
            ordQty: withdrawAmount
          });
        }
      } else {
        // If TO token is USDT, withdrawal amount is ordAmt (from SELL or inputValue)
        withdrawAmount = ordAmt;
        logger.info('TO token is USDT, using ordAmt as withdrawal amount:', withdrawAmount);
      }

      // Step 3: Withdraw TO output value
      // Determine chain type from toTokenChainName
      const chainTypeMap = {
        'Ethereum': 'ERC20',
        'BSC': 'bnbbsc',
        'Tron': 'TRC20',
        'Solana': 'SOL'
      };
      const toTokenChainType = chainTypeMap[finalToTokenChainName] || finalToTokenChainName || 'erc20';

      // Get withdraw address from environment variable
      const withdrawAddress = process.env.WITHDRAW_ADDRESS || '0xe5829e9a19b0A7e524dFd0E0ff55Aff1A2A13D53';

      // Use withdrawAmount from BUY order info, or fallback to outputValue
      const finalWithdrawAmount = withdrawAmount || outputValue;

      const withdrawResult = await coinstoreService.withdraw(
        toTokenSymbol,
        finalWithdrawAmount,
        withdrawAddress,
        toTokenChainType,
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
        buyOrder: buyOrderResult?.data,
        sellOrder: sellOrderResult?.data,
        buyOrderInfo: buyOrderInfo?.data,
        sellOrderInfo: sellOrderInfo?.data,
        withdrawal: withdrawResult.data
      });

      res.json({
        swapResult: true,
        message: 'Swap completed successfully',
        orders: {
          ...(buyOrderResult && { buy: buyOrderResult.data }),
          ...(sellOrderResult && { sell: sellOrderResult.data })
        },
        orderInfo: {
          ...(buyOrderInfo && { buy: buyOrderInfo.data }),
          ...(sellOrderInfo && { sell: sellOrderInfo.data })
        },
        withdrawal: {
          id: withdrawResult.data?.data?.id,
          currencyCode: toTokenSymbol,
          amount: finalWithdrawAmount,
          withdrawAddress: withdrawAddress,
          chainType: toTokenChainType,
          chainId: finalToTokenChainId,
          chainName: finalToTokenChainName,
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

      const chainTypeMap = {
        'Ethereum': 'ERC20',
        'BSC': 'bnbbsc',
        'Tron': 'TRC20',
        'Solana': 'SOL'
      };
      
      const chainType = chainTypeMap[chain] || chain || 'erc20';

      logger.info('Get deposit address request received:', {
        currencyCode,
        chainType
      });

      const result = await coinstoreService.getDepositAddress(currencyCode, chainType);

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
  },

  /**
   * Get token price from Coinstore
   */
  getTokenPrice: async (req, res, next) => {
    try {
      const { priceSymbol } = req.body;

      if (!priceSymbol) {
        return res.status(400).json({
          success: false,
          message: 'priceSymbol is required'
        });
      }

      logger.info('Get token price request received:', {
        priceSymbol
      });

      const result = await coinstoreService.getMarketDepth(priceSymbol, 2);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error?.message || 'Failed to get token price',
          error: result.error
        });
      }

      res.json({
        success: true,
        data: result.data
      });
    } catch (error) {
      logger.error('Error in getTokenPrice controller:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to get token price'
      });
    }
  }
};

module.exports = exchangeController;
