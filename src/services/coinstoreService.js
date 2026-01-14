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
        logger.debug(`CoinStore API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('CoinStore API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`CoinStore API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        logger.error('CoinStore API Response Error:', error.response?.data || error.message);
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
}

module.exports = new CoinStoreService();
