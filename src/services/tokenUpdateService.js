const fs = require('fs');
const path = require('path');
const coinstoreService = require('./coinstoreService');
const logger = require('../utils/logger');

const TOKENS_UPDATE_CONCURRENCY = Number(process.env.TOKENS_UPDATE_CONCURRENCY) || 5;
const TOKENS_UPDATE_DELAY_MS = Number(process.env.TOKENS_UPDATE_DELAY_MS) || 200; // 200ms delay between API calls
const NATIVE_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const DEFAULT_LOGO_URI = 'https://cryptologos.cc/logos/bitcoin-sv-bsv-logo.png?v=040';
const LOGO_URI_BY_TOKEN_NAME = {
  USDT: 'https://cryptologos.cc/logos/tether-usdt-logo.png?v=040',
  USDC: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png?v=040',
  BTC: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png?v=040',
  BITCOIN: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png?v=040',
  POLYGON: 'https://cryptologos.cc/logos/polygon-matic-logo.png?v=040',
  MATIC: 'https://cryptologos.cc/logos/polygon-matic-logo.png?v=040',
  POL: 'https://cryptologos.cc/logos/polygon-matic-logo.png?v=040',
  BNB: 'https://cryptologos.cc/logos/bnb-bnb-logo.png?v=040',
  ETH: 'https://cryptologos.cc/logos/ethereum-eth-logo.png?v=040',
  ETHEREUM: 'https://cryptologos.cc/logos/ethereum-eth-logo.png?v=040'
};

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function getLogoUri(tokenNameUpper) {
  return LOGO_URI_BY_TOKEN_NAME[tokenNameUpper] || DEFAULT_LOGO_URI;
}

async function mapLimit(items, concurrency, iteratorFn) {
  const limit = Math.max(1, Number(concurrency) || 1);
  const results = new Array(items.length);
  let idx = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (true) {
        const current = idx;
        idx += 1;
        if (current >= items.length) break;
        // eslint-disable-next-line no-await-in-loop
        results[current] = await iteratorFn(items[current], current);
      }
    })()
  );

  await Promise.all(workers);
  return results;
}

function findMatchingChainData(currencyInfo, chainNameUpper) {
  const chainDataList = Array.isArray(currencyInfo?.chainDataList) ? currencyInfo.chainDataList : [];
  if (chainDataList.length === 0) return null;

  // Match on chainName, chain, or network (case-insensitive)
  const match = chainDataList.find((cd) => {
    const cdChain = upper(cd?.chainName || cd?.chain || cd?.network);
    return cdChain && cdChain === chainNameUpper;
  });

  return match || null;
}

/**
 * Update tokens.json with contract addresses from CoinStore API.
 * For each token item, we:
 *  - call getCurrencyInformation(currency_name)
 *  - find matching chain data in chainDataList by chain name
 *  - set token.contact_address = chainData.contractAddress
 */
async function updateTokensWithContractAddresses() {
  try {
    const tokensPath = path.join(__dirname, '..', '..', 'public', 'tokens.json');

    logger.info('TokenUpdateService: Reading tokens.json...');
    const raw = await fs.promises.readFile(tokensPath, 'utf8');
    const tokens = JSON.parse(raw);

    if (!Array.isArray(tokens)) {
      throw new Error('tokens.json is not an array');
    }

    logger.info('TokenUpdateService: Starting token update process', {
      totalTokens: tokens.length
    });

    // Get unique currency names
    const uniqueCurrencies = Array.from(
      new Set(tokens.map((t) => upper(t?.currency_name)).filter(Boolean))
    );

    logger.info('TokenUpdateService: Fetching currency information', {
      uniqueCurrencies: uniqueCurrencies.length,
      concurrency: TOKENS_UPDATE_CONCURRENCY
    });

    // Fetch currency information for each unique currency
    const currencyInfoMap = new Map();

    await mapLimit(uniqueCurrencies, TOKENS_UPDATE_CONCURRENCY, async (currencyCodeUpper) => {
      try {
        const result = await coinstoreService.getCurrencyInformation(currencyCodeUpper);

        // Wait before next API call to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, TOKENS_UPDATE_DELAY_MS));

        if (result?.success && result?.data) {
          currencyInfoMap.set(currencyCodeUpper, result.data);
          logger.debug('TokenUpdateService: Fetched currency info', {
            currencyCode: currencyCodeUpper,
            chainDataCount: result.data.chainDataList?.length || 0
          });
        } else {
          logger.warn('TokenUpdateService: Failed to fetch currency info', {
            currencyCode: currencyCodeUpper,
            error: result?.error
          });
        }
      } catch (error) {
        logger.error('TokenUpdateService: Error fetching currency info', {
          currencyCode: currencyCodeUpper,
          error: error.message
        });
      }
    });

    let updatedCount = 0;
    let logoUpdatedCount = 0;
    let skippedCount = 0;

    for (const token of tokens) {
      const chainNameUpper = upper(token?.chain);
      const currencyCodeUpper = upper(token?.currency_name);

      const desiredLogoUri = getLogoUri(currencyCodeUpper);
      if (token.logoURI !== desiredLogoUri) {
        // eslint-disable-next-line no-param-reassign
        token.logoURI = desiredLogoUri;
        logoUpdatedCount += 1;
      }

      if (!currencyCodeUpper || !chainNameUpper) {
        skippedCount += 1;
        continue;
      }

      const currencyInfo = currencyInfoMap.get(currencyCodeUpper);
      if (!currencyInfo) {
        skippedCount += 1;
        continue;
      }

      const chainData = findMatchingChainData(currencyInfo, chainNameUpper);
      if (!chainData) {
        skippedCount += 1;
        continue;
      }

      let newAddress = String(chainData.contractAddress || '').trim();
      if (!newAddress) {
        newAddress = NATIVE_ADDRESS;
      }

      if (token.contact_address !== newAddress) {
        // eslint-disable-next-line no-param-reassign
        token.contact_address = newAddress;
        updatedCount += 1;
      }
    }

    if (updatedCount > 0 || logoUpdatedCount > 0) {
      logger.info('TokenUpdateService: Writing updated tokens.json', {
        updatedCount,
        logoUpdatedCount,
        skippedCount,
        totalTokens: tokens.length
      });

      await fs.promises.writeFile(tokensPath, JSON.stringify(tokens, null, 2), 'utf8');

      logger.info('TokenUpdateService: Successfully updated tokens.json', {
        updatedCount,
        logoUpdatedCount,
        skippedCount,
        totalTokens: tokens.length
      });
    } else {
      logger.info('TokenUpdateService: No updates needed', {
        updatedCount,
        logoUpdatedCount,
        skippedCount,
        totalTokens: tokens.length
      });
    }

    return {
      success: true,
      updatedCount,
      logoUpdatedCount,
      skippedCount,
      totalTokens: tokens.length
    };
  } catch (error) {
    logger.error('TokenUpdateService: Error updating tokens', {
      error: error.message,
      stack: error.stack
    });
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  updateTokensWithContractAddresses
};

