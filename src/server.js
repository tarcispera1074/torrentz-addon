const express = require('express');
const cors = require('cors');
const path = require('path');
const { decodeConfig, DEFAULT_CONFIG } = require('./config');
const { getMetadata } = require('./metadata/cinemeta');
const { searchAll } = require('./scrapers');
const debrid = require('./debrid');
const { formatStream } = require('./utils/parser');
const cache = require('./utils/cache');

const app = express();
app.use(cors());

// Manifest template
function createManifest(config = DEFAULT_CONFIG) {
  let name = 'Torrentz';
  let description = 'High-speed torrent scraper for ThePirateBay, 1337x, LimeTorrents, and RARBG';

  if (config.debridProvider) {
    const prov = debrid.getProvider(config.debridProvider);
    name += ` [${prov ? prov.name : config.debridProvider.toUpperCase()}]`;
    description += ` with ${prov ? prov.name : config.debridProvider} Debrid support`;
  }

  return {
    id: 'community.torrentz.addon',
    version: '1.0.0',
    name,
    description,
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}

// 1. Web configuration pages and health check
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));
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

// 3. Stream handlers
async function handleStreams(req, res, configStr) {
  const { type, id } = req.params;
  const config = decodeConfig(configStr);

  try {
    // 1. Resolve Cinemeta metadata (IMDb ID -> Title + Season/Episode)
    const meta = await getMetadata(type, id);
    if (!meta || !meta.name) {
      console.log(`[Stream] No metadata found for ${type}/${id}`);
      return res.json({ streams: [] });
    }

    const searchQuery = meta.searchQuery;
    console.log(`[Stream] Querying indexers for: "${searchQuery}" (${type})`);

    // 2. Search cached streams or scrape indexers
    const cacheKey = `streams:${searchQuery}`;
    let torrents = cache.get(cacheKey);

    if (!torrents) {
      torrents = await searchAll(searchQuery, config.providers);
      cache.set(cacheKey, torrents, 15 * 60 * 1000); // Cache search for 15 mins
    }

    if (!torrents || torrents.length === 0) {
      console.log(`[Stream] No torrents found for "${searchQuery}"`);
      return res.json({ streams: [] });
    }

    // 3. Debrid instant availability check
    let cachedHashes = new Set();
    const hasDebrid = Boolean(config.debridProvider && config.debridApiKey);

    if (hasDebrid) {
      const hashes = torrents.map(t => t.infoHash);
      cachedHashes = await debrid.checkCache(config.debridProvider, config.debridApiKey, hashes);
      console.log(`[Debrid] ${cachedHashes.size} out of ${hashes.length} torrents cached on ${config.debridProvider}`);
    }

    // 4. Format streams for Stremio
    const formattedStreams = [];
    const host = req.get('host');
    const protocol = req.protocol;

    for (const torrent of torrents) {
      const isCached = cachedHashes.has(torrent.infoHash.toLowerCase());

      // If user has Debrid configured
      if (hasDebrid) {
        if (isCached) {
          // Provide playback resolution link
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
          // Uncached torrent: offer as P2P fallback
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
        // Pure P2P stream
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

    // 5. Group and limit by resolution
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

// 4. Playback resolver endpoint for Debrid streams
app.get('/playback/:config/:infoHash', async (req, res) => {
  const { config: configStr, infoHash } = req.params;
  const config = decodeConfig(configStr);

  if (!config.debridProvider || !config.debridApiKey) {
    return res.status(400).send('Debrid provider or API key is missing.');
  }

  try {
    console.log(`[Playback] Resolving stream for hash ${infoHash} with ${config.debridProvider}`);
    const streamUrl = await debrid.resolveStream(config.debridProvider, config.debridApiKey, infoHash);

    if (streamUrl) {
      // 302 Redirect directly to CDN video URL
      return res.redirect(302, streamUrl);
    }

    res.status(404).send('Failed to generate direct debrid stream link.');
  } catch (err) {
    console.error(`[Playback Error]`, err.message);
    res.status(500).send(`Playback resolution failed: ${err.message}`);
  }
});

module.exports = app;
