const { normalizeResolution, SUPPORTED_RESOLUTIONS } = require('./utils/parser');
const { TUBE_SITE_IDS, DEFAULT_TUBE_SITES } = require('./streaming/tube-sites');

/**
 * Default Addon Configuration
 */
const DEFAULT_CONFIG = {
  mode: 'all', // 'movies', 'xxx', 'all'
  providers: ['tpb', '1337x', 'limetorrents', 'rargb'],
  metadataSources: [],
  metadataApiKeys: {},
  tubeSites: [...DEFAULT_TUBE_SITES],
  debridProvider: null, // 'realdebrid', 'alldebrid', 'premiumize', 'torbox', 'debridlink' or null
  debridApiKey: '',
  showP2PFallback: true,
  maxStreamsPerResolution: 5,
  resolutions: ['2160p', '1080p', '720p', '480p'],
  groupByTitle: true
};

const MODES = new Set(['all', 'movies', 'xxx', 'other']);
const METADATA_SOURCES = new Set(['tpdb', 'stashdb', 'javstash', 'pmvstash', 'fansdb']);

const PROVIDER_ALIASES = {
  tpb: 'tpb',
  thepiratebay: 'tpb',
  '1337x': '1337x',
  limetorrents: 'limetorrents',
  rargb: 'rargb',
  torlock: 'torlock',
  pussytorrents: 'pussytorrents',
  yourbittorrent2: 'yourbittorrent2',
  bootytape: 'bootytape',
  mypornclub: 'mypornclub',
  lovetorrent: 'lovetorrent',
  xxxclub: 'xxxclub',
  pornrips: 'pornrips',
  sukebei: 'sukebei',
  'sukebei-nyaa': 'sukebei',
  tokyotosho: 'tokyotosho',
  ffjav: 'ffjav',
  'ff-jav': 'ffjav'
};

const DEBRID_PROVIDERS = new Set([
  'realdebrid',
  'alldebrid',
  'premiumize',
  'torbox',
  'debridlink'
]);

const ALLOWED_KEYS = new Set([
  'mode',
  'providers',
  'debridProvider',
  'debridApiKey',
  'showP2PFallback',
  'maxStreamsPerResolution',
  'resolutions',
  'groupByTitle',
  'metadataSources',
  'metadataApiKeys',
  'tubeSites'
]);

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    return value;
  }
}

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function sanitizeProviders(value, fallback) {
  const list = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);

  const providers = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const key = item.trim().toLowerCase();
    const canonical = PROVIDER_ALIASES[key];
    if (canonical && !providers.includes(canonical)) {
      providers.push(canonical);
    }
  }

  return providers.length > 0 ? providers : [...fallback];
}

function sanitizeResolutions(value, fallback) {
  const list = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);

  const resolutions = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeResolution(item);
    if (SUPPORTED_RESOLUTIONS.includes(normalized) && !resolutions.includes(normalized)) {
      resolutions.push(normalized);
    }
  }

  return resolutions.length > 0 ? resolutions : [...fallback];
}

function sanitizeMetadataSources(value) {
  const list = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);
  return [...new Set(list
    .filter(item => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(item => METADATA_SOURCES.has(item)))];
}

function sanitizeMetadataApiKeys(value) {
  const keys = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return keys;

  for (const source of METADATA_SOURCES) {
    const token = value[source];
    if (typeof token === 'string' && token.trim()) {
      keys[source] = token.trim().slice(0, 512);
    }
  }
  return keys;
}

function sanitizeTubeSites(value) {
  const list = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);
  return [...new Set(list
    .filter(item => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(item => TUBE_SITE_IDS.includes(item)))];
}

/**
 * Keep only known keys and coerce every value to the expected type.
 * This also blocks prototype-pollution style keys from user supplied config.
 */
function sanitizeConfig(input = {}) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};

  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    out[key] = input[key];
  }

  if (typeof out.mode === 'string' && MODES.has(out.mode.trim().toLowerCase())) {
    out.mode = out.mode.trim().toLowerCase();
  } else {
    delete out.mode;
  }

  if (out.providers !== undefined) {
    out.providers = sanitizeProviders(out.providers, DEFAULT_CONFIG.providers);
  }

  if (out.metadataSources !== undefined) {
    out.metadataSources = sanitizeMetadataSources(out.metadataSources);
  }

  if (out.metadataApiKeys !== undefined) {
    out.metadataApiKeys = sanitizeMetadataApiKeys(out.metadataApiKeys);
  }

  if (out.tubeSites !== undefined) {
    out.tubeSites = sanitizeTubeSites(out.tubeSites);
  }

  if (out.debridProvider !== undefined) {
    if (out.debridProvider === null || out.debridProvider === '') {
      out.debridProvider = null;
    } else if (typeof out.debridProvider === 'string') {
      const provider = out.debridProvider.trim().toLowerCase();
      out.debridProvider = DEBRID_PROVIDERS.has(provider) ? provider : null;
    } else {
      out.debridProvider = null;
    }
  }

  if (out.debridApiKey !== undefined) {
    out.debridApiKey = typeof out.debridApiKey === 'string'
      ? out.debridApiKey.trim().slice(0, 512)
      : '';
  }

  if (out.showP2PFallback !== undefined) {
    out.showP2PFallback = toBoolean(out.showP2PFallback, DEFAULT_CONFIG.showP2PFallback);
  }

  if (out.groupByTitle !== undefined) {
    out.groupByTitle = toBoolean(out.groupByTitle, DEFAULT_CONFIG.groupByTitle);
  }

  if (out.maxStreamsPerResolution !== undefined) {
    const parsed = parseInt(out.maxStreamsPerResolution, 10);
    out.maxStreamsPerResolution = Number.isFinite(parsed)
      ? Math.max(1, Math.min(200, parsed))
      : DEFAULT_CONFIG.maxStreamsPerResolution;
  }

  if (out.resolutions !== undefined) {
    out.resolutions = sanitizeResolutions(out.resolutions, DEFAULT_CONFIG.resolutions);
  }

  return out;
}

/**
 * Decode config parameter from the URL path.
 *
 * Supported formats:
 *   1. URL-safe Base64 encoded JSON (used by the web UI)
 *   2. Pipe-delimited key=value pairs (e.g. mode=movies|providers=tpb,1337x)
 */
function decodeConfig(configStr) {
  if (!configStr || configStr === 'manifest.json') {
    return { ...DEFAULT_CONFIG };
  }

  // 1. Strict URL-safe Base64 JSON. Rejecting garbage before decoding avoids
  //    accidentally parsing arbitrary path segments as config.
  if (/^[A-Za-z0-9_=-]+$/.test(configStr) && configStr.length % 4 !== 1) {
    try {
      const base64 = configStr.replace(/-/g, '+').replace(/_/g, '/');
      const jsonStr = Buffer.from(base64, 'base64').toString('utf8');
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...DEFAULT_CONFIG, ...sanitizeConfig(parsed) };
      }
    } catch (err) {
      // Not valid base64 JSON, continue to pipe format
    }
  }

  // 2. Pipe-delimited format. URLSearchParams preserves '=' characters inside
  //    API keys (the old split('=') implementation truncated them).
  const overrides = {};
  try {
    const params = new URLSearchParams(safeDecode(configStr).replace(/\|/g, '&'));

    for (const [rawKey, value] of params) {
      const key = rawKey.trim().toLowerCase();
      const v = value.trim();

      if (key === 'mode') {
        overrides.mode = v.toLowerCase();
      } else if (key === 'providers') {
        overrides.providers = v.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      } else if (key === 'debrid' || key === 'debridprovider') {
        overrides.debridProvider = v === 'none' ? null : v.toLowerCase();
      } else if (key === 'key' || key === 'debridkey' || key === 'apikey') {
        overrides.debridApiKey = v;
      } else if (key === 'fallback' || key === 'showp2p') {
        overrides.showP2PFallback = v;
      } else if (key === 'group' || key === 'groupbytitle') {
        overrides.groupByTitle = v;
      } else if (key === 'maxstreams' || key === 'maxstreamsperresolution') {
        overrides.maxStreamsPerResolution = v;
      } else if (key === 'resolutions') {
        overrides.resolutions = v.split(',').map(s => s.trim()).filter(Boolean);
      } else if (key === 'metadatasources') {
        overrides.metadataSources = v.split(',').map(s => s.trim()).filter(Boolean);
      } else if (key === 'metadataapikeys') {
        try {
          overrides.metadataApiKeys = JSON.parse(v);
        } catch (err) {
          overrides.metadataApiKeys = {};
        }
      } else if (key === 'tubesites') {
        overrides.tubeSites = v.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
  } catch (err) {
    console.warn(`[Config] Failed to parse config string: ${configStr}`);
  }

  return { ...DEFAULT_CONFIG, ...sanitizeConfig(overrides) };
}

/**
 * Encode config object to URL-safe Base64 string
 */
function encodeConfig(configObj) {
  const safe = { ...DEFAULT_CONFIG, ...sanitizeConfig(configObj) };
  const jsonStr = JSON.stringify(safe);
  return Buffer.from(jsonStr, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

module.exports = {
  DEFAULT_CONFIG,
  decodeConfig,
  encodeConfig,
  sanitizeConfig
};
