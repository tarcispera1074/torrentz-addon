const { createHash } = require('crypto');

function normalizeProviders(providers) {
  return [...new Set((providers || []).map(p => String(p).toLowerCase()))]
    .sort()
    .join(',');
}

/**
 * Cache key for scraper results. Provider selection is part of the key so two
 * installs with different provider sets cannot serve each other's results.
 */
function streamsCacheKey(type, query, providers) {
  return `streams:${type}:${normalizeProviders(providers)}:${String(query).trim().toLowerCase()}`;
}

/**
 * Cache key for Debrid instant-availability lookups. The hash list is hashed so
 * the key stays short even for large result sets.
 */
function debridFlagsCacheKey(providerId, infoHashes) {
  const normalized = [...new Set((infoHashes || []).map(h => String(h).toLowerCase()))].sort();
  const digest = createHash('sha1').update(normalized.join(',')).digest('hex');
  return `debrid:${providerId}:${digest}`;
}

module.exports = {
  normalizeProviders,
  streamsCacheKey,
  debridFlagsCacheKey
};
