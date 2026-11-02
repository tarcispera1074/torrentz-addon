const realdebrid = require('./realdebrid');
const alldebrid = require('./alldebrid');
const premiumize = require('./premiumize');
const torbox = require('./torbox');
const debridlink = require('./debridlink');

const PROVIDERS = {
  realdebrid,
  alldebrid,
  premiumize,
  torbox,
  debridlink
};

function getProvider(id) {
  if (!id) return null;
  return PROVIDERS[id.toLowerCase()] || null;
}

async function checkCache(providerId, apiKey, infoHashes) {
  const provider = getProvider(providerId);
  if (!provider) return new Set();
  return provider.checkCache(apiKey, infoHashes);
}

async function resolveStream(providerId, apiKey, infoHash) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unknown debrid provider: ${providerId}`);
  return provider.resolveStream(apiKey, infoHash);
}

module.exports = {
  PROVIDERS,
  getProvider,
  checkCache,
  resolveStream
};
