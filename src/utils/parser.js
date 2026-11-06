const ptn = require('parse-torrent-title');

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce'
];

const RESOLUTION_ALIASES = {
  '4k': '2160p',
  '2160': '2160p',
  '2160p': '2160p',
  uhd: '2160p',
  '1080': '1080p',
  '1080p': '1080p',
  '720': '720p',
  '720p': '720p',
  '480': '480p',
  '480p': '480p',
  '360': '360p',
  '360p': '360p',
  '240': '240p',
  '240p': '240p'
};

const RESOLUTION_LABELS = {
  '2160p': '4K',
  '1080p': '1080p',
  '720p': '720p',
  '480p': '480p',
  '360p': '360p',
  '240p': '240p',
  other: 'HD'
};

const RESOLUTION_RANK = {
  '2160p': 6,
  '1080p': 5,
  '720p': 4,
  '480p': 3,
  '360p': 2,
  '240p': 1,
  other: 0
};

const SUPPORTED_RESOLUTIONS = ['2160p', '1080p', '720p', '480p', '360p', '240p'];

/**
 * Format bytes to human readable format (GB / MB)
 */
function formatSize(bytes) {
  if (!bytes || isNaN(bytes)) return 'Unknown';
  const num = parseInt(bytes);
  if (num <= 0) return 'Unknown';
  const gb = num / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  const mb = num / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

/**
 * Parse raw size strings like "2.4 GB", "850 MB" into bytes
 */
function parseSizeToBytes(str) {
  if (!str) return 0;
  if (typeof str === 'number') return str;
  const match = String(str).match(/([\d.]+)\s*([GMK]i?B|bytes)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit.startsWith('G')) return Math.round(val * 1024 * 1024 * 1024);
  if (unit.startsWith('M')) return Math.round(val * 1024 * 1024);
  if (unit.startsWith('K')) return Math.round(val * 1024);
  return Math.round(val);
}

/**
 * Extract 40-character infoHash from a magnet URI or raw hash string
 */
function extractInfoHash(magnetOrHash) {
  if (!magnetOrHash) return null;
  if (/^[a-fA-F0-9]{40}$/.test(magnetOrHash.trim())) {
    return magnetOrHash.trim().toLowerCase();
  }
  const match = magnetOrHash.match(/urn:btih:([a-fA-F0-9]{40})/i);
  if (match) {
    return match[1].toLowerCase();
  }
  const b32Match = magnetOrHash.match(/urn:btih:([a-zA-Z2-7]{32})/i);
  if (b32Match) {
    return base32ToHex(b32Match[1]).toLowerCase();
  }
  return null;
}

function base32ToHex(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  const clean = base32.toUpperCase();
  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean.charAt(i));
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    const chunk = bits.substr(i, 4);
    hex += parseInt(chunk, 2).toString(16);
  }
  return hex;
}

/**
 * Canonical resolution key used for filtering, ranking and UI labels.
 */
function normalizeResolution(resolution) {
  if (!resolution) return 'other';
  const key = String(resolution).toLowerCase().replace(/\s+/g, '');
  return RESOLUTION_ALIASES[key] || key;
}

function resolutionLabel(resolution) {
  const normalized = normalizeResolution(resolution);
  return RESOLUTION_LABELS[normalized] || normalized.toUpperCase();
}

function resolutionRank(resolution) {
  return RESOLUTION_RANK[normalizeResolution(resolution)] ?? 0;
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Parse a torrent release name into a canonical display title and grouping key.
 * Releases of the same movie/episode that only differ by quality, codec or
 * source share the same `key`, which is what the server uses to keep them
 * adjacent in the stream list.
 */
function getTitleInfo(rawTitle) {
  const parsed = ptn.parse(rawTitle || '');

  const title = (parsed.title || '').trim() || String(rawTitle || '').trim();
  const year = parsed.year ? String(parsed.year) : null;
  const season = Number.isFinite(Number(parsed.season)) && parsed.season !== undefined
    ? Number(parsed.season)
    : null;
  const episode = Number.isFinite(Number(parsed.episode)) && parsed.episode !== undefined
    ? Number(parsed.episode)
    : null;

  let label = title;
  if (year) label += ` (${year})`;
  if (season !== null && episode !== null) {
    label += ` S${pad2(season)}E${pad2(episode)}`;
  }

  const key = [
    normalizeTitle(title),
    year || '',
    season === null ? '' : season,
    episode === null ? '' : episode
  ].join('|');

  return {
    parsed,
    title,
    year,
    season,
    episode,
    label,
    key
  };
}

/**
 * Format a torrent for Stremio stream output.
 *
 * `displayTitle` is the canonical title shown on the first line. Keeping it
 * identical for every quality variant makes the variants read as one title
 * with multiple options in the Stremio/Nuvio stream list.
 */
function formatStream({
  rawTitle,
  infoHash,
  sizeBytes,
  seeders,
  source,
  debridCached = null,
  debridProvider = null,
  displayTitle = null,
  titleInfo = null
}) {
  const info = titleInfo || getTitleInfo(rawTitle);
  const parsed = info.parsed || {};

  const resolution = normalizeResolution(parsed.resolution);
  const codec = parsed.codec || '';
  const audio = parsed.audio || '';

  let badge = '';
  if (debridProvider) {
    badge = debridCached ? `[${debridProvider}+]` : `[${debridProvider} download]`;
  } else {
    badge = `[P2P]`;
  }

  const streamName = `${badge} ${resolutionLabel(resolution)}`;

  const metaTags = [];
  if (seeders !== undefined && seeders !== null) metaTags.push(`👤 ${seeders}`);
  if (sizeBytes) metaTags.push(`💾 ${formatSize(sizeBytes)}`);
  if (source) metaTags.push(`⚙️ ${source}`);
  if (codec) metaTags.push(codec);
  if (audio) metaTags.push(audio);

  const heading = displayTitle || info.label || rawTitle || '';
  const titleLines = [heading];
  if (rawTitle && normalizeTitle(rawTitle) !== normalizeTitle(heading)) {
    titleLines.push(rawTitle);
  }
  if (metaTags.length > 0) {
    titleLines.push(metaTags.join(' | '));
  }

  const streamTitle = titleLines.filter(Boolean).join('\n');
  const normalizedHash = String(infoHash || '').toLowerCase();

  const sources = [
    `dht:${normalizedHash}`,
    ...DEFAULT_TRACKERS.map(tr => `tracker:${tr}`)
  ];

  return {
    name: streamName,
    title: streamTitle,
    infoHash: normalizedHash,
    sources,
    resolution,
    resolutionRank: resolutionRank(resolution),
    seeders: parseInt(seeders, 10) || 0,
    sizeBytes: sizeBytes || 0,
    source,
    rawTitle,
    displayTitle: heading,
    groupKey: info.key,
    debridCached: Boolean(debridCached)
  };
}

module.exports = {
  formatSize,
  parseSizeToBytes,
  extractInfoHash,
  formatStream,
  getTitleInfo,
  normalizeResolution,
  normalizeTitle,
  resolutionLabel,
  resolutionRank,
  SUPPORTED_RESOLUTIONS,
  RESOLUTION_LABELS,
  RESOLUTION_RANK,
  DEFAULT_TRACKERS
};
