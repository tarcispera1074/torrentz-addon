const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installAdapter } = require('../helpers/mockHttp');
const cache = require('../../src/utils/cache');
const tubehub = require('../../src/streaming/tubehub');

const remoteItemId = 'tube:xhamster:https%3A%2F%2Fxhamster.com%2Fvideos%2Fthe-set-up-xh123';
const catalogTerm = url => decodeURIComponent(url.pathname.match(/\/search=([^/]+)\.json$/)?.[1] || '');

test('TubeHub exact-title matching returns a proxied stream option first', async () => {
  cache.clear();
  const requests = [];
  const restore = installAdapter(config => {
    const url = new URL(String(config.url));
    requests.push(url);
    if (url.pathname.startsWith('/catalog/')) {
      assert.equal(catalogTerm(url), 'The Set Up');
      return { data: { metas: [{ id: remoteItemId, name: 'The Set up' }] } };
    }
    if (url.pathname.startsWith('/stream/')) {
      return {
        data: {
          streams: [
            { name: 'xHamster (HD)', title: 'Direct HLS', url: 'https://cdn.example/master.m3u8', behaviorHints: { notWebReady: true } },
            { name: 'xHamster (HD) (proxy)', title: 'Proxied HLS', url: 'https://tubehub-addon.onrender.com/proxy/hls.m3u8?url=abc', behaviorHints: { notWebReady: false } }
          ]
        }
      };
    }
    throw new Error(`Unexpected TubeHub URL: ${url.pathname}`);
  });

  try {
    const streams = await tubehub.searchForScene({ title: 'The Set Up', performers: ['Sheila Ortega'] }, ['xhamster']);
    assert.ok(streams.length >= 1);
    assert.equal(streams[0].name, 'TubeHub: xHamster (HD)');
    assert.match(streams[0].title, /The Set up[\s\S]*Exact title match/);
    assert.match(streams[0].url, /\/proxy\/hls\.m3u8/);
    assert.equal(requests.filter(url => url.pathname.startsWith('/catalog/')).length, 1);
  } finally {
    restore();
    cache.clear();
  }
});

test('TubeHub falls back to metadata keywords after an exact-title miss', async () => {
  cache.clear();
  const catalogQueries = [];
  const restore = installAdapter(config => {
    const url = new URL(String(config.url));
    if (url.pathname.startsWith('/catalog/')) {
      const query = catalogTerm(url);
      catalogQueries.push(query);
      if (query === 'Unique scene title') return { data: { metas: [] } };
      if (query === 'Sheila Ortega') {
        return { data: { metas: [{ id: remoteItemId, name: 'Sheila Ortega - Unique Scene' }] } };
      }
      return { data: { metas: [] } };
    }
    if (url.pathname.startsWith('/stream/')) {
      return { data: { streams: [{ name: 'xHamster (HD) (proxy)', title: 'Keyword HLS', url: 'https://tubehub-addon.onrender.com/proxy?url=abc', behaviorHints: { notWebReady: false } }] } };
    }
    throw new Error(`Unexpected TubeHub URL: ${url.pathname}`);
  });

  try {
    const streams = await tubehub.searchForScene({
      title: 'Unique scene title',
      performers: ['Sheila Ortega'],
      studio: 'XConfessions'
    }, ['xhamster']);

    assert.deepEqual(catalogQueries, ['Unique scene title', 'Sheila Ortega']);
    assert.equal(streams.length, 1);
    assert.match(streams[0].name, /keyword match/);
    assert.match(streams[0].title, /Sheila Ortega[\s\S]*Keyword match/);
  } finally {
    restore();
    cache.clear();
  }
});
