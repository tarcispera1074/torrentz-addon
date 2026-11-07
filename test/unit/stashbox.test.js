const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installAdapter } = require('../helpers/mockHttp');
const cache = require('../../src/utils/cache');
const stashbox = require('../../src/metadata/stashbox');

test('registers all five Stash-Box sources with their GraphQL endpoints', () => {
  assert.deepEqual(Object.keys(stashbox.SOURCES), ['tpdb', 'stashdb', 'javstash', 'pmvstash', 'fansdb']);
  for (const source of Object.values(stashbox.SOURCES)) {
    assert.match(source.endpoint, /\/graphql$/);
  }
});

test('search sends the Stash-Box API key and normalizes scene metadata', async () => {
  cache.clear();
  let seenApiKey;
  let seenQuery;
  const restore = installAdapter(config => {
    seenApiKey = config.headers?.get?.('ApiKey') || config.headers?.ApiKey;
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    seenQuery = body.query;
    return {
      data: {
        data: {
          searchScenes: {
            scenes: [{
              id: 'scene-1',
              title: 'An example scene',
              date: '2025-06-01',
              code: 'ABC-001',
              studio: { name: 'Studio' },
              performers: [{ performer: { name: 'Performer' }, as: null }],
              images: [{ url: 'https://images.example/poster.jpg' }],
              urls: [{ url: 'https://site.example/scene' }]
            }]
          }
        }
      }
    };
  });

  try {
    const scenes = await stashbox.search('stashdb', 'read-token', 'example scene');
    assert.equal(seenApiKey, 'read-token');
    assert.match(seenQuery, /searchScenes/);
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].providerName, 'StashDB');
    assert.equal(scenes[0].title, 'An example scene');
    assert.equal(scenes[0].studio, 'Studio');
    assert.deepEqual(scenes[0].performers, ['Performer']);
    assert.equal(scenes[0].poster, 'https://images.example/poster.jpg');
    assert.deepEqual(scenes[0].urls, ['https://site.example/scene']);
  } finally {
    restore();
    cache.clear();
  }
});

test('falls back to the legacy singular scene search field on older instances', async () => {
  cache.clear();
  const queries = [];
  const restore = installAdapter(config => {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    queries.push(body.query);
    if (body.query.includes('searchScenes')) {
      return { data: { errors: [{ message: 'Cannot query field "searchScenes"' }] } };
    }
    return { data: { data: { searchScene: [{ id: 'legacy-1', title: 'Legacy scene' }] } } };
  });

  try {
    const scenes = await stashbox.search('javstash', 'read-token', 'legacy scene');
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].id, 'legacy-1');
    assert.equal(queries.length, 2);
    assert.match(queries[1], /searchScene\(/);
  } finally {
    restore();
    cache.clear();
  }
});

test('empty catalog searches browse recent scenes instead of querying a placeholder term', async () => {
  cache.clear();
  let seenQuery;
  const restore = installAdapter(config => {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    seenQuery = body.query;
    return { data: { data: { queryScenes: { scenes: [{ id: 'recent-1', title: 'Recent scene' }] } } } };
  });

  try {
    const scenes = await stashbox.search('pmvstash', 'read-token', '');
    assert.match(seenQuery, /queryScenes/);
    assert.equal(scenes[0].title, 'Recent scene');
  } finally {
    restore();
    cache.clear();
  }
});

test('findScene loads a scene by source-specific ID', async () => {
  cache.clear();
  const restore = installAdapter(config => {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    assert.match(body.query, /findScene\(id:/);
    assert.equal(body.variables.id, 'lookup-7');
    return { data: { data: { findScene: { id: 'lookup-7', title: 'Found scene' } } } };
  });

  try {
    const scene = await stashbox.getScene('fansdb', 'read-token', 'lookup-7');
    assert.equal(scene.title, 'Found scene');
    assert.equal(scene.providerName, 'FansDB');
  } finally {
    restore();
    cache.clear();
  }
});

test('checkApiKey uses a minimal read-only scene query and never caches the result', async () => {
  let seenApiKey;
  const restore = installAdapter(config => {
    seenApiKey = config.headers?.get?.('ApiKey') || config.headers?.ApiKey;
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    assert.match(body.query, /searchScenes/);
    assert.equal(body.variables.limit, 1);
    return { data: { data: { searchScenes: { scenes: [] } } } };
  });

  try {
    const result = await stashbox.checkApiKey('tpdb', 'read-only-token');
    assert.deepEqual(result, { valid: true, message: 'API key works; read access confirmed.' });
    assert.equal(seenApiKey, 'read-only-token');
  } finally {
    restore();
  }
});

test('checkApiKey rejects GraphQL authentication errors returned with HTTP 200', async () => {
  const restore = installAdapter(() => ({
    data: { errors: [{ message: 'Authentication required: invalid API key' }] }
  }));

  try {
    const result = await stashbox.checkApiKey('stashdb', 'bad-token');
    assert.deepEqual(result, { valid: false, message: 'Key rejected or missing read permission.' });
  } finally {
    restore();
  }
});
