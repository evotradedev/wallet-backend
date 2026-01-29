const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
const config = require('../config');
const logger = require('../utils/logger');

class CoinStoreService {
  constructor() {
    this.baseURL = config.coinstore.apiUrl;
    this.apiKey = config.coinstore.apiKey;
    this.apiSecret = config.coinstore.apiSecret;
    this.timeout = config.coinstore.timeout;

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      }
    });

    // Add request interceptor for authentication if needed
    this.client.interceptors.request.use(
      (config) => {
        const logData = {
          method: config.method?.toUpperCase(),
          url: config.url,
          baseURL: config.baseURL,
          params: config.params,
          data: config.data,
          timestamp: new Date().toISOString()
        };
        logger.info('CoinStore API Request:', logData);
        logger.debug(`CoinStore API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('CoinStore API Request Error:', {
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        });
        return Promise.reject(error);
      }
    );

    // Add response interceptor
    this.client.interceptors.response.use(
      (response) => {
        const logData = {
          status: response.status,
          url: response.config.url,
          method: response.config.method?.toUpperCase(),
          dataSize: JSON.stringify(response.data).length,
          timestamp: new Date().toISOString()
        };
        logger.info('CoinStore API Response:', logData);
        logger.debug(`CoinStore API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        logger.error('CoinStore API Response Error:', {
          status: error.response?.status,
          url: error.config?.url,
          method: error.config?.method?.toUpperCase(),
          error: error.response?.data || error.message,
          timestamp: new Date().toISOString()
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Execute token exchange
   * @param {string} fromToken - Source token address
   * @param {string} toToken - Destination token address
   * @param {string} amount - Amount to exchange
   * @param {string} recipient - Recipient address
   * @param {number} chainId - Blockchain chain ID
   * @param {Object} additionalParams - Additional parameters (slippage, deadline, etc.)
   * @returns {Promise<Object>} Transaction data
   */
  async executeSwap(fromToken, toToken, amount, recipient, chainId, additionalParams = {}) {
    try {
      const response = await this.client.post('/swap', {
        fromToken,
        toToken,
        amount,
        recipient,
        chainId,
        ...additionalParams
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('Error executing swap on CoinStore:', error);
      return {
        success: false,
        error: error.response?.data || { message: error.message }
      };
    }
  }

  /**
   * Get all symbols with latest prices
   * @param {string} symbols - Optional comma-separated list of symbols (e.g., "btcusdt,eosusdt")
   * @returns {Promise<Object>} List of symbols with prices
   */
  async getAllSymbols(symbols = null) {
    try {
      const params = symbols ? { symbol: symbols } : {};
      const response = await this.client.get('/v1/ticker/price', { params });

      logger.info('CoinStore API: getAllSymbols - Success', {
        symbolCount: response.data?.data?.length || 0,
        symbols: symbols || 'all'
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('Error getting all symbols from CoinStore:', {
        error: error.response?.data || error.message,
        symbols
      });
      return {
        success: false,
        error: error.response?.data || { message: error.message }
      };
    }
  }

  /**
   * Get detailed symbol information
   * @param {Array<number>} symbolIds - Array of symbol IDs
   * @param {Array<string>} symbolCodes - Optional array of symbol codes
   * @returns {Promise<Object>} Detailed symbol information
   */
  async getSymbolDetails(symbolIds = [], symbolCodes = []) {
    try {
      const requestBody = {};
      if (symbolIds.length > 0) {
        requestBody.symbolIds = symbolIds;
      }
      if (symbolCodes.length > 0) {
        requestBody.symbolCodes = symbolCodes;
      }

      const response = await this.client.post('/v2/public/config/spot/symbols', requestBody);

      logger.info('CoinStore API: getSymbolDetails - Success', {
        symbolIdCount: symbolIds.length,
        symbolCodeCount: symbolCodes.length,
        resultCount: response.data?.data?.length || 0
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('Error getting symbol details from CoinStore:', {
        error: error.response?.data || error.message,
        symbolIds,
        symbolCodes
      });
      return {
        success: false,
        error: error.response?.data || { message: error.message }
      };
    }
  }

  /**
   * Generate HMAC signature for CoinStore API authentication
   * @param {string} secretKey - API secret key
   * @param {number} expires - Expiration timestamp in milliseconds
   * @param {string} payloadString - Request payload as JSON string
   * @returns {string} HMAC signature in hex format
   */
  _generateSignature(secretKey, expires, payloadString) {
    // Calculate expires_key = floor(expires / 30000)
    const expiresKey = Math.floor(expires / 30000).toString();

    // First HMAC: HMAC-SHA256(secretKey, expiresKey)
    const key = crypto
      .createHmac('sha256', Buffer.from(secretKey))
      .update(Buffer.from(expiresKey))
      .digest('hex');

    // Second HMAC: HMAC-SHA256(key, payloadString)
    const signature = crypto
      .createHmac('sha256', Buffer.from(key))
      .update(Buffer.from(payloadString))
      .digest('hex');

    return signature;
  }

  /**
   * Get deposit address from Coinstore
   * @param {string} currencyCode - Currency code (e.g., "USDTTRX")
   * @param {string} chain - Chain name (e.g., "TRX")
   * @returns {Promise<Object>} Deposit address information
   */
  async getDepositAddress(currencyCode, chain) {
    try {
      if (!this.apiKey || !this.apiSecret) {
        throw new Error('CoinStore API credentials are not configured');
      }

      // Build request payload
      const requestBody = {
        currencyCode,
        chain
      };

      // Convert payload to JSON string
      const payloadString = JSON.stringify(requestBody);

      // expires in milliseconds
      const expires = Date.now();

      // Generate HMAC signature
      const signature = this._generateSignature(this.apiSecret, expires, payloadString);

      // Prepare headers
      const headers = {
        'X-CS-APIKEY': this.apiKey,
        'X-CS-SIGN': signature,
        'X-CS-EXPIRES': expires.toString(),
        'exch-language': 'en_US',
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Connection': 'keep-alive'
      };

      // Make request to deposit address endpoint
      const url = `${this.baseURL}/fi/v3/asset/deposit/do`;

      logger.info('CoinStore API: getDepositAddress - Request', {
        url,
        currencyCode,
        chain,
        expires
      });

      const response = await axios.post(url, payloadString, {
        headers,
        timeout: this.timeout,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      });

      // Check response code
      if (response.data.code !== 0 && response.data.code !== '0') {
        logger.error('CoinStore API: getDepositAddress - Failed', {
          code: response.data.code,
          message: response.data.message
        });
        return {
          success: false,
          error: {
            code: response.data.code,
            message: response.data.message
          }
        };
      }

      logger.info('CoinStore API: getDepositAddress - Success', {
        address: response.data.data?.address,
        tag: response.data.data?.tag,
        depositMin: response.data.data?.depositMin
      });

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      logger.error('Error getting deposit address from CoinStore:', {
        error: error.response?.data || error.message,
        currencyCode,
        chain,
        stack: error.stack
      });
      return {
        success: false,
        error: error.response?.data || { message: error.message }
      };
    }
  }

  /**
   * Execute withdrawal
   * @param {string} currencyCode - Currency code (e.g., "USDT")
   * @param {string} amount - Withdrawal amount
   * @param {string} address - Trusted address for withdrawal
   * @param {string} chainType - Chain protocol (e.g., "trc20", "bep20", "erc20", "bnbbsc", "sol")
   * @param {string} tag - Optional tag/memo
   * @returns {Promise<Object>} Withdrawal result
   */
  async withdraw(currencyCode, amount, address, chainType, tag = '') {
    try {
      if (!this.apiKey || !this.apiSecret) {
        throw new Error('CoinStore API credentials are not configured');
      }

      // Build request payload
      const requestBody = {
        currencyCode,
        amount,
        address,
        chainType
      };

      // Add tag if provided (even if empty string, include it)
      if (tag !== null && tag !== undefined) {
        requestBody.tag = tag;
      }

      // Convert payload to JSON string
      const payloadString = JSON.stringify(requestBody);

      // expires in milliseconds
      const expires = Date.now();

      // Generate HMAC signature
      const signature = this._generateSignature(this.apiSecret, expires, payloadString);

      // Prepare headers
      const headers = {
        'X-CS-APIKEY': this.apiKey,
        'X-CS-SIGN': signature,
        'X-CS-EXPIRES': expires.toString(),
        'exch-language': 'en_US',
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Connection': 'keep-alive'
      };

      // Make request to withdrawal endpoint
      const url = `${this.baseURL}/fi/v3/asset/doWithdraw`;

      logger.info('CoinStore API: withdraw - Request', {
        url,
        currencyCode,
        amount,
        address,
        chainType,
        tag: tag || '(empty)',
        expires
      });

      const response = await axios.post(url, payloadString, {
        headers,
        timeout: this.timeout,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      });

      logger.info('CoinStore API: withdraw - Success', {
        withdrawalId: response.data?.data?.id,
        code: response.data?.code,
        message: response.data?.message
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('Error executing withdrawal on CoinStore:', {
        error: error.response?.data || error.message,
        currencyCode,
        amount,
        address,
        chainType,
        tag: tag || '(empty)',
        stack: error.stack
      });
      return {
        success: false,
        error: error.response?.data || { message: error.message }
      };
    }
  }

  /**
   * Get market depth for a symbol (returns lastPrice)
   * @param {string} symbol - Trading pair symbol (e.g., "ETHUSDT")
   * @param {number} depth - Depth level (default: 2)
   * @returns {Promise<Object>} Market depth data with lastPrice
   */
  async getMarketDepth(symbol, depth = 2) {
    try {
      const url = `${this.baseURL}/v1/market/depth/${symbol}?depth=${depth}`;
      
      logger.info('CoinStore API: getMarketDepth - Request', {
        url,
        symbol,
        depth
      });

      const response = await axios.get(url, {
        timeout: this.timeout
      });

      // Check response code
      if (response.data.code !== 0 && response.data.code !== '0') {
        logger.error('CoinStore API: getMarketDepth - Failed', {
          code: response.data.code,
          message: response.data.message
        });
        return {
          success: false,
          error: {
            code: response.data.code,
            message: response.data.message
          }
        };
      }

      logger.info('CoinStore API: getMarketDepth - Success', {
        symbol: response.data.data?.symbol,
        lastPrice: response.data.data?.lastPrice
      });

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      logger.error('Error getting market depth from CoinStore:', {
        error: error.response?.data || error.message,
        symbol,
        depth,
        stack: error.stack
      });
      return {
        success: false,
        error: error.response?.data || { message: error.message }
      };
    }
  }

  /**
   * Create order on Coinstore
   * @param {Object} orderParams - Order parameters
   * @param {string} orderParams.symbol - Trading pair symbol (e.g., "BTCUSDT")
   * @param {string} orderParams.side - Order side ("BUY" or "SELL")
   * @param {string} orderParams.ordType - Order type ("MARKET", "LIMIT", "POST_ONLY")
   * @param {string} orderParams.ordQty - Order quantity (required for limit orders and market sell)
   * @param {string} orderParams.ordAmt - Order amount (required for market buy)
   * @param {string} orderParams.ordPrice - Order price (required for limit orders)
   * @param {string} orderParams.clOrdId - Client order ID (optional)
   * @returns {Promise<Object>} Order creation result
   */
  async createOrder(orderParams) {
    try {
      if (!this.apiKey || !this.apiSecret) {
        throw new Error('CoinStore API credentials are not configured');
      }

      // Build request payload
      const requestBody = {
        symbol: orderParams.symbol,
        side: orderParams.side,
        ordType: orderParams.ordType
      };

      // Add optional parameters
      if (orderParams.ordQty) {
        requestBody.ordQty = orderParams.ordQty;
      }
      if (orderParams.ordAmt) {
        requestBody.ordAmt = orderParams.ordAmt;
      }
      if (orderParams.ordPrice) {
        requestBody.ordPrice = orderParams.ordPrice;
      }
      if (orderParams.clOrdId) {
        requestBody.clOrdId = orderParams.clOrdId;
      }

      // Convert payload to JSON string
      const payloadString = JSON.stringify(requestBody);

      // expires in milliseconds
      const expires = Date.now();

      // Generate HMAC signature
      const signature = this._generateSignature(this.apiSecret, expires, payloadString);

      // Prepare headers
      const headers = {
        'X-CS-APIKEY': this.apiKey,
        'X-CS-SIGN': signature,
        'X-CS-EXPIRES': expires.toString(),
        'exch-language': 'en_US',
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Connection': 'keep-alive'
      };

      // Make request to create order endpoint
      const url = `${this.baseURL}/trade/order/place`;

      logger.info('CoinStore API: createOrder - Request', {
        url,
        symbol: requestBody.symbol,
        side: requestBody.side,
        ordType: requestBody.ordType,
        expires
      });

      const response = await axios.post(url, payloadString, {
        headers,
        timeout: this.timeout,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      });

      // Check response code
      if (response.data.code !== 0 && response.data.code !== '0') {
        logger.error('CoinStore API: createOrder - Failed', {
          code: response.data.code,
          message: response.data.message
        });
        return {
          success: false,
          error: {
            code: response.data.code,
            message: response.data.message
          }
        };
      }

      logger.info('CoinStore API: createOrder - Success', {
        orderId: response.data.data?.ordId
      });

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      logger.error('Error creating order on CoinStore:', {
        error: error.response?.data || error.message,
        orderParams,
        stack: error.stack
      });
      return {
        success: false,
        error: error.response?.data || { message: error.message }
      };
    }
  }

  /**
   * Get order information from Coinstore
   * @param {number} orderId - single order ID
   * @returns {Promise<Object>} Order information result
   */
  async getOrderInfo(orderId) {
    try {
      if (!this.apiKey || !this.apiSecret) {
        throw new Error('CoinStore API credentials are not configured');
      }
      
      if (!orderId) {
        throw new Error('Order ID is required');
      }

      // Build query string for GET request
      const queryString = `ordId=${orderId}`;

      // expires in milliseconds
      const expires = Date.now();

      // Generate HMAC signature using query string format (not JSON)
      // The payload for signature should be the query string: "ordId=..."
      const signature = this._generateSignature(this.apiSecret, expires, queryString);

      // Prepare headers
      const headers = {
        'X-CS-APIKEY': this.apiKey,
        'X-CS-SIGN': signature,
        'X-CS-EXPIRES': expires.toString(),
        'exch-language': 'en_US',
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Connection': 'keep-alive'
      };

      // Make request to get order info endpoint (GET request with query parameter)
      const url = `${this.baseURL}/trade/order/orderInfo?${queryString}`;

      logger.info('CoinStore API: getOrderInfo - Request', {
        url,
        orderId,
        expires
      });

      const response = await axios.get(url, {
        headers,
        timeout: this.timeout,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      });

      // Check response code
      if (response.data.code !== 0 && response.data.code !== '0') {
        logger.error('CoinStore API: getOrderInfo - Failed', {
          code: response.data.code,
          message: response.data.message
        });
        return {
          success: false,
          error: {
            code: response.data.code,
            message: response.data.message
          }
        };
      }

      logger.info('CoinStore API: getOrderInfo - Success', {
        orderId: response.data.data?.ordId,
        ordState: response.data.data?.ordState,
        ordAmt: response.data.data?.ordAmt,
        ordQty: response.data.data?.ordQty
      });

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      logger.error('Error getting order info from CoinStore:', {
        error: error.response?.data || error.message,
        orderIds,
        stack: error.stack
      });
      return {
        success: false,
        error: error.response?.data || { message: error.message }
      };
    }
  }
}

module.exports = new CoinStoreService();
