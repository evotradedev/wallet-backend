const axios = require('axios');
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
   * Get quote for token exchange
   * @param {string} fromToken - Source token address
   * @param {string} toToken - Destination token address
   * @param {string} amount - Amount to exchange (in wei or token units)
   * @param {number} chainId - Blockchain chain ID
   * @returns {Promise<Object>} Quote information
   */
  async getQuote(fromToken, toToken, amount, chainId) {
    try {
      const response = await this.client.post('/quote', {
        fromToken,
        toToken,
        amount,
        chainId
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('Error getting quote from CoinStore:', error);
      return {
        success: false,
        error: error.response?.data || { message: error.message }
      };
    }
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
   * Get supported tokens for a chain
   * @param {number} chainId - Blockchain chain ID
   * @returns {Promise<Object>} List of supported tokens
   */
  async getSupportedTokens(chainId) {
    try {
      const response = await this.client.get(`/tokens/${chainId}`);

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('Error getting supported tokens from CoinStore:', error);
      return {
        success: false,
        error: error.response?.data || { message: error.message }
      };
    }
  }

  /**
   * Get transaction status
   * @param {string} txHash - Transaction hash
   * @returns {Promise<Object>} Transaction status
   */
  async getTransactionStatus(txHash) {
    try {
      const response = await this.client.get(`/transaction/${txHash}`);

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('Error getting transaction status from CoinStore:', error);
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
}

module.exports = new CoinStoreService();
