const express = require('express');
const cors = require('cors');
const path = require('path');
const { createHash } = require('node:crypto');
const { decodeConfig, DEFAULT_CONFIG } = require('./config');
const { getMetadata, searchCatalog, normalizeTitle } = require('./metadata/cinemeta');
const stashbox = require('./metadata/stashbox');
const tubehub = require('./streaming/tubehub');
const scrapers = require('./scrapers');
const debrid = require('./debrid');
const {
  formatStream,
  formatSize,
  getTitleInfo,
  normalizeResolution
} = require('./utils/parser');
const { streamsCacheKey, debridFlagsCacheKey, normalizeProviders } = require('./utils/cacheKeys');
const { createManifest, createTubeHubManifest, createTubeSiteManifest } = require('./manifest');
const cache = require('./utils/cache');

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '8kb' }));

const CATALOG_TORRENT_TTL = 24 * 60 * 60 * 1000;
const CATALOG_TTL = 10 * 60 * 1000;
const EMPTY_CATALOG_TTL = 2 * 60 * 1000;
const STREAM_TTL = 15 * 60 * 1000;
const DEBRID_FLAGS_TTL = 10 * 60 * 1000;
const METADATA_CHECK_WINDOW_MS = 60 * 1000;
const METADATA_CHECK_LIMIT = 15;
const metadataCheckRate = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Parse catalog "extra" from the raw path segment.
 *
 * Express has already decoded `req.params.extra`, which makes titles containing
 * `&` ambiguous. Parsing the raw (still percent-encoded) last path segment with
 * URLSearchParams preserves the distinction and avoids double-decoding.
 */
function parseCatalogExtra(req, extra) {
  const pathOnly = (req.originalUrl || '').split('?')[0];
  const segments = pathOnly.split('/').filter(Boolean);
  const rawSegment = (segments[segments.length - 1] || '').replace(/\.json$/i, '');
  const source = rawSegment.includes('=') ? rawSegment : (extra || '');

  if (!source) return {};
  try {
    return Object.fromEntries(new URLSearchParams(source));
  } catch (err) {
    return {};
  }
}

function extractYear(value) {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : '';
}

function posterKey(name, year) {
  return `${normalizeTitle(name)}|${extractYear(year)}`;
}

function encodeGroupId(key) {
  return Buffer.from(String(key), 'utf8').toString('base64url');
}

function decodeGroupId(value) {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch (err) {
    return null;
  }
}

function catalogCacheKey(type, id, query, providers, metadataSources = [], metadataApiKeys = {}) {
  const metadataSignature = [...metadataSources]
    .filter(source => metadataApiKeys[source])
    .sort()
    .map(source => `${source}:${createHash('sha256').update(metadataApiKeys[source]).digest('hex').slice(0, 12)}`)
    .join(',');
  return `catalog-response:${type}:${id}:${normalizeProviders(providers)}:${metadataSignature}:${String(query).trim().toLowerCase()}`;
}

function groupKeyParts(key) {
  const [title = '', year = '', season = '', episode = ''] = String(key || '').split('|');
  return { title, year, season, episode };
}

function groupKeyLabel(key) {
  const { title, year, season, episode } = groupKeyParts(key);
  let label = title ? title.replace(/\b\w/g, ch => ch.toUpperCase()) : '';
  if (year) label += ` (${year})`;
  if (season && episode) {
    label += ` S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
  }
  return label || 'Torrent group';
}

const METADATA_SCENE_ID_RE = /^(tpdb|stashdb|javstash|pmvstash|fansdb)-scene:(.+)$/;

function parseMetadataSceneId(id) {
  const match = String(id || '').match(METADATA_SCENE_ID_RE);
  if (!match) return null;
  try {
    return { source: match[1], sceneId: decodeURIComponent(match[2]) };
  } catch (err) {
    return { source: match[1], sceneId: match[2] };
  }
}

function metadataSourceForCatalogId(id) {
  const match = String(id || '').match(/^torrentz_(tpdb|stashdb|javstash|pmvstash|fansdb)$/);
  return match ? match[1] : null;
}

function metadataSceneId(scene) {
  return `${scene.provider}-scene:${encodeURIComponent(scene.id)}`;
}

function metadataSceneCacheKey(scene) {
  return `metadata-scene-record:${scene.provider}:${scene.id}`;
}

function sceneDedupeKey(scene) {
  const code = normalizeTitle(scene.code);
  if (code) return `code:${code}`;
  const year = extractYear(scene.date);
  const title = normalizeTitle(scene.title);
  const studio = normalizeTitle(scene.studio);
  const performers = [...(scene.performers || [])].map(normalizeTitle).sort().join(',');
  return `${title}|${year}|${studio}|${performers}`;
}

function sceneDescription(scene, sources = [scene.providerName]) {
  const parts = [`Metadata: ${[...new Set(sources)].join(', ')}`];
  if (scene.studio) parts.push(`Studio: ${scene.studio}`);
  if (scene.performers?.length) parts.push(`Cast: ${scene.performers.slice(0, 6).join(', ')}`);
  if (scene.code) parts.push(`Code: ${scene.code}`);
  if (scene.date) parts.push(`Date: ${scene.date}`);
  return parts.join(' | ');
}

function buildMetadataCatalogMetas(scenes, type, req) {
  const groups = new Map();
  for (const scene of scenes) {
    const key = sceneDedupeKey(scene);
    if (!groups.has(key)) groups.set(key, { primary: scene, scenes: [] });
    const group = groups.get(key);
    group.scenes.push(scene);
  }

  return [...groups.values()].map(({ primary, scenes: matches }) => {
    const id = metadataSceneId(primary);
    const sources = matches.map(scene => scene.providerName);
    for (const scene of matches) {
      cache.set(metadataSceneCacheKey(scene), scene, CATALOG_TORRENT_TTL);
    }
    cache.set(`metadata-scene-group:${id}`, matches, CATALOG_TORRENT_TTL);

    const meta = {
      id,
      type: type || 'movie',
      name: primary.title,
      poster: primary.poster || matches.find(scene => scene.poster)?.poster || placeholderPosterUrl(req, primary.title),
      posterShape: 'poster',
      description: sceneDescription(primary, sources)
    };
    if (primary.date) meta.releaseInfo = primary.date.slice(0, 10);
    return meta;
  });
}

async function getMetadataSceneRecords(parsedId, config) {
  const groupKey = `metadata-scene-group:${metadataSceneId({ provider: parsedId.source, id: parsedId.sceneId })}`;
  const grouped = cache.get(groupKey);
  if (Array.isArray(grouped) && grouped.length > 0) return grouped;

  const sourceConfig = stashbox.SOURCES[parsedId.source];
  const token = config.metadataApiKeys?.[parsedId.source];
  if (!sourceConfig || !token) return [];

  const scene = await stashbox.getScene(parsedId.source, token, parsedId.sceneId);
  if (!scene) return [];
  cache.set(metadataSceneCacheKey(scene), scene, CATALOG_TORRENT_TTL);
  cache.set(groupKey, [scene], CATALOG_TORRENT_TTL);
  return [scene];
}

function metadataTorrentQueries(scene) {
  const code = String(scene.code || '').trim();
  // Prefer DVD-style release codes (e.g. SSIS-001). Many web-scene databases
  // populate `code` with an internal numeric ID that torrent titles won't use.
  const queries = [];
  if (/^[A-Z0-9]{2,12}-\d{2,6}$/i.test(code)) {
    queries.push({ query: code.slice(0, 120), matchKind: 'code' });
  }
  const title = String(scene.title || '').trim();
  const normalizedTitle = normalizeTitle(title);
  const performer = (scene.performers || []).find(name => {
    const normalizedPerformer = normalizeTitle(name);
    return normalizedPerformer && normalizedTitle.includes(normalizedPerformer);
  }) || scene.performers?.[0];

  if (title) queries.push({ query: title.slice(0, 160), matchKind: 'title' });
  if (title && scene.studio && !normalizedTitle.includes(normalizeTitle(scene.studio))) {
    queries.push({ query: `${title} ${scene.studio}`.slice(0, 160), matchKind: 'studio' });
  }
  if (performer) queries.push({ query: String(performer).slice(0, 120), matchKind: 'performer' });
  else {
    // Some metadata records omit the cast list even though the scene title
    // starts with the performer's name (e.g. "Blair Williams ..."). Try that
    // short prefix before giving up on the catalog item.
    const titlePrefix = title.split(/\s+/).slice(0, 2).join(' ');
    if (titlePrefix && normalizeTitle(titlePrefix).split(' ').length === 2) {
      queries.push({ query: titlePrefix.slice(0, 80), matchKind: 'title-keyword' });
    }
  }
  return [...new Map(queries.map(item => [item.query.toLowerCase(), item])).values()];
}

const TORRENT_TITLE_STOP_WORDS = new Set(['a', 'an', 'and', 'by', 'for', 'from', 'her', 'his', 'in', 'of', 'the', 'to', 'with']);

function isMetadataTorrentRelevant(scene, torrent) {
  const release = normalizeTitle(torrent.rawTitle);
  if (!release) return false;

  const code = String(scene.code || '').trim();
  if (/^[A-Z0-9]{2,12}-\d{2,6}$/i.test(code) && release.includes(normalizeTitle(code))) return true;

  const titleWords = normalizeTitle(scene.title)
    .split(' ')
    .filter(word => word.length > 1 && !TORRENT_TITLE_STOP_WORDS.has(word));
  if (titleWords.length === 0) return false;

  const releaseWords = new Set(release.split(' '));
  const matchingTitleWords = titleWords.filter(word => releaseWords.has(word)).length;
  const titleOverlap = matchingTitleWords / titleWords.length;
  const castMatch = (scene.performers || []).some(name => {
    const performer = normalizeTitle(name);
    return performer.length > 2 && release.includes(performer);
  });
  const studio = normalizeTitle(scene.studio);
  const studioMatch = studio.length > 2 && release.includes(studio);

  // Avoid unrelated torrents sharing a short/generic scene title.
  if (titleWords.length <= 2) return titleOverlap === 1 && (castMatch || studioMatch);
  if (titleOverlap >= 0.8) return true;
  if (titleOverlap >= 0.4 && (castMatch || studioMatch)) return true;
  return castMatch && studioMatch && titleOverlap >= 0.25;
}

function addTorrentSourceBadge(stream, matchKind = 'title') {
  const sourceId = String(stream.source || '').trim();
  const scraper = scrapers.SCRAPERS?.[sourceId.toLowerCase()];
  const source = String(scraper?.name || sourceId).replace(/[\[\]\r\n]/g, '').slice(0, 40);
  const matchBadge = matchKind === 'performer'
    ? 'Performer match'
    : (matchKind === 'title-keyword' ? 'Title keyword match' : null);
  const badges = [source, matchBadge].filter(Boolean);
  if (badges.length) stream.name = stream.name.replace(/^([^\s]+)\s+/, `$1 [${badges.join('] [')}] `);
  if (matchBadge) {
    stream.title += `\n⚠ ${matchBadge} only; verify this is the same scene.`;
  }
  return stream;
}

/**
 * Rebuild a grouped catalog item after the in-memory cache was cleared (for
 * example when Render restarts). The ID carries the canonical title/year key,
 * so the variants can always be recovered with one bounded search.
 */
async function getGroupTorrents(groupId, config) {
  const cacheKey = `torrent-group:${groupId}`;
  const cached = cache.get(cacheKey);
  if (Array.isArray(cached) && cached.length > 0) return cached;

  const key = decodeGroupId(groupId);
  if (!key) return [];

  const { title, year } = groupKeyParts(key);
  const query = [title.slice(0, 150), year].filter(Boolean).join(' ').trim();
  if (!query) return [];

  const results = await scrapers.searchAll(query, config.providers);
  let variants = results.filter(torrent => getTitleInfo(torrent.rawTitle).key === key);
  if (variants.length === 0) {
    variants = results.filter(torrent => normalizeTitle(torrent.rawTitle).includes(title));
  }
  if (variants.length === 0) return [];

  for (const torrent of variants) {
    cache.set(`torrent:${torrent.infoHash}`, torrent, CATALOG_TORRENT_TTL);
  }
  cache.set(cacheKey, variants, CATALOG_TORRENT_TTL);
  return variants;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Deterministic, dependency-free poster used when Cinemeta has no match.
 * The SVG is served over HTTP because some Stremio/Nuvio clients do not render
 * data-image URIs in catalog posters.
 */
function placeholderPosterSvg(title) {
  const text = String(title || 'Torrentz').slice(0, 42);
  let hue = 0;
  for (const ch of text) hue = (hue + ch.charCodeAt(0)) % 360;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},35%,14%)"/>` +
    `<stop offset="1" stop-color="hsl(${(hue + 40) % 360},45%,24%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="300" height="450" fill="url(#g)"/>` +
    `<text x="150" y="228" fill="#e7e4ff" font-family="sans-serif" font-size="20" font-weight="600" text-anchor="middle">${escapeXml(text)}</text>` +
    `</svg>`;

  return svg;
}

function placeholderPosterUrl(req, title) {
  // Nuvio clients commonly reject SVG/data-URI posters. Use a conventional
  // PNG placeholder for unmatched adult releases; real source/Cinemeta posters
  // are still preferred before this fallback.
  const label = encodeURIComponent(String(title || 'Torrentz').slice(0, 70));
  return `https://placehold.co/300x450/171923/f4f4f5.png?text=${label}`;
}

/**
 * Enrich scraped torrents with real Cinemeta posters when a title matches.
 */
function buildCatalogMetas(torrents, type, catalog, req) {
  const byKey = new Map();
  for (const meta of catalog) {
    if (!meta || !meta.name) continue;
    const withYear = posterKey(meta.name, meta.releaseInfo || meta.year);
    const withoutYear = posterKey(meta.name, '');
    if (!byKey.has(withYear)) byKey.set(withYear, meta);
    if (!byKey.has(withoutYear)) byKey.set(withoutYear, meta);
  }

  const groups = new Map();
  for (const torrent of torrents) {
    const info = getTitleInfo(torrent.rawTitle);
    const key = info.key || torrent.infoHash;
    if (!groups.has(key)) groups.set(key, { key, info, torrents: [] });
    groups.get(key).torrents.push(torrent);
  }

  return [...groups.values()].map(group => {
    const { info, key, torrents: variants } = group;
    const first = variants[0];
    const hit = byKey.get(posterKey(info.title, info.year)) || byKey.get(posterKey(info.title, ''));
    const groupId = encodeGroupId(key);

    // Store every quality/size variant under one catalog item.
    for (const torrent of variants) {
      cache.set(`torrent:${torrent.infoHash}`, torrent, CATALOG_TORRENT_TTL);
    }
    cache.set(`torrent-group:${groupId}`, variants, CATALOG_TORRENT_TTL);

    const meta = {
      id: `torrentz-group:${groupId}`,
      type: type || 'movie',
      name: info.label || first.rawTitle,
      poster: hit?.poster || first.poster || placeholderPosterUrl(req, info.label || first.rawTitle),
      posterShape: 'poster',
      description: `${variants.length} quality options | Best: ${formatSize(Math.max(...variants.map(t => t.sizeBytes || 0)))} | ⚙️ ${first.source}`
    };

    if (hit?.background) meta.background = hit.background;
    if (info.year) meta.releaseInfo = info.year;
    return meta;
  });
}

function compareStreams(a, b) {
  if (a.debridCached !== b.debridCached) return a.debridCached ? -1 : 1;
  if (a.resolutionRank !== b.resolutionRank) return b.resolutionRank - a.resolutionRank;
  return b.seeders - a.seeders;
}

/**
 * Keep releases of the same movie/episode adjacent, ordered from best group
 * (highest seeders) to worst. Inside a group, cached Debrid streams come first,
 * then highest resolution, then seeders. This is the closest Stremio/Nuvio
 * allows to nested "same title, different quality" options.
 */
function orderStreams(streams, groupByTitle) {
  if (!groupByTitle) {
    return [...streams].sort((a, b) => b.seeders - a.seeders);
  }

  const groups = new Map();

  for (const stream of streams) {
    const key = stream.groupKey || stream.infoHash;
    let group = groups.get(key);
    if (!group) {
      group = { key, bestSeeders: 0, streams: [] };
      groups.set(key, group);
    }
    group.bestSeeders = Math.max(group.bestSeeders, stream.seeders || 0);
    group.streams.push(stream);
  }

  return [...groups.values()]
    .sort((a, b) => b.bestSeeders - a.bestSeeders || a.key.localeCompare(b.key))
    .flatMap(group => group.streams.sort(compareStreams));
}

function toStremioStream(stream) {
  const out = {
    name: stream.name,
    title: stream.title
  };

  if (stream.url) {
    out.url = stream.url;
  } else {
    out.infoHash = stream.infoHash;
    out.sources = stream.sources;
  }

  const hints = {};
  if (stream.rawTitle) hints.filename = stream.rawTitle;
  if (stream.sizeBytes > 0) hints.videoSize = stream.sizeBytes;
  if (Object.keys(hints).length > 0) out.behaviorHints = hints;

  return out;
}

// 1. Health check, debug & configuration UI
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

app.post('/metadata/check', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let rate = metadataCheckRate.get(clientIp);
  if (!rate || now >= rate.resetAt) {
    rate = { count: 0, resetAt: now + METADATA_CHECK_WINDOW_MS };
  }
  rate.count += 1;
  metadataCheckRate.set(clientIp, rate);
  if (metadataCheckRate.size > 1000) {
    for (const [ip, entry] of metadataCheckRate) {
      if (now >= entry.resetAt) metadataCheckRate.delete(ip);
    }
  }
  if (rate.count > METADATA_CHECK_LIMIT) {
    return res.status(429).json({ valid: false, message: 'Too many key checks. Wait a minute and try again.' });
  }

  const source = String(req.body?.source || '').trim().toLowerCase();
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';

  if (!stashbox.SOURCES[source]) {
    return res.status(400).json({ valid: false, message: 'Unknown metadata source.' });
  }
  if (!apiKey || apiKey.length > 512) {
    return res.status(400).json({ valid: false, message: 'Enter a valid API key (maximum 512 characters).' });
  }

  const result = await stashbox.checkApiKey(source, apiKey);
  res.json(result);
});

app.get('/test-raw-tpb', async (req, res) => {
  const axios = require('axios');
  const q = req.query.q || 'Blair Williams';
  const urls = [
    `https://apibay.org/q.php?q=${encodeURIComponent(q)}`,
    `https://thepiratebay.party/search/${encodeURIComponent(q)}/1/99/0`,
    `https://thehiddenbay.com/search/${encodeURIComponent(q)}/1/99/0`,
    `https://pirateproxy.live/search/${encodeURIComponent(q)}/1/99/0`,
    `https://tpb.cool/search/${encodeURIComponent(q)}/1/99/0`,
    `https://torrents-csv.com/service/search?q=${encodeURIComponent(q)}`
  ];

  const results = {};
  for (const url of urls) {
    try {
      const r = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 4000
      });
      results[url] = { status: r.status, len: r.data?.length || 0, isJson: typeof r.data === 'object' };
    } catch (e) {
      results[url] = { error: e.message, status: e.response?.status };
    }
  }

  res.json(results);
});

app.get('/debug-search', async (req, res) => {
  const q = req.query.q || 'Blair Williams';
  const tpbScraper = require('./scrapers/tpb');
  const x1337Scraper = require('./scrapers/1337x');
  const limeScraper = require('./scrapers/limetorrents');
  const rargbScraper = require('./scrapers/rargb');

  const out = {};
  try { out.tpb = await tpbScraper.search(q); } catch (e) { out.tpbError = e.message; }
  try { out.x1337 = await x1337Scraper.search(q); } catch (e) { out.x1337Error = e.message; }
  try { out.lime = await limeScraper.search(q); } catch (e) { out.limeError = e.message; }
  try { out.rargb = await rargbScraper.search(q); } catch (e) { out.rargbError = e.message; }

  res.json({
    query: q,
    counts: {
      tpb: out.tpb?.length || 0,
      x1337: out.x1337?.length || 0,
      lime: out.lime?.length || 0,
      rargb: out.rargb?.length || 0
    },
    samples: {
      tpb: out.tpb?.[0],
      x1337: out.x1337?.[0],
      lime: out.lime?.[0],
      rargb: out.rargb?.[0]
    },
    errors: {
      tpb: out.tpbError,
      x1337: out.x1337Error,
      lime: out.limeError,
      rargb: out.rargbError
    }
  });
});

app.get('/', (req, res) => res.redirect('/configure'));
app.get('/poster/:title.svg', (req, res) => {
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(placeholderPosterSvg(req.params.title));
});
app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'configure.html'));
});
app.get('/:config/configure', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'configure.html'));
});

// 2. Manifest endpoints
app.get('/manifest.json', (req, res) => {
  res.json(createManifest(DEFAULT_CONFIG));
});

app.get('/:config/manifest.json', (req, res) => {
  const config = decodeConfig(req.params.config);
  res.json(createManifest(config));
});

app.get('/:config/tube/manifest.json', (req, res) => {
  const config = decodeConfig(req.params.config);
  const manifest = createTubeHubManifest(config);
  if (!manifest) return res.status(404).json({ error: 'Select at least one TubeHub website.' });
  res.json(manifest);
});

app.get('/:config/tube/:site/manifest.json', (req, res) => {
  const config = decodeConfig(req.params.config);
  const manifest = createTubeSiteManifest(config, req.params.site);
  if (!manifest) return res.status(404).json({ error: 'Tube site is not enabled in this install link.' });
  res.json(manifest);
});

async function handleTubeSiteStreams(req, res, configStr, siteId) {
  const config = decodeConfig(configStr);
  if (!tubehub.TUBE_SITE_IDS.includes(siteId) || !(config.tubeSites || []).includes(siteId)) {
    return res.json({ streams: [] });
  }

  try {
    const { id } = req.params;
    const metadataId = parseMetadataSceneId(id);
    if (!metadataId) return res.json({ streams: [] });
    const records = await getMetadataSceneRecords(metadataId, config);
    const scene = records.find(record => record.provider === metadataId.source) || records[0];
    if (!scene) return res.json({ streams: [] });
    return res.json({ streams: await tubehub.searchForScene(scene, [siteId]) });
  } catch (error) {
    console.warn(`[TubeHub] ${siteId} stream lookup failed: ${error.message}`);
    return res.json({ streams: [] });
  }
}

app.get('/:config/tube/:site/stream/:type/:id.json', (req, res) =>
  handleTubeSiteStreams(req, res, req.params.config, req.params.site));

async function handleTubeHubStreams(req, res, configStr) {
  const config = decodeConfig(configStr);
  const selectedSites = (config.tubeSites || []).filter(site => tubehub.TUBE_SITE_IDS.includes(site));
  if (selectedSites.length === 0) return res.json({ streams: [] });

  try {
    const metadataId = parseMetadataSceneId(req.params.id);
    if (!metadataId) return res.json({ streams: [] });
    const records = await getMetadataSceneRecords(metadataId, config);
    const scene = records.find(record => record.provider === metadataId.source) || records[0];
    if (!scene) return res.json({ streams: [] });
    return res.json({ streams: await tubehub.searchForScene(scene, selectedSites) });
  } catch (error) {
    console.warn(`[TubeHub] combined stream lookup failed: ${error.message}`);
    return res.json({ streams: [] });
  }
}

app.get('/:config/tube/stream/:type/:id.json', (req, res) =>
  handleTubeHubStreams(req, res, req.params.config));

// 3. Catalog handler (searches across Movies, Series, and Other in Stremio/Nuvio)
async function handleCatalog(req, res, configStr) {
  const { type, id, extra } = req.params;
  const config = decodeConfig(configStr);
  const parsedExtra = parseCatalogExtra(req, extra);
  const metadataSource = metadataSourceForCatalogId(id);
  let searchQuery = req.query.search || parsedExtra.search || '';
  searchQuery = String(searchQuery || '').trim();

  if (!searchQuery) {
    if (metadataSource) {
      searchQuery = '';
    } else if (id === 'torrentz_xxx') {
      searchQuery = '1080p';
    } else {
      searchQuery = type === 'movie' ? '2024' : (type === 'series' ? 'S01E01' : '1080p');
    }
  }

  console.log(`[Catalog Search] Querying ${metadataSource || 'torrent'} catalog for: "${searchQuery}" (${type})`);

  const isAdult = type === 'other' || /xxx/i.test(id);
  const activeMetadataSources = metadataSource &&
    (config.metadataSources || []).includes(metadataSource) &&
    config.metadataApiKeys?.[metadataSource]
    ? [metadataSource]
    : [];
  const responseKey = catalogCacheKey(
    type,
    id,
    searchQuery,
    config.providers,
    activeMetadataSources,
    config.metadataApiKeys
  );
  const cachedMetas = cache.get(responseKey);
  if (cachedMetas) {
    return res.json({ metas: cachedMetas });
  }

  if (metadataSource && activeMetadataSources.length === 0) {
    return res.json({ metas: [] });
  }

  if (metadataSource) {
    try {
      const scenes = await stashbox.search(metadataSource, config.metadataApiKeys[metadataSource], searchQuery, 25);
      const metas = buildMetadataCatalogMetas(scenes, type, req).slice(0, 50);
      cache.set(responseKey, metas, metas.length > 0 ? CATALOG_TTL : EMPTY_CATALOG_TTL);
      return res.json({ metas });
    } catch (err) {
      console.error('[Metadata Catalog Error]', err.message);
      return res.json({ metas: [] });
    }
  }

  try {
    // Run Cinemeta and the scrapers together. Adult titles are very unlikely to
    // exist in Cinemeta, so skipping that lookup saves several seconds there.
    const [torrents, catalog] = await Promise.all([
      scrapers.searchAll(searchQuery, config.providers),
      isAdult ? Promise.resolve([]) : searchCatalog(type, searchQuery).catch(() => [])
    ]);

    const metas = buildCatalogMetas(torrents, type, catalog, req).slice(0, 50);
    cache.set(responseKey, metas, metas.length > 0 ? CATALOG_TTL : EMPTY_CATALOG_TTL);
    res.json({ metas });
  } catch (err) {
    console.error('[Catalog Error]', err.message);
    res.json({ metas: [] });
  }
}

app.get('/catalog/:type/:id.json', (req, res) => handleCatalog(req, res, ''));
app.get('/catalog/:type/:id/:extra.json', (req, res) => handleCatalog(req, res, ''));
app.get('/:config/catalog/:type/:id.json', (req, res) => handleCatalog(req, res, req.params.config));
app.get('/:config/catalog/:type/:id/:extra.json', (req, res) => handleCatalog(req, res, req.params.config));

// 4. Meta handler (for items clicked from the search results)
async function handleMeta(req, res, configStr) {
  const { type, id } = req.params;
  const metadataId = parseMetadataSceneId(id);

  if (metadataId) {
    const config = decodeConfig(configStr);
    const records = await getMetadataSceneRecords(metadataId, config);
    const scene = records.find(record => record.provider === metadataId.source) || records[0];
    if (!scene) return res.json({ meta: null });

    return res.json({
      meta: {
        id,
        type: type || 'movie',
        name: scene.title,
        poster: scene.poster || placeholderPosterUrl(req, scene.title),
        posterShape: 'poster',
        description: sceneDescription(scene, records.map(record => record.providerName)),
        ...(scene.date ? { releaseInfo: scene.date.slice(0, 10) } : {})
      }
    });
  }

  if (id.startsWith('torrentz-group:')) {
    const groupId = id.replace('torrentz-group:', '');
    const variants = cache.get(`torrent-group:${groupId}`) || [];
    const first = variants[0];
    const info = first ? getTitleInfo(first.rawTitle) : null;
    const decodedKey = decodeGroupId(groupId);
    const name = info?.label || groupKeyLabel(decodedKey);
    return res.json({
      meta: {
        id,
        type: type || 'movie',
        name,
        poster: first?.poster || placeholderPosterUrl(req, name),
        posterShape: 'poster',
        description: variants.length > 0
          ? `${variants.length} quality and size options`
          : 'Quality and size options'
      }
    });
  }

  if (id.startsWith('torrentz:')) {
    const infoHash = id.replace('torrentz:', '').toLowerCase();
    const cached = cache.get(`torrent:${infoHash}`);
    const info = cached ? getTitleInfo(cached.rawTitle) : null;

    const name = cached ? (info?.label || cached.rawTitle) : `Torrent ${infoHash.substring(0, 8)}`;
    const description = cached
      ? `👤 ${cached.seeders} seeders | 💾 ${formatSize(cached.sizeBytes)} | ⚙️ ${cached.source}`
      : `InfoHash: ${infoHash}`;

    return res.json({
      meta: {
        id,
        type: type || 'movie',
        name,
        poster: placeholderPosterUrl(req, name),
        posterShape: 'poster',
        description
      }
    });
  }

  res.json({ meta: null });
}

app.get('/meta/:type/:id.json', (req, res) => handleMeta(req, res, ''));
app.get('/:config/meta/:type/:id.json', (req, res) => handleMeta(req, res, req.params.config));

// 5. Stream handlers
async function handleStreams(req, res, configStr) {
  const { type, id } = req.params;
  const config = decodeConfig(configStr);

  try {
    let torrents = [];
    let metadataScene = null;
    let metadataMatchKind = 'title';

    // Case A: Stream requested from a Stash-Box catalog scene.
    const metadataId = parseMetadataSceneId(id);
    if (metadataId) {
      const records = await getMetadataSceneRecords(metadataId, config);
      metadataScene = records.find(record => record.provider === metadataId.source) || records[0] || null;
      if (!metadataScene) return res.json({ streams: [] });

      const candidates = metadataTorrentQueries(metadataScene);
      console.log(`[Stream] Searching torrent providers for metadata scene "${metadataScene.title}"`);

      for (const candidate of candidates) {
        const cacheKey = streamsCacheKey(
          'movie',
          `scene:${metadataScene.provider}:${candidate.matchKind}:${candidate.query}`,
          config.providers
        );
        const cached = cache.get(cacheKey);
        const candidateTorrents = cached || await scrapers.searchAll(candidate.query, config.providers, { timeoutMs: 5000 });
        if (!cached) cache.set(cacheKey, candidateTorrents, STREAM_TTL);

        torrents = candidateTorrents.filter(torrent => isMetadataTorrentRelevant(metadataScene, torrent));

        if (torrents.length > 0) {
          metadataMatchKind = candidate.matchKind;
          break;
        }
      }
    }
    // Case B: Stream requested from a grouped torrent catalog item.
    else if (id.startsWith('torrentz-group:')) {
      const groupId = id.replace('torrentz-group:', '');
      torrents = await getGroupTorrents(groupId, config);
    }
    // Case C: Stream requested from a single catalog item (legacy IDs).
    else if (id.startsWith('torrentz:')) {
      const hash = id.replace('torrentz:', '').toLowerCase();
      const cached = cache.get(`torrent:${hash}`);
      torrents = [{
        rawTitle: cached ? cached.rawTitle : `Torrent Stream ${hash.substring(0, 8)}`,
        infoHash: hash,
        sizeBytes: cached ? cached.sizeBytes : 0,
        seeders: cached ? cached.seeders : 1,
        source: cached ? cached.source : 'Indexer'
      }];
    }
    // Case D: Stream requested from IMDb/Cinemeta item (tt...)
    else {
      const meta = await getMetadata(type, id);
      if (!meta || !meta.name) {
        console.log(`[Stream] No metadata found for ${type}/${id}`);
        return res.json({ streams: [] });
      }

      const searchQuery = meta.searchQuery;
      console.log(`[Stream] Querying indexers for: "${searchQuery}" (${type})`);

      const cacheKey = streamsCacheKey(type, searchQuery, config.providers);
      torrents = cache.get(cacheKey);

      if (!torrents) {
        torrents = await scrapers.searchAll(searchQuery, config.providers);
        cache.set(cacheKey, torrents, STREAM_TTL);
      }
    }

    if (!torrents || torrents.length === 0) {
      return res.json({ streams: [] });
    }

    // Debrid check (memoized per provider + hash set)
    let cachedHashes = new Set();
    const hasDebrid = Boolean(config.debridProvider && config.debridApiKey);

    if (hasDebrid) {
      const hashes = [...new Set(torrents.map(t => String(t.infoHash).toLowerCase()))];
      const flagKey = debridFlagsCacheKey(config.debridProvider, hashes);

      cachedHashes = cache.get(flagKey);
      if (!cachedHashes) {
        cachedHashes = await debrid.checkCache(config.debridProvider, config.debridApiKey, hashes);
        cache.set(flagKey, cachedHashes, DEBRID_FLAGS_TTL);
      }
    }

    const formattedStreams = [];
    const host = req.get('host') || 'localhost';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocal ? req.protocol : 'https';

    // Only filter known resolutions; leave unparsed releases in place so an
    // unusually named release is not silently dropped.
    const allowedResolutions = new Set(
      (config.resolutions || DEFAULT_CONFIG.resolutions).map(normalizeResolution)
    );
    allowedResolutions.add('other');

    for (const torrent of torrents) {
      const titleInfo = getTitleInfo(torrent.rawTitle);
      const resolution = normalizeResolution(titleInfo.parsed.resolution);

      if (!allowedResolutions.has(resolution)) continue;

      const base = {
        rawTitle: torrent.rawTitle,
        infoHash: torrent.infoHash,
        sizeBytes: torrent.sizeBytes,
        seeders: torrent.seeders,
        source: torrent.source,
        displayTitle: metadataScene?.title || titleInfo.label,
        titleInfo
      };

      const isCached = cachedHashes.has(String(torrent.infoHash).toLowerCase());

      if (hasDebrid) {
        if (isCached) {
          const formatted = formatStream({
            ...base,
            debridCached: true,
            debridProvider: config.debridProvider.toUpperCase()
          });
          formatted.url = `${protocol}://${host}/playback/${encodeURIComponent(configStr)}/${torrent.infoHash}`;
          addTorrentSourceBadge(formatted, metadataScene ? metadataMatchKind : 'title');
          formattedStreams.push(formatted);
        } else if (config.showP2PFallback) {
          const formatted = formatStream(base);
          addTorrentSourceBadge(formatted, metadataScene ? metadataMatchKind : 'title');
          formattedStreams.push(formatted);
        }
      } else {
        const formatted = formatStream(base);
        addTorrentSourceBadge(formatted, metadataScene ? metadataMatchKind : 'title');
        formattedStreams.push(formatted);
      }
    }

    // Group same-title releases together, then cap each resolution.
    const ordered = orderStreams(formattedStreams, config.groupByTitle !== false);
    const maxPerRes = clamp(parseInt(config.maxStreamsPerResolution, 10) || 5, 1, 200);
    const counts = Object.create(null);
    const finalStreams = [];

    for (const stream of ordered) {
      const key = stream.resolution || 'other';
      if ((counts[key] || 0) >= maxPerRes) continue;
      counts[key] = (counts[key] || 0) + 1;
      finalStreams.push(toStremioStream(stream));
    }

    res.json({ streams: finalStreams });
  } catch (err) {
    console.error(`[Stream Error]`, err);
    res.json({ streams: [] });
  }
}

app.get('/stream/:type/:id.json', (req, res) => handleStreams(req, res, ''));
app.get('/:config/stream/:type/:id.json', (req, res) => handleStreams(req, res, req.params.config));

// 6. Playback resolver endpoint for Debrid streams
app.get('/playback/:config/:infoHash', async (req, res) => {
  const { config: configStr, infoHash } = req.params;
  const config = decodeConfig(configStr);

  if (!config.debridProvider || !config.debridApiKey) {
    return res.status(400).send('Debrid provider or API key is missing.');
  }

  try {
    const streamUrl = await debrid.resolveStream(config.debridProvider, config.debridApiKey, infoHash);
    if (streamUrl) {
      res.set('Cache-Control', 'private, max-age=300');
      return res.redirect(302, streamUrl);
    }
    res.status(404).send('Failed to generate direct debrid stream link.');
  } catch (err) {
    if (err.name === 'DebridPendingError') {
      const retryAfter = err.retryAfter || 5;
      res.set('Retry-After', String(retryAfter));
      return res.status(503).type('html').send(
        `<meta http-equiv="refresh" content="${retryAfter}">` +
        '<p>Torrent is still processing on your Debrid provider. Retrying…</p>'
      );
    }

    if (err.name === 'DebridError') {
      console.error(`[Playback Error] ${err.message}`);
      return res.status(502).send(`Playback resolution failed: ${err.message}`);
    }

    console.error(`[Playback Error]`, err.message);
    res.status(500).send(`Playback resolution failed: ${err.message}`);
  }
});

module.exports = app;
