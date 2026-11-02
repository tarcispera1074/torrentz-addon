const ptn = require('parse-torrent-title');

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce'
];

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
  const match = str.match(/([\d.]+)\s*([GMK]i?B|bytes)/i);
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
 * Format a torrent for Stremio stream output
 */
function formatStream({ rawTitle, infoHash, sizeBytes, seeders, source, debridCached = null, debridProvider = null }) {
  const parsed = ptn.parse(rawTitle || '');
  const resolution = parsed.resolution || 'HD';
  const codec = parsed.codec || '';
  const audio = parsed.audio || '';

  let badge = '';
  if (debridProvider) {
    badge = debridCached ? `[${debridProvider}+]` : `[${debridProvider} download]`;
  } else {
    badge = `[P2P]`;
  }

  const streamName = `${badge} ${resolution.toUpperCase()}`;

  const metaTags = [];
  if (seeders !== undefined && seeders !== null) metaTags.push(`👤 ${seeders}`);
  if (sizeBytes) metaTags.push(`💾 ${formatSize(sizeBytes)}`);
  if (source) metaTags.push(`⚙️ ${source}`);
  if (codec) metaTags.push(codec);
  if (audio) metaTags.push(audio);

  const streamTitle = `${rawTitle}\n${metaTags.join(' | ')}`;

  const sources = [
    `dht:${infoHash.toLowerCase()}`,
    ...DEFAULT_TRACKERS.map(tr => `tracker:${tr}`)
  ];

  return {
    name: streamName,
    title: streamTitle,
    infoHash: infoHash.toLowerCase(),
    sources,
    resolution,
    seeders: parseInt(seeders) || 0,
    sizeBytes: sizeBytes || 0,
    source,
    rawTitle
  };
}

module.exports = {
  formatSize,
  parseSizeToBytes,
  extractInfoHash,
  formatStream,
  DEFAULT_TRACKERS
};
