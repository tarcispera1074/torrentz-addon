const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installAdapter } = require('../helpers/mockHttp');
const mirrors = require('../../src/utils/mirrors');

const fixtures = path.join(__dirname, '..', 'fixtures');
const readFixture = name => fs.readFileSync(path.join(fixtures, name), 'utf8');

const tpb = require('../../src/scrapers/tpb');
const x1337 = require('../../src/scrapers/1337x');
const limetorrents = require('../../src/scrapers/limetorrents');
const rargb = require('../../src/scrapers/rargb');

test.beforeEach(() => mirrors.reset());

test('ThePirateBay scrape parses title, hash, size and seeders', async () => {
  const restore = installAdapter(() => ({ data: readFixture('tpb.html') }));

  try {
    const results = await tpb.search('Inception');

    assert.equal(results.length, 1);
    assert.equal(results[0].rawTitle, 'Inception.2010.1080p.BluRay.x264-GROUP');
    assert.equal(results[0].infoHash, '0123456789abcdef0123456789abcdef01234567');
    assert.equal(results[0].seeders, 1234);
    assert.equal(results[0].sizeBytes, Math.round(2.4 * 1024 * 1024 * 1024));
    assert.equal(results[0].source, 'ThePirateBay');
  } finally {
    restore();
  }
});

test('1337x scrape follows the detail page for the magnet link', async () => {
  const searchHtml = readFixture('1337x-search.html');
  const detailHtml = readFixture('1337x-detail.html');

  const restore = installAdapter(config => ({
    data: String(config.url).includes('/search/') ? searchHtml : detailHtml
  }));

  try {
    const results = await x1337.search('Inception');

    assert.equal(results.length, 1);
    assert.equal(results[0].infoHash, 'abcdefabcdefabcdefabcdefabcdefabcdefabcd');
    assert.equal(results[0].seeders, 432);
    assert.equal(results[0].source, '1337x');
  } finally {
    restore();
  }
});

test('LimeTorrents scrape extracts the hash from the torrent URL', async () => {
  const restore = installAdapter(() => ({ data: readFixture('limetorrents.html') }));

  try {
    const results = await limetorrents.search('Inception');

    assert.equal(results.length, 1);
    assert.equal(results[0].infoHash, '1111111111111111111111111111111111111111');
    assert.equal(results[0].seeders, 987);
    assert.equal(results[0].source, 'LimeTorrents');
  } finally {
    restore();
  }
});

test('RARBG scrape prefers the magnet hash and parses the fixture row', async () => {
  const restore = installAdapter(() => ({ data: readFixture('rargb.html') }));

  try {
    const results = await rargb.search('Inception');

    assert.equal(results.length, 1);
    assert.equal(results[0].infoHash, '2222222222222222222222222222222222222222');
    assert.equal(results[0].seeders, 654);
    assert.equal(results[0].source, 'RARBG');
  } finally {
    restore();
  }
});

test('a failing mirror is skipped after repeated failures', async () => {
  const urls = [];
  const restore = installAdapter(config => {
    urls.push(String(config.url));
    const error = new Error('blocked');
    error.response = { status: 403, data: 'blocked' };
    throw error;
  });

  try {
    await tpb.search('first');
    await tpb.search('second');
    await tpb.search('third');

    const before = urls.length;
    assert.equal(before, 12); // 3 mirrors + Apibay fallback, three times

    await tpb.search('fourth');
    const lastCall = urls.slice(before);

    // All mirrors are in cooldown; only the Apibay fallback is attempted.
    assert.equal(lastCall.length, 1);
    assert.ok(lastCall[0].includes('apibay.org'));
  } finally {
    restore();
  }
});

test('scraper orchestrator deduplicates hashes and keeps the highest seeders', async () => {
  const { searchAll } = require('../../src/scrapers');
  const originalTpb = tpb.search;
  const originalX1337 = x1337.search;

  tpb.search = async () => ([
    { rawTitle: 'Inception.2010.1080p', infoHash: 'a'.repeat(40), seeders: 10, sizeBytes: 1, source: 'tpb' }
  ]);
  x1337.search = async () => ([
    { rawTitle: 'Inception.2010.1080p', infoHash: 'a'.repeat(40), seeders: 99, sizeBytes: 1, source: '1337x' }
  ]);

  try {
    const results = await searchAll('Inception', ['tpb', '1337x']);
    assert.equal(results.length, 1);
    assert.equal(results[0].seeders, 99);
    assert.equal(results[0].source, '1337x');
  } finally {
    tpb.search = originalTpb;
    x1337.search = originalX1337;
  }
});
