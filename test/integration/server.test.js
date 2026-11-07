const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../../src/server');
const cache = require('../../src/utils/cache');
const { DEFAULT_CONFIG, encodeConfig } = require('../../src/config');
const { streamsCacheKey } = require('../../src/utils/cacheKeys');
const scrapers = require('../../src/scrapers');
const debrid = require('../../src/debrid');

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
  assert.equal(body.version, '1.1.0');
  assert.equal(body.id, 'community.torrentz.addon');
  assert.deepEqual(body.resources, ['catalog', 'meta', 'stream']);
  assert.ok(body.idPrefixes.includes('torrentz-group:'));
});

test('configuration page exposes both provider actions and the manifest URL', async () => {
  const response = await fetch(`${baseUrl}/configure`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Select all/);
  assert.match(html, /Deselect all/);
  assert.match(html, /id="manifestUrl"/);
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
