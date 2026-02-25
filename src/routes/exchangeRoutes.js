const express = require('express');
const exchangeController = require('../controllers/exchangeController');
const exchangeValidators = require('../middleware/validator');

const router = express.Router();

/**
 * @route   POST /api/exchange/swap
 * @desc    Execute token swap
 * @access  Public
 */
router.post('/swap', exchangeValidators.executeSwap, exchangeController.executeSwap);

/**
 * @route   POST /api/exchange/withdraw
 * @desc    Execute withdrawal
 * @access  Public
 */
router.post('/withdraw', exchangeValidators.withdraw, exchangeController.withdraw);

/**
 * @route   POST /api/exchange/deposit-address
 * @desc    Get deposit address from Coinstore
 * @access  Public
 */
router.post('/deposit-address', exchangeValidators.getDepositAddress, exchangeController.getDepositAddress);

/**
 * @route   POST /api/exchange/token-price
 * @desc    Get token price from Coinstore
 * @access  Public
 */
router.post('/token-price', exchangeController.getTokenPrice);

/**
 * @route   GET /api/exchange/tokens
 * @desc    Get all tokens data (static tokens.json enriched with Coinstore currency information)
 * @access  Public
 */
router.get('/tokens', exchangeController.getTokensData);

/**
 * @route   GET /api/exchange/symbols
 * @desc    Get latest price for all symbols (CoinStore /v1/ticker/price)
 * @access  Public
 */
router.get('/symbols', exchangeController.getAllSymbols);

/**
 * @route   POST /api/exchange/spot-information
 * @desc    Get spot information (CoinStore /v2/public/config/spot/symbols)
 * @access  Public
 */
router.post('/spot-information', exchangeController.getSpotInformation);

/**
 * @route   POST /api/exchange/currency-information
 * @desc    Get currency information from Coinstore
 * @access  Public
 */
router.post('/currency-information', exchangeController.getCurrencyInformation);

module.exports = router;
