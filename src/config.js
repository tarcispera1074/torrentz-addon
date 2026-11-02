/**
 * Default Addon Configuration
 */
const DEFAULT_CONFIG = {
  providers: ['tpb', '1337x', 'limetorrents', 'rargb'],
  debridProvider: null, // 'realdebrid', 'alldebrid', 'premiumize', 'torbox', 'debridlink' or null
  debridApiKey: '',
  showP2PFallback: true, // Show P2P torrents if Debrid isn't configured or cached
  maxStreamsPerResolution: 4,
  resolutions: ['4k', '1080p', '720p', '480p']
};

/**
 * Decode config parameter from the URL path
 * Accepts base64 URL safe JSON or pipe-delimited string
 */
function decodeConfig(configStr) {
  if (!configStr || configStr === 'manifest.json') {
    return { ...DEFAULT_CONFIG };
  }

  // 1. Try URL-Safe Base64 JSON
  try {
    const base64 = configStr.replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = Buffer.from(base64, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonStr);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    // Not valid base64 JSON, continue to pipe format
  }

  // 2. Try pipe-delimited format (e.g. providers=tpb,1337x|debrid=realdebrid|key=123)
  const config = { ...DEFAULT_CONFIG };
  try {
    const pairs = decodeURIComponent(configStr).split('|');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (!key || !value) continue;
      const k = key.trim().toLowerCase();
      const v = value.trim();

      if (k === 'providers') {
        config.providers = v.split(',').map(s => s.trim().toLowerCase());
      } else if (k === 'debrid' || k === 'debridprovider') {
        config.debridProvider = v === 'none' ? null : v.toLowerCase();
      } else if (k === 'key' || k === 'debridkey' || k === 'apikey') {
        config.debridApiKey = v;
      } else if (k === 'fallback' || k === 'showp2p') {
        config.showP2PFallback = v === 'true';
      }
    }
  } catch (err) {
    console.warn(`[Config] Failed to parse config string: ${configStr}`);
  }

  return config;
}

/**
 * Encode config object to URL-safe Base64 string
 */
function encodeConfig(configObj) {
  const jsonStr = JSON.stringify(configObj);
  return Buffer.from(jsonStr, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

module.exports = {
  DEFAULT_CONFIG,
  decodeConfig,
  encodeConfig
};
