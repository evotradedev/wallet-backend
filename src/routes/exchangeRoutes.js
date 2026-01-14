const express = require('express');
const exchangeController = require('../controllers/exchangeController');
const exchangeValidators = require('../middleware/validator');

const router = express.Router();

/**
 * @route   POST /api/exchange/quote
 * @desc    Get quote for token exchange
 * @access  Public
 */
router.post('/quote', exchangeValidators.getQuote, exchangeController.getQuote);

/**
 * @route   POST /api/exchange/swap
 * @desc    Execute token swap
 * @access  Public
 */
router.post('/swap', exchangeValidators.executeSwap, exchangeController.executeSwap);

/**
 * @route   GET /api/exchange/tokens/:chainId
 * @desc    Get supported tokens for a chain
 * @access  Public
 */
router.get('/tokens/:chainId', exchangeValidators.getSupportedTokens, exchangeController.getSupportedTokens);

/**
 * @route   GET /api/exchange/transaction/:txHash
 * @desc    Get transaction status
 * @access  Public
 */
router.get('/transaction/:txHash', exchangeValidators.getTransactionStatus, exchangeController.getTransactionStatus);

module.exports = router;
