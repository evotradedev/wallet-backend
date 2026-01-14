const { body, param, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  next();
};

const exchangeValidators = {
  getQuote: [
    body('fromToken')
      .notEmpty()
      .withMessage('fromToken is required')
      .isString()
      .withMessage('fromToken must be a string'),
    body('toToken')
      .notEmpty()
      .withMessage('toToken is required')
      .isString()
      .withMessage('toToken must be a string'),
    body('amount')
      .notEmpty()
      .withMessage('amount is required')
      .isString()
      .withMessage('amount must be a string'),
    body('chainId')
      .notEmpty()
      .withMessage('chainId is required')
      .isInt({ min: 1 })
      .withMessage('chainId must be a positive integer'),
    handleValidationErrors
  ],

  executeSwap: [
    body('fromToken')
      .notEmpty()
      .withMessage('fromToken is required')
      .isString()
      .withMessage('fromToken must be a string'),
    body('toToken')
      .notEmpty()
      .withMessage('toToken is required')
      .isString()
      .withMessage('toToken must be a string'),
    body('amount')
      .notEmpty()
      .withMessage('amount is required')
      .isString()
      .withMessage('amount must be a string'),
    body('recipient')
      .notEmpty()
      .withMessage('recipient is required')
      .isString()
      .withMessage('recipient must be a string')
      .matches(/^0x[a-fA-F0-9]{40}$/)
      .withMessage('recipient must be a valid Ethereum address'),
    body('chainId')
      .notEmpty()
      .withMessage('chainId is required')
      .isInt({ min: 1 })
      .withMessage('chainId must be a positive integer'),
    handleValidationErrors
  ],

  getSupportedTokens: [
    param('chainId')
      .isInt({ min: 1 })
      .withMessage('chainId must be a positive integer'),
    handleValidationErrors
  ],

  getTransactionStatus: [
    param('txHash')
      .notEmpty()
      .withMessage('txHash is required')
      .matches(/^0x[a-fA-F0-9]{64}$/)
      .withMessage('txHash must be a valid transaction hash'),
    handleValidationErrors
  ]
};

module.exports = exchangeValidators;
