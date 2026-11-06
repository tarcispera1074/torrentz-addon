const express = require('express');
const cors = require('cors');
const path = require('path');
const { decodeConfig, DEFAULT_CONFIG } = require('./config');
const { getMetadata, searchCatalog, normalizeTitle } = require('./metadata/cinemeta');
const scrapers = require('./scrapers');
const debrid = require('./debrid');
const {
  formatStream,
  formatSize,
  getTitleInfo,
  normalizeResolution
} = require('./utils/parser');
const { streamsCacheKey, debridFlagsCacheKey } = require('./utils/cacheKeys');
const { createManifest } = require('./manifest');
const cache = require('./utils/cache');

const app = express();
app.set('trust proxy', true);
app.use(cors());

const CATALOG_TORRENT_TTL = 24 * 60 * 60 * 1000;
const STREAM_TTL = 15 * 60 * 1000;
const DEBRID_FLAGS_TTL = 10 * 60 * 1000;

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
  const host = req.get('host') || 'localhost';
  const protocol = host.includes('localhost') || host.includes('127.0.0.1') ? req.protocol : 'https';
  return `${protocol}://${host}/poster/${encodeURIComponent(String(title || 'Torrentz').slice(0, 120))}.svg`;
}

/**
 * Enrich scraped torrents with real Cinemeta posters when a title matches.
 */
async function buildCatalogMetas(torrents, type, searchQuery, req) {
  let catalog = [];
  if (type === 'movie' || type === 'series') {
    catalog = await searchCatalog(type, searchQuery);
  }

  const byKey = new Map();
  for (const meta of catalog) {
    if (!meta || !meta.name) continue;
    const withYear = posterKey(meta.name, meta.releaseInfo || meta.year);
    const withoutYear = posterKey(meta.name, '');
    if (!byKey.has(withYear)) byKey.set(withYear, meta);
    if (!byKey.has(withoutYear)) byKey.set(withoutYear, meta);
  }

  return torrents.map(torrent => {
    const info = getTitleInfo(torrent.rawTitle);
    const hit = byKey.get(posterKey(info.title, info.year)) || byKey.get(posterKey(info.title, ''));

    // Store into cache for meta and stream lookup
    cache.set(`torrent:${torrent.infoHash}`, torrent, CATALOG_TORRENT_TTL);

    const meta = {
      id: `torrentz:${torrent.infoHash}`,
      type: type || 'movie',
      name: info.label || torrent.rawTitle,
      poster: hit?.poster || torrent.poster || placeholderPosterUrl(req, info.label || torrent.rawTitle),
      posterShape: 'poster',
      description: `👤 ${torrent.seeders} seeders | 💾 ${formatSize(torrent.sizeBytes)} | ⚙️ ${torrent.source}`
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

// 3. Catalog handler (searches across Movies, Series, and Other in Stremio/Nuvio)
async function handleCatalog(req, res, configStr) {
  const { type, id, extra } = req.params;
  const config = decodeConfig(configStr);
  const parsedExtra = parseCatalogExtra(req, extra);

  let searchQuery = req.query.search || parsedExtra.search || '';
  searchQuery = String(searchQuery || '').trim();

  if (!searchQuery) {
    if (id === 'torrentz_xxx') {
      searchQuery = '1080p';
    } else {
      searchQuery = type === 'movie' ? '2024' : (type === 'series' ? 'S01E01' : '1080p');
    }
  }

  console.log(`[Catalog Search] Querying torrents for: "${searchQuery}" (${type})`);
  try {
    const torrents = await scrapers.searchAll(searchQuery, config.providers);
    const metas = await buildCatalogMetas(torrents.slice(0, 50), type, searchQuery, req);
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

    // Case A: Stream requested from Catalog item (torrentz:{infoHash})
    if (id.startsWith('torrentz:')) {
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
    // Case B: Stream requested from IMDb/Cinemeta item (tt...)
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
        displayTitle: titleInfo.label,
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
          formattedStreams.push(formatted);
        } else if (config.showP2PFallback) {
          formattedStreams.push(formatStream(base));
        }
      } else {
        formattedStreams.push(formatStream(base));
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
