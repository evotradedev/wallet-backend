const express = require('express');
const symbolController = require('../controllers/symbolController');

const router = express.Router();

/**
 * @route   GET /api/symbols
 * @desc    Get all symbols with detailed information
 * @access  Public
 */
router.get('/', symbolController.getAllSymbolsWithDetails);

module.exports = router;
