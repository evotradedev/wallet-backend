const fs = require('fs');
const path = require('path');
const coinstoreService = require('./coinstoreService');
const logger = require('../utils/logger');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
// Placeholder address commonly used to represent the native currency (ETH/BNB/etc.)
// Note: other parts of the codebase (e.g. blockchainService / exchange UI) treat this as "native".
const NATIVE_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const POLYGON_NATIVE_PROXY = '0x0000000000000000000000000000000000001010';

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

const TOKENS_CACHE_TTL_MS = Number(process.env.TOKENS_CACHE_TTL_MS) || 10 * 60 * 1000; // 10 minutes
const TOKENS_CURRENCYINFO_CONCURRENCY = Number(process.env.TOKENS_CURRENCYINFO_CONCURRENCY) || 10;
const TOKENS_CURRENCYINFO_DELAY_MS = Number(process.env.TOKENS_CURRENCYINFO_DELAY_MS) || 100; // 100ms delay between API calls

let cache = {
  key: null,
  data: null,
  expiresAt: 0,
  inFlight: null
};

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function getLogoUri(currencyCodeUpper) {
  return LOGO_URI_BY_CURRENCY[currencyCodeUpper] || DEFAULT_LOGO_URI;
}

function safeTrimString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
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
        results[current] = await iteratorFn(items[current], current);
      }
    })()
  );

  await Promise.all(workers);
  return results;
}

async function readStaticTokens() {
  const tokensPath = path.join(__dirname, '..', '..', 'public', 'tokens.json');
  const raw = await fs.promises.readFile(tokensPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('tokens.json is not an array');
  }
  return parsed;
}

function buildCacheKey(chains) {
  if (!chains || chains.length === 0) return 'all';
  return chains.map(lower).sort().join(',');
}

function findMatchingChainData(currencyInfo, currencyCodeUpper, chainNameUpper) {
  const chainDataList = Array.isArray(currencyInfo?.chainDataList) ? currencyInfo.chainDataList : [];
  if (chainDataList.length === 0) return null;

  // Prefer strict match on chainName; currency is already scoped by getCurrencyInformation(currencyCode)
  const strict = chainDataList.find((cd) => {
    const cdChain = upper(cd?.chainName || cd?.chain || cd?.network);
    if (!cdChain || cdChain !== chainNameUpper) return false;

    // Some payloads include currencyCode/code on the chainData entry; if present, validate it.
    const cdCurrency = upper(cd?.currencyCode || cd?.code);
    return !cdCurrency || cdCurrency === currencyCodeUpper;
  });

  if (strict) return strict;

  // Fallback: chainName only
  return (
    chainDataList.find((cd) => upper(cd?.chainName || cd?.chain || cd?.network) === chainNameUpper) || null
  );
}

async function buildTokensData({ chains = null } = {}) {
  const start = Date.now();
  const staticTokens = await readStaticTokens();

  const chainSet = Array.isArray(chains) && chains.length > 0 ? new Set(chains.map(lower)) : null;
  const filteredTokens = chainSet
    ? staticTokens.filter((t) => chainSet.has(lower(t?.chain)))
    : staticTokens;

  const uniqueCurrencies = Array.from(
    new Set(filteredTokens.map((t) => upper(t?.currency_name)).filter(Boolean))
  );

  logger.info('TokenListService: building tokens list', {
    staticCount: staticTokens.length,
    filteredCount: filteredTokens.length,
    uniqueCurrencies: uniqueCurrencies.length,
    concurrency: TOKENS_CURRENCYINFO_CONCURRENCY,
    chains: chainSet ? Array.from(chainSet) : 'all'
  });

  const currencyInfoMap = new Map();

  await mapLimit(uniqueCurrencies, TOKENS_CURRENCYINFO_CONCURRENCY, async (currencyCodeUpper) => {
    const result = await coinstoreService.getCurrencyInformation(currencyCodeUpper);
    
    // Wait before next API call (configurable via TOKENS_CURRENCYINFO_DELAY_MS)
    await new Promise(resolve => setTimeout(resolve, TOKENS_CURRENCYINFO_DELAY_MS));
    
    if (result?.success && result?.data) {
      currencyInfoMap.set(currencyCodeUpper, result.data);
      return;
    }

    logger.warn('TokenListService: currency info fetch failed', {
      currencyCode: currencyCodeUpper,
      error: result?.error
    });
  });

  const tokens = [];

  for (const t of filteredTokens) {
    const tokenId = t?.id;
    const chainNameUpper = upper(t?.chain);
    const currencyCodeUpper = upper(t?.currency_name);

    if (!currencyCodeUpper || !chainNameUpper) continue;

    const currencyInfo = currencyInfoMap.get(currencyCodeUpper);
    if (!currencyInfo) continue;

    const chainData = findMatchingChainData(currencyInfo, currencyCodeUpper, chainNameUpper);
    if (!chainData) continue;

    let contractAddress = safeTrimString(chainData?.contractAddress);
    if (!contractAddress) {
      contractAddress = NATIVE_ADDRESS;
    }

    // Special case: POL should use Polygon native proxy address
    if (currencyCodeUpper === 'POL') {
      contractAddress = POLYGON_NATIVE_PROXY;
    }

    const decimalsRaw = t?.contract_precision;
    const decimals =
      decimalsRaw === undefined || decimalsRaw === null || String(decimalsRaw).trim() === ''
        ? '18'
        : String(decimalsRaw);

    const logoFromStatic = safeTrimString(t?.logoURI);
    const logoUri = logoFromStatic || getLogoUri(currencyCodeUpper);

    tokens.push({
      tokenId: String(tokenId),
      tokenName: String(t?.currency_name || ''),
      currencyCode: currencyCodeUpper,
      chainName: String(chainData?.chainName || chainNameUpper),
      contractAddress,
      decimals,
      Logo_URI: logoUri
    });
  }

  const durationMs = Date.now() - start;
  logger.info('TokenListService: tokens list built', {
    count: tokens.length,
    durationMs
  });

  return tokens;
}

async function getAllTokensData({ chains = null, refresh = false } = {}) {
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
      logger.error('TokenListService: failed to build tokens list', {
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

module.exports = {
  getAllTokensData
};

