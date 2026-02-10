const fs = require('fs');
const path = require('path');
const coinstoreService = require('./coinstoreService');
const logger = require('../utils/logger');

// Caching / update configuration
const TOKENS_CACHE_TTL_MS = Number(process.env.TOKENS_CACHE_TTL_MS) || 10 * 60 * 1000; // 10 minutes
const TOKENS_UPDATE_CONCURRENCY = Number(process.env.TOKENS_UPDATE_CONCURRENCY) || 5;
const TOKENS_UPDATE_DELAY_MS = Number(process.env.TOKENS_UPDATE_DELAY_MS) || 200; // 200ms delay between API calls

// Addresses / constants
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
// Placeholder address commonly used to represent the native currency (ETH/BNB/etc.)
// Note: other parts of the codebase (e.g. blockchainService / exchange UI) treat this as "native".
const NATIVE_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const POLYGON_NATIVE_PROXY = '0x0000000000000000000000000000000000001010';

// Logo URIs
const DEFAULT_LOGO_URI = 'https://cryptologos.cc/logos/bitcoin-sv-bsv-logo.png?v=040';
const LOGO_URI_BY_CURRENCY = {
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

// In-memory cache for tokens list
let cache = {
  key: null,
  data: null,
  expiresAt: 0,
  inFlight: null
};

// Utility helpers
function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function safeTrimString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function getLogoUri(currencyCodeUpper) {
  return LOGO_URI_BY_CURRENCY[currencyCodeUpper] || DEFAULT_LOGO_URI;
}

// tokens.json helpers
async function readStaticTokens() {
  const tokensPath = path.join(__dirname, '..', '..', 'public', 'tokens.json');
  const raw = await fs.promises.readFile(tokensPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('tokens.json is not an array');
  }
  return parsed;
}

async function readTokensFile() {
  const tokensPath = path.join(__dirname, '..', '..', 'public', 'tokens.json');
  const raw = await fs.promises.readFile(tokensPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('tokens.json is not an array');
  }
  return { tokensPath, tokens: parsed };
}

function buildCacheKey(chains) {
  if (!chains || chains.length === 0) return 'all';
  return chains.map(lower).sort().join(',');
}

function getStaticTokenAddress(token) {
  return safeTrimString(
    token?.contract_address || token?.contact_address || token?.contractAddress || token?.address
  );
}

// Concurrency helper (from tokenUpdateService)
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

// Chain data helper (from tokenUpdateService)
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

// Build enriched tokens list from static tokens.json (from tokenListService)
async function buildTokensData({ chains = null } = {}) {
  const start = Date.now();
  const staticTokens = await readStaticTokens();

  const chainSet = Array.isArray(chains) && chains.length > 0 ? new Set(chains.map(lower)) : null;
  const filteredTokens = chainSet
    ? staticTokens.filter((t) => chainSet.has(lower(t?.chain)))
    : staticTokens;

  logger.info('TokenInformationService: building tokens list from static tokens.json', {
    staticCount: staticTokens.length,
    filteredCount: filteredTokens.length,
    chains: chainSet ? Array.from(chainSet) : 'all'
  });

  const tokens = [];

  for (const t of filteredTokens) {
    const tokenId = t?.id;
    const chainNameUpper = upper(t?.chain);
    const currencyName = safeTrimString(t?.currency_name);
    const currencyCodeUpper = upper(currencyName);

    if (!currencyCodeUpper || !chainNameUpper) continue;

    let contractAddress = getStaticTokenAddress(t);
    if (!contractAddress) {
      contractAddress = NATIVE_ADDRESS;
    }

    // Special case: POL should use Polygon native proxy address
    if (currencyCodeUpper === 'POL') {
      contractAddress = POLYGON_NATIVE_PROXY;
    }

    const decimalsRaw = t?.contract_precision ?? t?.decimals ?? t?.decimal;
    const decimals =
      decimalsRaw === undefined || decimalsRaw === null || String(decimalsRaw).trim() === ''
        ? '18'
        : String(decimalsRaw);

    const logoFromStatic = safeTrimString(t?.logoURI || t?.logo_uri || t?.logo);
    const logoUri = logoFromStatic || getLogoUri(currencyCodeUpper);

    tokens.push({
      tokenId: String(tokenId),
      tokenName: currencyName || currencyCodeUpper,
      currencyCode: currencyCodeUpper,
      chainName: chainNameUpper,
      contractAddress,
      decimals,
      Logo_URI: logoUri
    });
  }

  const durationMs = Date.now() - start;
  logger.info('TokenInformationService: tokens list built', {
    count: tokens.length,
    durationMs
  });

  return tokens;
}

// Public API: getTokensData (cached)
async function getTokensData({ chains = null, refresh = false } = {}) {
  const key = buildCacheKey(chains);
  const now = Date.now();

  if (!refresh && cache.key === key && cache.data && cache.expiresAt > now) {
    return { success: true, data: cache.data, cached: true };
  }

  if (!refresh && cache.inFlight && cache.key === key) {
    const data = await cache.inFlight;
    return { success: true, data, cached: true };
  }

  cache.key = key;
  cache.inFlight = (async () => {
    try {
      const data = await buildTokensData({ chains });
      cache.data = data;
      cache.expiresAt = Date.now() + TOKENS_CACHE_TTL_MS;
      return data;
    } catch (error) {
      logger.error('TokenInformationService: failed to build tokens list', {
        error: error.message,
        stack: error.stack
      });
      // Keep serving previous cache if we have it
      if (cache.data) return cache.data;
      throw error;
    } finally {
      cache.inFlight = null;
    }
  })();

  const data = await cache.inFlight;
  return { success: true, data, cached: false };
}

// Public API: updateTokensWithContractAddresses (from tokenUpdateService)
/**
 * Update tokens.json with contract addresses from CoinStore API.
 * For each token item, we:
 *  - call getCurrencyInformation(currency_name)
 *  - find matching chain data in chainDataList by chain name
 *  - set token.contact_address = chainData.contractAddress
 */
async function updateTokensWithContractAddresses() {
  try {
    const { tokensPath, tokens } = await readTokensFile();

    logger.info('TokenInformationService: Starting token update process', {
      totalTokens: tokens.length
    });

    // Get unique currency names
    const uniqueCurrencies = Array.from(
      new Set(tokens.map((t) => upper(t?.currency_name)).filter(Boolean))
    );

    logger.info('TokenInformationService: Fetching currency information', {
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
          logger.debug('TokenInformationService: Fetched currency info', {
            currencyCode: currencyCodeUpper,
            chainDataCount: result.data.chainDataList?.length || 0
          });
        } else {
          logger.warn('TokenInformationService: Failed to fetch currency info', {
            currencyCode: currencyCodeUpper,
            error: result?.error
          });
        }
      } catch (error) {
        logger.error('TokenInformationService: Error fetching currency info', {
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

      // Normalize display name: "[SYMBOL] ([CHAIN])"
      if (currencyCodeUpper && chainNameUpper) {
        const desiredDisplayName = `${currencyCodeUpper} (${chainNameUpper})`;
        if (token.currency_name !== desiredDisplayName) {
          // eslint-disable-next-line no-param-reassign
          token.currency_name = desiredDisplayName;
          updatedCount += 1;
        }
      }

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

    // Sort tokens by normalized display name before saving
    tokens.sort((a, b) => {
      const nameA = upper(a?.currency_name);
      const nameB = upper(b?.currency_name);
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    });

    if (updatedCount > 0 || logoUpdatedCount > 0) {
      logger.info('TokenInformationService: Writing updated tokens.json', {
        updatedCount,
        logoUpdatedCount,
        skippedCount,
        totalTokens: tokens.length
      });

      await fs.promises.writeFile(tokensPath, JSON.stringify(tokens, null, 2), 'utf8');

      logger.info('TokenInformationService: Successfully updated tokens.json', {
        updatedCount,
        logoUpdatedCount,
        skippedCount,
        totalTokens: tokens.length
      });
    } else {
      logger.info('TokenInformationService: No updates needed', {
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
    logger.error('TokenInformationService: Error updating tokens', {
      error: error.message,
      stack: error.stack
    });
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Checks whether tokens.json has any missing contract address or logoURI.
 * Returns true if an update is needed, false if everything looks complete.
 */
async function shouldUpdateTokensFile() {
  try {
    const { tokens } = await readTokensFile();

    for (const token of tokens) {
      const contractAddress = safeTrimString(
        token?.contract_address || token?.contact_address || token?.contractAddress || token?.address
      );
      const logoUri = safeTrimString(token?.logoURI || token?.logo_uri || token?.logo);

      if (!contractAddress || !logoUri) {
        return true;
      }
    }

    return false;
  } catch (error) {
    logger.error('TokenInformationService: Error checking tokens.json completeness', {
      error: error.message,
      stack: error.stack
    });
    // In case of any error, be safe and indicate that an update is needed
    return true;
  }
}

module.exports = {
  getTokensData,
  updateTokensWithContractAddresses,
  // Also export some low-level utilities if needed elsewhere in the future
  buildTokensData,
  shouldUpdateTokensFile
};

