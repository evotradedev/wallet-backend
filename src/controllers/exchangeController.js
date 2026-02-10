const fs = require('fs');
const path = require('path');
const coinstoreService = require('../services/coinstoreService');
const blockchainService = require('../services/blockchainService');
const tokenListService = require('../services/tokenListService');
const logger = require('../utils/logger');

const exchangeController = {
  /**
   * Process transfer fee: Buy native token and withdraw it
   */
  processTransferFee: async (transferfeeUSDT, chainNativeSymbol, toTokenChainType, withdrawAddress) => {
    try {
      // Step 1: Create BUY order for native token using transferfeeUSDT
      // Retry every 15s for up to 33 minutes if CoinStore returns:
      // { code: 1101, message: 'Insufficient quantity available' }
      const retryIntervalMs = 15 * 1000;
      const maxWaitMs = 33 * 60 * 1000;
      const deadlineMs = Date.now() + maxWaitMs;

      let buyOrderResult = null;
      let attempt = 0;

      while (Date.now() < deadlineMs) {
        attempt += 1;

        buyOrderResult = await coinstoreService.createOrder({
          symbol: `${chainNativeSymbol}USDT`, // Trading pair: Native token vs USDT
          side: 'BUY',
          ordType: 'MARKET',
          ordAmt: transferfeeUSDT.toString() // Use transferfeeUSDT
        });

        if (buyOrderResult.success) {
          break;
        }

        const err = buyOrderResult?.error || {};
        const errCode = err?.code;
        const errMessage = err?.message;
        const isInsufficientQty =
          String(errCode) === '1101' ||
          (typeof errMessage === 'string' && /insufficient quantity available/i.test(errMessage));

        // Only retry for insufficient liquidity/quantity case
        if (!isInsufficientQty) {
          return {
            success: false,
            error: 'Failed to create BUY order for transfer fee',
            details: buyOrderResult.error
          };
        }

        const now = Date.now();
        const remainingMs = Math.max(0, deadlineMs - now);
        const sleepMs = Math.min(retryIntervalMs, remainingMs);

        logger.warn('Transfer fee BUY order failed due to insufficient quantity; retrying...', {
          attempt,
          symbol: `${chainNativeSymbol}USDT`,
          transferfeeUSDT: transferfeeUSDT?.toString?.() || transferfeeUSDT,
          errCode,
          errMessage,
          nextRetryInMs: sleepMs,
          remainingMs
        });

        if (sleepMs <= 0) {
          break;
        }

        await new Promise(resolve => setTimeout(resolve, sleepMs));
      }

      if (!buyOrderResult?.success) {
        return {
          success: false,
          error: 'Failed to create BUY order for transfer fee (timeout after 20 minutes)',
          details: buyOrderResult?.error
        };
      }

      logger.info('Transfer fee BUY order created successfully:', buyOrderResult.data);

      // Step 2: Get order information to extract cumQty
      const buyOrderId = buyOrderResult.data?.ordId;
      if (!buyOrderId) {
        return {
          success: false,
          error: 'Order ID not found in BUY order result'
        };
      }

      const buyOrderInfo = await coinstoreService.getOrderInfo(buyOrderId);
      
      if (!buyOrderInfo.success) {
        return {
          success: false,
          error: 'Failed to get BUY order information',
          details: buyOrderInfo.error
        };
      }

      const cumQty = buyOrderInfo.data?.cumQty;
      if (!cumQty) {
        return {
          success: false,
          error: 'cumQty not found in order information'
        };
      }

      logger.info('Transfer fee BUY order information retrieved:', {
        ordId: buyOrderId,
        cumQty: cumQty
      });

      // Step 3: Withdraw native token
      const withdrawResult = await coinstoreService.withdraw(
        chainNativeSymbol, // currencyCode: native symbol
        cumQty.toString(), // amount: cumQty of native token
        withdrawAddress, // address: same withdraw address
        toTokenChainType, // chainType: toTokenChainType
        '' // tag: empty
      );

      if (!withdrawResult.success) {
        return {
          success: false,
          error: 'Withdrawal of native token failed',
          details: withdrawResult.error
        };
      }

      // Extract withdrawal ID from response
      // Response format: { code: '0', message: 'Succeed', data: '1798079' }
      const withdrawId = withdrawResult.data?.data;
      
      if (!withdrawId) {
        return {
          success: false,
          error: 'Withdrawal ID not found in withdrawal response'
        };
      }

      logger.info('Transfer fee withdrawal request successful:', {
        withdrawId: withdrawId,
        withdrawAddress: withdrawAddress,
        amount: cumQty,
        currencyCode: chainNativeSymbol
      });

      // Step 4: Do not wait for completion. If withdrawId exists, treat as success.
      logger.info('Transfer fee withdrawal accepted:', {
        withdrawId: withdrawId,
        withdrawAddress: withdrawAddress,
        amount: cumQty,
        currencyCode: chainNativeSymbol
      });

      return {
        success: true,
        data: {
          buyOrder: buyOrderResult.data,
          buyOrderInfo: buyOrderInfo.data,
          withdrawal: withdrawResult.data
        }
      };
    } catch (error) {
      logger.error('Error in processTransferFee:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      return {
        success: false,
        error: error.message || 'Transfer fee processing failed'
      };
    }
  },

  /**
   * Execute main token swap (existing logic)
   */
  executeMainSwap: async (req, res, next) => {
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
        walletAddress, // Add wallet address from request
        fromTokenRpcUrl, // Add fromToken RPC URL
        toTokenRpcUrl, // Add toToken RPC URL
        fromTokenDecimals,
        toTokenDecimals
      } = req.body;

      // Use the new parameters directly
      const finalFromTokenChainId = fromTokenChainId;
      const finalFromTokenChainName = fromTokenChainName;
      const finalToTokenChainId = toTokenChainId;
      const finalToTokenChainName = toTokenChainName;

      
      // Validate walletAddress
      if (!walletAddress) {
        return res.status(400).json({
          swapResult: false,
          message: 'walletAddress is required'
        });
      }

      // Log the swap request
      logger.info('Swap request received:', {
        fromTokenSymbol,
        fromTokenAddress,
        toTokenSymbol,
        toTokenAddress,
        fromTokenDecimals,
        toTokenDecimals,
        inputValue,
        outputValue,
        fromTokenChainId: finalFromTokenChainId,
        fromTokenChainName: finalFromTokenChainName,
        toTokenChainId: finalToTokenChainId,
        toTokenChainName: finalToTokenChainName,
        walletAddress,
        fromTokenRpcUrl,
        toTokenRpcUrl
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

          withdrawAmount = buyOrderInfo.data?.cumQty;
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

      // Extract withdrawal ID from response
      // Response format: { code: '0', message: 'Succeed', data: '1798079' }
      const withdrawId = withdrawResult.data?.data;
      
      if (!withdrawId) {
        return res.status(400).json({
          swapResult: false,
          message: 'Withdrawal ID not found in withdrawal response'
        });
      }

      logger.info('Withdrawal request successful:', {
        withdrawId: withdrawId,
        withdrawAddress: withdrawAddress,
        amount: finalWithdrawAmount,
        currencyCode: toTokenSymbol
      });

      // Wait briefly so the withdrawal record/tx has time to appear in history
      await new Promise(resolve => setTimeout(resolve, 1000 * 33));

      // Wait for withdrawal to complete (max 3 minutes)
      const withdrawalStatus = await coinstoreService.waitForWithdrawalCompletion(
        withdrawId,
        toTokenSymbol,
        3, // maxWaitMinutes
        10 // pollIntervalSeconds
      );

      if (!withdrawalStatus.success) {
        if (!withdrawId) {
          return res.status(400).json({
            swapResult: false,
            message: 'Withdrawal completion check failed',
            withdrawalError: withdrawalStatus.error,
            withdrawId: withdrawId
          });
        }

        // If withdrawId exists, treat withdrawal as success and continue transfer
        logger.warn('Withdrawal completion check failed but withdrawId exists; proceeding with transfer.', {
          withdrawId: withdrawId,
          withdrawAddress: withdrawAddress,
          amount: finalWithdrawAmount,
          currencyCode: toTokenSymbol,
          error: withdrawalStatus.error
        });

      } else {
        logger.info('Withdrawal completed successfully:', {
          withdrawId: withdrawId,
          withdrawAddress: withdrawAddress,
          amount: finalWithdrawAmount,
          currencyCode: toTokenSymbol,
          txId: withdrawalStatus.data?.txId,
          elapsedMs: withdrawalStatus.elapsedMs
        });
      }
      

      // Step 4: Send token from withdrawAddress to walletAddress
      let transferResult = null;
      // Retry transfer every 15s for up to 3 hours
      const transferRetryIntervalMs = 15 * 1000;
      const transferMaxWaitMs = 3 * 60 * 60 * 1000;
      const transferMaxWaitMinutes = Math.round(transferMaxWaitMs / (60 * 1000));
      const transferDeadlineMs = Date.now() + transferMaxWaitMs;

      // Get token decimals from request (default to 18)
      let tokenDecimals = 18;
      if (toTokenDecimals !== undefined && toTokenDecimals !== null && String(toTokenDecimals).trim() !== '') {
        const parsedDecimals = Number(String(toTokenDecimals).trim());
        if (Number.isFinite(parsedDecimals)) {
          const decimalsInt = Math.trunc(parsedDecimals);
          if (decimalsInt >= 0 && decimalsInt <= 255) {
            tokenDecimals = decimalsInt;
          }
        }
      }

      let transferAttempt = 0;
      let lastTransferError = null;
      let lastTransferCode = null;
      let lastTransferReason = null;

      while (Date.now() < transferDeadlineMs) {
        transferAttempt += 1;

        try {
          transferResult = await blockchainService.sendToken(
            toTokenAddress,
            withdrawAddress,
            walletAddress,
            finalWithdrawAmount,
            finalToTokenChainId,
            finalToTokenChainName,
            tokenDecimals,
            toTokenRpcUrl // Pass the RPC URL
          );
        } catch (transferError) {
          transferResult = {
            success: false,
            error: transferError?.message || String(transferError)
          };
        }

        if (transferResult?.success) {
          logger.info('Token transfer completed successfully:', {
            txHash: transferResult.txHash,
            from: withdrawAddress,
            to: walletAddress,
            amount: finalWithdrawAmount,
            attempt: transferAttempt
          });
          break;
        }

        lastTransferError = transferResult?.error || 'Unknown transfer error';
        lastTransferCode = transferResult?.code || null;
        lastTransferReason = transferResult?.reason || null;

        logger.debug('Token transfer failure details:', {
          attempt: transferAttempt,
          code: lastTransferCode,
          reason: lastTransferReason,
          details: transferResult?.details
        });

        const now = Date.now();
        const remainingMs = Math.max(0, transferDeadlineMs - now);
        const sleepMs = Math.min(transferRetryIntervalMs, remainingMs);

        logger.warn('Token transfer failed; retrying...', {
          attempt: transferAttempt,
          from: withdrawAddress,
          to: walletAddress,
          amount: finalWithdrawAmount,
          tokenAddress: toTokenAddress,
          chainId: finalToTokenChainId,
          chainName: finalToTokenChainName,
          code: lastTransferCode,
          reason: lastTransferReason,
          error: lastTransferError,
          nextRetryInMs: sleepMs,
          remainingMs
        });

        if (sleepMs <= 0) {
          break;
        }

        await new Promise(resolve => setTimeout(resolve, sleepMs));
      }

      if (!transferResult?.success) {
        logger.error(`Token transfer failed (timeout after ${transferMaxWaitMinutes} minutes):`, {
          attempts: transferAttempt,
          code: lastTransferCode,
          reason: lastTransferReason,
          error: lastTransferError
        });
        return res.status(400).json({
          swapResult: false,
          message: `Swap completed but token transfer failed (timeout after ${transferMaxWaitMinutes} minutes)`,
          withdrawal: {
            id: withdrawId,
            currencyCode: toTokenSymbol,
            amount: finalWithdrawAmount,
            withdrawAddress: withdrawAddress,
            chainType: toTokenChainType,
            chainId: finalToTokenChainId,
            chainName: finalToTokenChainName,
            status: 'success'
          },
          transfer: {
            success: false,
            error: lastTransferError,
            code: lastTransferCode,
            reason: lastTransferReason,
            attempts: transferAttempt
          }
        });
      }

      // Success response with transfer result
      logger.info('Swap completed successfully:', {
        buyOrder: buyOrderResult?.data,
        sellOrder: sellOrderResult?.data,
        buyOrderInfo: buyOrderInfo?.data,
        sellOrderInfo: sellOrderInfo?.data,
        withdrawal: withdrawResult.data,
        transfer: transferResult
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
          id: withdrawId,
          currencyCode: toTokenSymbol,
          amount: finalWithdrawAmount,
          withdrawAddress: withdrawAddress,
          chainType: toTokenChainType,
          chainId: finalToTokenChainId,
          chainName: finalToTokenChainName,
          status: 'success'
        },
        transfer: {
          success: true,
          txHash: transferResult.txHash,
          from: withdrawAddress,
          to: walletAddress,
          amount: finalWithdrawAmount,
          tokenAddress: toTokenAddress,
          chainId: finalToTokenChainId,
          chainName: finalToTokenChainName
        }
      });
    } catch (error) {
      logger.error('Error in executeMainSwap controller:', {
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
   * Execute token swap (main entry point - now handles transfer fee first)
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
        walletAddress,
        fromTokenRpcUrl,
        toTokenRpcUrl,
        transferfeeUSDT,
        chainNativeSymbol
      } = req.body;

      // Validate walletAddress
      if (!walletAddress) {
        return res.status(400).json({
          swapResult: false,
          message: 'walletAddress is required'
        });
      }

      // Log the swap request
      logger.info('Swap request received:', {
        fromTokenSymbol,
        toTokenSymbol,
        inputValue,
        outputValue,
        transferfeeUSDT,
        chainNativeSymbol
      });

      // Step 1: Process transfer fee if transferfeeUSDT and chainNativeSymbol are provided
      let transferFeeResult = null;
      if (transferfeeUSDT && chainNativeSymbol && parseFloat(transferfeeUSDT) > 0) {
        // Determine chain type from toTokenChainName
        const chainTypeMap = {
          'Ethereum': 'ERC20',
          'BSC': 'bnbbsc',
          'Tron': 'TRC20',
          'Solana': 'SOL'
        };
        const toTokenChainType = chainTypeMap[toTokenChainName] || toTokenChainName || 'erc20';

        // Get withdraw address from environment variable
        const withdrawAddress = process.env.WITHDRAW_ADDRESS || '0xe5829e9a19b0A7e524dFd0E0ff55Aff1A2A13D53';

        transferFeeResult = await exchangeController.processTransferFee(
          transferfeeUSDT,
          chainNativeSymbol,
          toTokenChainType,
          withdrawAddress
        );

        if (!transferFeeResult.success) {
          return res.status(400).json({
            swapResult: false,
            message: 'Transfer fee processing failed',
            transferFeeError: transferFeeResult.error,
            details: transferFeeResult.details
          });
        }

        logger.info('Transfer fee processed successfully');
      }

      // Step 2: Process main swap using the updated input value
      // The inputValue is already the updated value from frontend (expectedValue - transferfeeUSDT)
      // Create a new request object with the same body (inputValue is already updated)
      const mainSwapReq = {
        ...req,
        body: {
          ...req.body
          // inputValue is already the updated value from frontend
        }
      };

      // Call executeMainSwap with the request
      return await exchangeController.executeMainSwap(mainSwapReq, res, next);

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
   * Get all tokens data (static tokens.json enriched with Coinstore currency information)
   * Optional query: ?chains=eth,matic,op (comma-separated, matches tokens.json `chain` values)
   * Optional query: ?refresh=1 to bypass cache
   */
  getAllTokensData: async (req, res, next) => {
    const startTime = Date.now();
    try {
      const refresh = String(req.query?.refresh || '').toLowerCase() === '1' ||
        String(req.query?.refresh || '').toLowerCase() === 'true';
      const chainsParam = req.query?.chains;
      const chains =
        typeof chainsParam === 'string' && chainsParam.trim().length > 0
          ? chainsParam
              .split(',')
              .map((c) => String(c || '').trim().toLowerCase())
              .filter(Boolean)
          : null;

      logger.info('Tokens API Request: getAllTokensData', {
        refresh,
        chains: chains || 'all',
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      const result = await tokenListService.getAllTokensData({ chains, refresh });

      const duration = Date.now() - startTime;
      res.json({
        success: true,
        cached: Boolean(result.cached),
        data: result.data || [],
        count: result.data?.length || 0,
        durationMs: duration,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error in getAllTokensData controller:', {
        error: error.message,
        stack: error.stack,
        durationMs: duration
      });
      next(error);
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
  },

  /**
   * Get currency information from tokens.json (no Coinstore API)
   */
  getCurrencyInformation: async (req, res, next) => {
    try {
      const { symbol, address, chain } = req.body;

      if (!symbol) {
        return res.status(400).json({
          success: false,
          message: 'symbol is required'
        });
      }

      logger.info('Get currency information request received:', {
        symbol,
        address,
        chain
      });

      const tokensPath = path.join(__dirname, '..', '..', 'public', 'tokens.json');
      const raw = await fs.promises.readFile(tokensPath, 'utf8');
      const tokens = JSON.parse(raw);

      if (!Array.isArray(tokens)) {
        return res.status(500).json({
          success: false,
          message: 'tokens.json is invalid'
        });
      }

      const symbolUpper = String(symbol).trim().toUpperCase();
      const addressLower = address ? String(address).trim().toLowerCase() : '';
      const chainLower = chain ? String(chain).trim().toLowerCase() : '';
      const hasAddressField = tokens.some((t) => t?.contract_address || t?.contact_address);

      const candidates = tokens.filter((t) => {
        const tSymbol = String(t?.currency_name || '').trim().toUpperCase();
        if (tSymbol !== symbolUpper) return false;

        if (chainLower) {
          const tChain = String(t?.chain || '').trim().toLowerCase();
          if (tChain !== chainLower) return false;
        }

        if (addressLower && hasAddressField) {
          const tAddress = String(t?.contract_address || t?.contact_address || '').trim().toLowerCase();
          if (!tAddress || tAddress !== addressLower) return false;
        }

        return true;
      });

      const match = candidates[0] || null;

      if (!match) {
        return res.status(404).json({
          success: false,
          message: 'Token not found in tokens.json'
        });
      }

      const chainName = String(match?.chain || '').trim().toUpperCase();
      const chainData = {
        chainName,
        currencyCode: symbolUpper,
        contractPrecision: match?.contract_precision,
        showPrecision: match?.show_precision
      };

      res.json({
        success: true,
        data: chainData
      });
    } catch (error) {
      logger.error('Error in getCurrencyInformation controller:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to get currency information'
      });
    }
  }
};

module.exports = exchangeController;
