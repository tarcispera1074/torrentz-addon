const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../../src/server');
const cache = require('../../src/utils/cache');
const { DEFAULT_CONFIG, encodeConfig } = require('../../src/config');
const { streamsCacheKey } = require('../../src/utils/cacheKeys');
const scrapers = require('../../src/scrapers');
const debrid = require('../../src/debrid');
const stashbox = require('../../src/metadata/stashbox');

const HASH_1080 = 'a'.repeat(40);
const HASH_720 = 'b'.repeat(40);
const HASH_1080_WEB = 'c'.repeat(40);
const HASH_INTERSTELLAR = 'd'.repeat(40);

const TORRENTS = [
  {
    rawTitle: 'Inception.2010.1080p.BluRay.x264-GRP',
    infoHash: HASH_1080,
    sizeBytes: 2.4 * 1024 * 1024 * 1024,
    seeders: 100,
    source: '1337x'
  },
  {
    rawTitle: 'Inception.2010.720p.BluRay.x264-GRP',
    infoHash: HASH_720,
    sizeBytes: 900 * 1024 * 1024,
    seeders: 90,
    source: '1337x'
  },
  {
    rawTitle: 'Inception.2010.1080p.WEB-DL.x265-OTHER',
    infoHash: HASH_1080_WEB,
    sizeBytes: 1.5 * 1024 * 1024 * 1024,
    seeders: 80,
    source: 'tpb'
  },
  {
    rawTitle: 'Interstellar.2014.1080p.BluRay.x264-GRP',
    infoHash: HASH_INTERSTELLAR,
    sizeBytes: 3 * 1024 * 1024 * 1024,
    seeders: 200,
    source: 'tpb'
  }
];

let server;
let baseUrl;

before(async () => {
  cache.clear();
  cache.set('meta:movie:tt1375666', { name: 'Inception', year: '2010' }, 60_000);
  cache.set(
    streamsCacheKey('movie', 'Inception 2010', DEFAULT_CONFIG.providers),
    TORRENTS,
    60_000
  );

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.json() };
}

test('serves the dynamic manifest with the shared version', async () => {
  const { status, body } = await getJson('/manifest.json');

  assert.equal(status, 200);
  assert.equal(body.version, '1.3.4');
  assert.equal(body.id, 'community.torrentz.addon');
  assert.deepEqual(body.resources, ['catalog', 'meta', 'stream']);
  assert.deepEqual(body.types, ['movie']);
  assert.ok(body.idPrefixes.includes('torrentz-group:'));
  for (const prefix of ['tpdb-scene:', 'stashdb-scene:', 'javstash-scene:', 'pmvstash-scene:', 'fansdb-scene:']) {
    assert.ok(body.idPrefixes.includes(prefix));
  }
});

test('configuration page exposes both provider actions and the manifest URL', async () => {
  const response = await fetch(`${baseUrl}/configure`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Select all/);
  assert.match(html, /Deselect all/);
  assert.match(html, /id="manifestUrl"/);
  for (const source of ['tpdb', 'stashdb', 'javstash', 'pmvstash', 'fansdb']) {
    assert.match(html, new RegExp(`metadata-key-${source}`));
    assert.match(html, new RegExp(`metadata-source-${source}`));
    assert.match(html, new RegExp(`metadata-test-${source}`));
  }
  assert.match(html, /Adult Metadata Catalogs/);
  assert.match(html, /Base64 is not encryption/);
});

test('configured Stash-Box sources add independent named catalogs to the manifest', async () => {
  const config = encodeConfig({
    metadataSources: ['tpdb', 'stashdb'],
    metadataApiKeys: { tpdb: 'read-token', stashdb: 'read-token-2' }
  });
  const { status, body } = await getJson(`/${config}/manifest.json`);

  assert.equal(status, 200);
  assert.deepEqual(body.catalogs.map(catalog => catalog.name), ['Torrentz: PornDB', 'Torrentz: StashDB']);
  assert.deepEqual(body.catalogs.map(catalog => catalog.id), ['torrentz_tpdb', 'torrentz_stashdb']);
  assert.ok(body.idPrefixes.includes('tpdb-scene:'));
  assert.ok(body.idPrefixes.includes('fansdb-scene:'));
});

test('metadata API key test endpoint validates a key without returning it', async () => {
  const original = stashbox.checkApiKey;
  stashbox.checkApiKey = async (source, apiKey) => ({
    valid: source === 'tpdb' && apiKey === 'test-token',
    message: 'API key works; read access confirmed.'
  });

  try {
    const response = await fetch(`${baseUrl}/metadata/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'tpdb', apiKey: 'test-token' })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.valid, true);
    assert.equal(JSON.stringify(body).includes('test-token'), false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    stashbox.checkApiKey = original;
  }
});

test('groups same-title releases and orders them by quality', async () => {
  const { body } = await getJson('/stream/movie/tt1375666.json');
  const { streams } = body;

  assert.equal(streams.length, 4);

  // Groups are ordered by their best seeder count: Interstellar, then Inception.
  assert.ok(streams[0].title.startsWith('Interstellar (2014)'));
  assert.ok(streams[1].title.startsWith('Inception (2010)'));

  const inceptionIndexes = streams
    .map((stream, index) => (stream.title.startsWith('Inception (2010)') ? index : -1))
    .filter(index => index >= 0);
  assert.deepEqual(inceptionIndexes, [1, 2, 3]);

  // Cached-first, then 1080p, then 720p.
  assert.equal(streams[1].name, '[P2P] 1080p');
  assert.equal(streams[2].name, '[P2P] 1080p');
  assert.equal(streams[3].name, '[P2P] 720p');

  // Quality variants share the same first line, which is what makes them read
  // as one title with multiple options in the client.
  assert.ok(streams[1].title.startsWith('Inception (2010)\n'));
  assert.ok(streams[3].title.startsWith('Inception (2010)\n'));
  assert.equal(streams[1].behaviorHints.filename, 'Inception.2010.1080p.BluRay.x264-GRP');
});

test('grouping can be disabled through the config segment', async () => {
  const config = encodeConfig({ groupByTitle: false });
  const { body } = await getJson(`/${config}/stream/movie/tt1375666.json`);
  const { streams } = body;

  assert.equal(streams.length, 4);
  assert.ok(streams[0].title.startsWith('Interstellar (2014)'));
  assert.equal(streams[1].name, '[P2P] 1080p');
  assert.equal(streams[2].name, '[P2P] 720p');
});

test('resolution selection filters lower qualities', async () => {
  const config = encodeConfig({ resolutions: ['1080p'] });
  const { body } = await getJson(`/${config}/stream/movie/tt1375666.json`);

  assert.equal(body.streams.length, 3);
  assert.ok(body.streams.every(stream => stream.name === '[P2P] 1080p'));
});

test('Debrid-cached hashes become playback URLs with a cached badge', async () => {
  const original = debrid.checkCache;
  debrid.checkCache = async () => new Set([HASH_1080]);

  try {
    const config = encodeConfig({ debridProvider: 'torbox', debridApiKey: 'test-key' });
    const { body } = await getJson(`/${config}/stream/movie/tt1375666.json`);

    const cached = body.streams.find(stream => stream.name === '[TORBOX+] 1080p');
    assert.ok(cached, 'expected a TorBox cached stream');
    assert.match(cached.url, /\/playback\/.+\/a{40}$/);
    assert.equal(cached.infoHash, undefined);

    const p2p = body.streams.find(stream => stream.name === '[P2P] 720p');
    assert.ok(p2p);
    assert.ok(p2p.infoHash);
  } finally {
    debrid.checkCache = original;
  }
});

test('playback endpoint rejects requests without Debrid configured', async () => {
  const response = await fetch(`${baseUrl}/playback/abc/${HASH_1080}`);
  assert.equal(response.status, 400);
});

test('catalog uses real Cinemeta posters and an SVG fallback', async () => {
  cache.set('catalog:movie:inception', [
    {
      name: 'Inception',
      releaseInfo: '2010',
      poster: 'https://img.example/inception.jpg',
      background: 'https://img.example/inception-bg.jpg'
    }
  ], 60_000);

  const original = scrapers.searchAll;
  scrapers.searchAll = async () => ([
    {
      rawTitle: 'Inception.2010.1080p.BluRay.x264-GRP',
      infoHash: 'e'.repeat(40),
      sizeBytes: 1024,
      seeders: 5,
      source: '1337x'
    },
    {
      rawTitle: 'Inception.2010.720p.WEB-DL.x264-OTHER',
      infoHash: 'g'.repeat(40),
      sizeBytes: 512,
      seeders: 4,
      source: 'tpb'
    },
    {
      rawTitle: 'Unknown.Movie.2024.1080p.WEB-DL.x264-OTHER',
      infoHash: 'f'.repeat(40),
      sizeBytes: 2048,
      seeders: 4,
      source: 'tpb'
    }
  ]);

  try {
    const { body } = await getJson('/catalog/movie/torrentz_movies/search=Inception.json');

    assert.equal(body.metas.length, 2);
    assert.equal(body.metas[0].name, 'Inception (2010)');
    assert.equal(body.metas[0].poster, 'https://img.example/inception.jpg');
    assert.equal(body.metas[0].background, 'https://img.example/inception-bg.jpg');
    assert.equal(body.metas[0].releaseInfo, '2010');
    assert.match(body.metas[0].id, /^torrentz-group:/);
    assert.match(body.metas[0].description, /2 quality options/);

    const groupedStreams = await getJson(`/stream/movie/${encodeURIComponent(body.metas[0].id)}.json`);
    assert.equal(groupedStreams.body.streams.length, 2);
    assert.deepEqual(
      groupedStreams.body.streams.map(stream => stream.name),
      ['[P2P] 1080p', '[P2P] 720p']
    );

    assert.match(body.metas[1].poster, /^https:\/\/placehold\.co\/300x450\/.*\.png\?text=/);
  } finally {
    scrapers.searchAll = original;
  }
});

test('catalog search decodes an ampersand in the title exactly once', async () => {
  const original = scrapers.searchAll;
  let seenQuery = null;
  scrapers.searchAll = async (query) => {
    seenQuery = query;
    return [];
  };

  try {
    await getJson('/catalog/movie/torrentz_movies/search=Fast%20%26%20Furious.json');
    assert.equal(seenQuery, 'Fast & Furious');
  } finally {
    scrapers.searchAll = original;
  }
});

test('catalog responses are cached between client refreshes', async () => {
  const original = scrapers.searchAll;
  let calls = 0;
  scrapers.searchAll = async () => {
    calls += 1;
    return [{
      rawTitle: 'Cache Test 2024 1080p',
      infoHash: 'h'.repeat(40),
      sizeBytes: 1024,
      seeders: 4,
      source: 'tpb'
    }];
  };

  try {
    const first = await getJson('/catalog/movie/torrentz_xxx/search=Cache%20Test.json');
    const second = await getJson('/catalog/movie/torrentz_xxx/search=Cache%20Test.json');

    assert.equal(calls, 1);
    assert.equal(first.body.metas.length, 1);
    assert.deepEqual(second.body.metas, first.body.metas);
  } finally {
    scrapers.searchAll = original;
  }
});

test('grouped IDs still resolve after an in-memory cache reset', async () => {
  const original = scrapers.searchAll;
  const groupId = Buffer.from('blacked blair williams in the moment|||').toString('base64url');

  scrapers.searchAll = async () => ([
    {
      rawTitle: 'Blacked - Blair Williams - In The Moment 1080p',
      infoHash: 'i'.repeat(40),
      sizeBytes: 2048,
      seeders: 10,
      source: 'tpb'
    },
    {
      rawTitle: 'Blacked - Blair Williams - In The Moment 720p',
      infoHash: 'j'.repeat(40),
      sizeBytes: 1024,
      seeders: 5,
      source: 'tpb'
    }
  ]);

  try {
    const { status, body } = await getJson(`/stream/movie/${encodeURIComponent(`torrentz-group:${groupId}`)}.json`);

    assert.equal(status, 200);
    assert.equal(body.streams.length, 2);
    assert.deepEqual(body.streams.map(stream => stream.name), ['[P2P] 1080p', '[P2P] 720p']);
  } finally {
    scrapers.searchAll = original;
  }
});

test('metadata catalogs search independently and route matching torrents with source labels', async () => {
  const originalSearch = stashbox.search;
  const originalScrape = scrapers.searchAll;
  const query = 'Blair Williams';
  const searchedSources = [];
  const torrentQueries = [];
  const config = encodeConfig({
    providers: ['tpb', '1337x'],
    metadataSources: ['tpdb', 'stashdb'],
    metadataApiKeys: { tpdb: 'tpdb-test-key', stashdb: 'stashdb-test-key' }
  });

  stashbox.search = async source => {
    searchedSources.push(source);
    return [{
      id: `${source}-scene-42`,
      provider: source,
      providerName: source === 'tpdb' ? 'ThePornDB' : 'StashDB',
      title: 'Blair Williams Gets Banged By Her Stepfather',
      date: '2025-02-03',
      code: 'blair-williams-gets-banged-by-her-stepfather',
      studio: 'Example Studio',
      performers: [],
      poster: source === 'tpdb' ? 'https://images.example/scene.jpg' : 'https://images.example/duplicate.jpg',
      urls: []
    }];
  };
  scrapers.searchAll = async searchQuery => {
    torrentQueries.push(searchQuery);
    if (searchQuery === 'Blair Williams Gets Banged By Her Stepfather') return [];
    assert.equal(searchQuery, 'Blair Williams');
    return [
      {
        rawTitle: 'Blair.Williams.1080p.WEB-DL',
        infoHash: 'k'.repeat(40),
        sizeBytes: 2 * 1024 * 1024 * 1024,
        seeders: 30,
        source: 'ThePirateBay'
      },
      {
        rawTitle: 'Blair.Williams.720p.WEB-DL',
        infoHash: 'l'.repeat(40),
        sizeBytes: 800 * 1024 * 1024,
        seeders: 20,
        source: '1337x'
      }
    ];
  };

  try {
    const catalog = await getJson(`/${config}/catalog/movie/torrentz_tpdb/search=${encodeURIComponent(query)}.json`);
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.metas.length, 1);
    const [meta] = catalog.body.metas;
    assert.match(meta.id, /^tpdb-scene:/);
    assert.equal(meta.poster, 'https://images.example/scene.jpg');
    assert.match(meta.description, /Metadata: ThePornDB/);
    assert.deepEqual(searchedSources, ['tpdb'], 'a TPDB catalog must not query the other metadata sources');

    const stashdbCatalog = await getJson(`/${config}/catalog/movie/torrentz_stashdb/search=${encodeURIComponent(query)}.json`);
    assert.equal(stashdbCatalog.body.metas.length, 1);
    assert.match(stashdbCatalog.body.metas[0].id, /^stashdb-scene:/);
    assert.equal(stashdbCatalog.body.metas[0].poster, 'https://images.example/duplicate.jpg');
    assert.deepEqual(searchedSources, ['tpdb', 'stashdb']);

    const detail = await getJson(`/${config}/meta/movie/${encodeURIComponent(meta.id)}.json`);
    assert.equal(detail.body.meta.name, 'Blair Williams Gets Banged By Her Stepfather');

    const streams = await getJson(`/${config}/stream/movie/${encodeURIComponent(meta.id)}.json`);
    assert.equal(streams.body.streams.length, 2);
    assert.match(streams.body.streams[0].name, /\[ThePirateBay\]/);
    assert.match(streams.body.streams[1].name, /\[1337x\]/);
    assert.ok(streams.body.streams.every(stream => stream.name.includes('[Title keyword match]')));
    assert.ok(streams.body.streams.every(stream => stream.title.includes('Title keyword match only')));
    assert.deepEqual(torrentQueries, ['Blair Williams Gets Banged By Her Stepfather', 'Blair Williams']);
    assert.ok(streams.body.streams.every(stream => stream.title.startsWith('Blair Williams Gets Banged By Her Stepfather')));
  } finally {
    stashbox.search = originalSearch;
    scrapers.searchAll = originalScrape;
  }
});
