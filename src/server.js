const express = require('express');
const cors = require('cors');
const path = require('path');
const { decodeConfig, DEFAULT_CONFIG } = require('./config');
const { getMetadata } = require('./metadata/cinemeta');
const { searchAll } = require('./scrapers');
const debrid = require('./debrid');
const { formatStream, formatSize } = require('./utils/parser');
const cache = require('./utils/cache');

const app = express();
app.use(cors());

// Manifest generator supporting split modes: 'movies', 'xxx', 'all'
function createManifest(config = DEFAULT_CONFIG) {
  const mode = config.mode || 'all';
  let id = 'community.torrentz.addon';
  let name = 'Torrentz';
  let description = 'High-speed torrent scraper for ThePirateBay, 1337x, LimeTorrents, and RARBG';
  let types = ['movie', 'series', 'other'];
  let catalogs = [];

  if (mode === 'movies') {
    id = 'community.torrentz.movies';
    name = 'Torrentz (Movies & TV)';
    description = 'Mainstream Movies & TV Series torrent streams with Debrid support';
    types = ['movie', 'series'];
    catalogs = [
      {
        type: 'movie',
        id: 'torrentz_movies',
        name: 'Torrentz Movies',
        extra: [{ name: 'search', isRequired: false }]
      },
      {
        type: 'series',
        id: 'torrentz_series',
        name: 'Torrentz Series',
        extra: [{ name: 'search', isRequired: false }]
      }
    ];
  } else if (mode === 'xxx' || mode === 'other') {
    id = 'community.torrentz.xxx';
    name = 'Torrentz XXX (Adult & Other)';
    description = 'Adult video & performer torrent scraper (Blair Williams, studio releases, etc.)';
    types = ['movie', 'other'];
    catalogs = [
      {
        type: 'movie',
        id: 'torrentz_xxx',
        name: 'Torrentz XXX',
        extra: [{ name: 'search', isRequired: false }]
      },
      {
        type: 'other',
        id: 'torrentz_other',
        name: 'Torrentz Other',
        extra: [{ name: 'search', isRequired: false }]
      }
    ];
  } else {
    // Mode = 'all'
    id = 'community.torrentz.addon';
    name = 'Torrentz (All-in-One)';
    description = 'Movies, TV series, adult performers & custom torrents';
    types = ['movie', 'series', 'other'];
    catalogs = [
      {
        type: 'movie',
        id: 'torrentz_movies',
        name: 'Torrentz Movies',
        extra: [{ name: 'search', isRequired: false }]
      },
      {
        type: 'series',
        id: 'torrentz_series',
        name: 'Torrentz Series',
        extra: [{ name: 'search', isRequired: false }]
      },
      {
        type: 'movie',
        id: 'torrentz_xxx',
        name: 'Torrentz XXX',
        extra: [{ name: 'search', isRequired: false }]
      }
    ];
  }

  if (config.debridProvider) {
    const prov = debrid.getProvider(config.debridProvider);
    name += ` [${prov ? prov.name : config.debridProvider.toUpperCase()}]`;
  }

  return {
    id,
    version: '1.0.2',
    name,
    description,
    resources: ['catalog', 'meta', 'stream'],
    types,
    idPrefixes: ['tt', 'torrentz:'],
    catalogs,
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}

// 1. Health check, debug & configuration UI
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

app.get('/test-raw-tpb', async (req, res) => {
  const axios = require('axios');
  const q = req.query.q || 'Blair Williams';
  try {
    const r = await axios.get(`https://apibay.org/q.php?q=${encodeURIComponent(q)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      timeout: 8000
    });
    res.json({
      status: r.status,
      headers: r.headers,
      dataType: typeof r.data,
      isArray: Array.isArray(r.data),
      length: r.data?.length,
      sample: r.data?.[0],
      raw: r.data
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
      status: err.response?.status,
      data: err.response?.data
    });
  }
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

  let searchQuery = req.query.search || '';
  if (!searchQuery && extra) {
    const match = extra.match(/search=([^&]+)/);
    if (match) {
      searchQuery = decodeURIComponent(match[1]);
    }
  }

  if (!searchQuery) {
    if (id === 'torrentz_xxx') {
      searchQuery = '1080p';
    } else {
      searchQuery = type === 'movie' ? '2024' : (type === 'series' ? 'S01E01' : '1080p');
    }
  }

  console.log(`[Catalog Search] Querying torrents for: "${searchQuery}" (${type})`);
  try {
    const torrents = await searchAll(searchQuery, config.providers);
    const metas = torrents.slice(0, 50).map(t => {
      // Store into cache for meta and stream lookup
      cache.set(`torrent:${t.infoHash}`, t, 24 * 60 * 60 * 1000);

      return {
        id: `torrentz:${t.infoHash}`,
        type: type || 'movie',
        name: t.rawTitle,
        poster: 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=400&auto=format&fit=crop&q=60',
        posterShape: 'poster',
        description: `👤 ${t.seeders} seeders | 💾 ${formatSize(t.sizeBytes)} | ⚙️ ${t.source}`
      };
    });

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

    const name = cached ? cached.rawTitle : `Torrent ${infoHash.substring(0, 8)}`;
    const description = cached 
      ? `👤 ${cached.seeders} seeders | 💾 ${formatSize(cached.sizeBytes)} | ⚙️ ${cached.source}`
      : `InfoHash: ${infoHash}`;

    return res.json({
      meta: {
        id,
        type: type || 'movie',
        name,
        poster: 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=400&auto=format&fit=crop&q=60',
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

      const cacheKey = `streams:${searchQuery}`;
      torrents = cache.get(cacheKey);

      if (!torrents) {
        torrents = await searchAll(searchQuery, config.providers);
        cache.set(cacheKey, torrents, 15 * 60 * 1000);
      }
    }

    if (!torrents || torrents.length === 0) {
      return res.json({ streams: [] });
    }

    // Debrid check
    let cachedHashes = new Set();
    const hasDebrid = Boolean(config.debridProvider && config.debridApiKey);

    if (hasDebrid) {
      const hashes = torrents.map(t => t.infoHash);
      cachedHashes = await debrid.checkCache(config.debridProvider, config.debridApiKey, hashes);
    }

    const formattedStreams = [];
    const host = req.get('host');
    const protocol = req.protocol;

    for (const torrent of torrents) {
      const isCached = cachedHashes.has(torrent.infoHash.toLowerCase());

      if (hasDebrid) {
        if (isCached) {
          const playbackUrl = `${protocol}://${host}/playback/${encodeURIComponent(configStr)}/${torrent.infoHash}`;
          const formatted = formatStream({
            rawTitle: torrent.rawTitle,
            infoHash: torrent.infoHash,
            sizeBytes: torrent.sizeBytes,
            seeders: torrent.seeders,
            source: torrent.source,
            debridCached: true,
            debridProvider: config.debridProvider.toUpperCase()
          });

          formattedStreams.push({
            name: formatted.name,
            title: formatted.title,
            url: playbackUrl,
            resolution: formatted.resolution,
            seeders: formatted.seeders
          });
        } else if (config.showP2PFallback) {
          const formatted = formatStream({
            rawTitle: torrent.rawTitle,
            infoHash: torrent.infoHash,
            sizeBytes: torrent.sizeBytes,
            seeders: torrent.seeders,
            source: torrent.source
          });

          formattedStreams.push({
            name: formatted.name,
            title: formatted.title,
            infoHash: formatted.infoHash,
            resolution: formatted.resolution,
            seeders: formatted.seeders
          });
        }
      } else {
        const formatted = formatStream({
          rawTitle: torrent.rawTitle,
          infoHash: torrent.infoHash,
          sizeBytes: torrent.sizeBytes,
          seeders: torrent.seeders,
          source: torrent.source
        });

        formattedStreams.push({
          name: formatted.name,
          title: formatted.title,
          infoHash: formatted.infoHash,
          resolution: formatted.resolution,
          seeders: formatted.seeders
        });
      }
    }

    const maxPerRes = config.maxStreamsPerResolution || 5;
    const grouped = {};
    const finalStreams = [];

    for (const stream of formattedStreams) {
      const resKey = stream.resolution || 'other';
      grouped[resKey] = grouped[resKey] || 0;
      if (grouped[resKey] < maxPerRes) {
        grouped[resKey]++;
        finalStreams.push(stream);
      }
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
      return res.redirect(302, streamUrl);
    }
    res.status(404).send('Failed to generate direct debrid stream link.');
  } catch (err) {
    console.error(`[Playback Error]`, err.message);
    res.status(500).send(`Playback resolution failed: ${err.message}`);
  }
});

module.exports = app;
