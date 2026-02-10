const fs = require('fs');
const path = require('path');
const coinstoreService = require('./coinstoreService');
const logger = require('../utils/logger');

const TOKENS_UPDATE_CONCURRENCY = Number(process.env.TOKENS_UPDATE_CONCURRENCY) || 5;
const TOKENS_UPDATE_DELAY_MS = Number(process.env.TOKENS_UPDATE_DELAY_MS) || 200; // 200ms delay between API calls

function upper(value) {
  return String(value || '').trim().toUpperCase();
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
    let skippedCount = 0;

    for (const token of tokens) {
      const chainNameUpper = upper(token?.chain);
      const currencyCodeUpper = upper(token?.currency_name);

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
      if (!chainData || !chainData.contractAddress) {
        skippedCount += 1;
        continue;
      }

      const newAddress = String(chainData.contractAddress).trim();
      if (!newAddress) {
        skippedCount += 1;
        continue;
      }

      if (token.contact_address !== newAddress) {
        // eslint-disable-next-line no-param-reassign
        token.contact_address = newAddress;
        updatedCount += 1;
      }
    }

    if (updatedCount > 0) {
      logger.info('TokenUpdateService: Writing updated tokens.json', {
        updatedCount,
        skippedCount,
        totalTokens: tokens.length
      });

      await fs.promises.writeFile(tokensPath, JSON.stringify(tokens, null, 2), 'utf8');

      logger.info('TokenUpdateService: Successfully updated tokens.json', {
        updatedCount,
        skippedCount,
        totalTokens: tokens.length
      });
    } else {
      logger.info('TokenUpdateService: No updates needed', {
        updatedCount,
        skippedCount,
        totalTokens: tokens.length
      });
    }

    return {
      success: true,
      updatedCount,
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

