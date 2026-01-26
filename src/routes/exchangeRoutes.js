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

module.exports = router;
