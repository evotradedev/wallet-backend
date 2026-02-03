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
  executeSwap: [
    body('fromTokenSymbol')
      .notEmpty()
      .withMessage('fromTokenSymbol is required')
      .isString()
      .withMessage('fromTokenSymbol must be a string'),
    body('fromTokenAddress')
      .notEmpty()
      .withMessage('fromTokenAddress is required')
      .isString()
      .withMessage('fromTokenAddress must be a string'),
    body('toTokenSymbol')
      .notEmpty()
      .withMessage('toTokenSymbol is required')
      .isString()
      .withMessage('toTokenSymbol must be a string'),
    body('toTokenAddress')
      .notEmpty()
      .withMessage('toTokenAddress is required')
      .isString()
      .withMessage('toTokenAddress must be a string'),
    body('inputValue')
      .notEmpty()
      .withMessage('inputValue is required')
      .isString()
      .withMessage('inputValue must be a string'),
    body('outputValue')
      .notEmpty()
      .withMessage('outputValue is required')
      .isString()
      .withMessage('outputValue must be a string'),
    handleValidationErrors
  ],

  withdraw: [
    body('currencyCode')
      .notEmpty()
      .withMessage('currencyCode is required')
      .isString()
      .withMessage('currencyCode must be a string'),
    body('amount')
      .notEmpty()
      .withMessage('amount is required')
      .isString()
      .withMessage('amount must be a string'),
    body('address')
      .notEmpty()
      .withMessage('address is required')
      .isString()
      .withMessage('address must be a string'),
    body('chainType')
      .notEmpty()
      .withMessage('chainType is required')
      .isString()
      .withMessage('chainType must be a string')
      .isIn(['trc20', 'bnbbsc', 'bep20', 'erc20', 'sol'])
      .withMessage('chainType must be one of: trc20, bnbbsc, bep20, erc20, sol'),
    body('tag')
      .optional()
      .isString()
      .withMessage('tag must be a string'),
    handleValidationErrors
  ],

  getDepositAddress: [
    body('currencyCode')
      .notEmpty()
      .withMessage('currencyCode is required')
      .isString()
      .withMessage('currencyCode must be a string'),
    body('chain')
      .notEmpty()
      .withMessage('chain is required')
      .isString()
      .withMessage('chain must be a string'),
    handleValidationErrors
  ]
};

module.exports = exchangeValidators;
