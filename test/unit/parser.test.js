const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractInfoHash,
  parseSizeToBytes,
  formatSize,
  normalizeResolution,
  resolutionLabel,
  getTitleInfo,
  formatStream
} = require('../../src/utils/parser');

const HASH = '0123456789abcdef0123456789abcdef01234567';

test('extractInfoHash accepts raw hex and magnet URIs', () => {
  assert.equal(extractInfoHash(HASH), HASH);
  assert.equal(extractInfoHash(HASH.toUpperCase()), HASH);
  assert.equal(extractInfoHash(`magnet:?xt=urn:btih:${HASH}&dn=Inception`), HASH);
  assert.equal(extractInfoHash('not-a-hash'), null);
});

test('extractInfoHash converts 32 character base32 hashes to hex', () => {
  const base32 = 'AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH';
  const hex = extractInfoHash(`magnet:?xt=urn:btih:${base32}`);
  assert.match(hex, /^[a-f0-9]{40}$/);
});

test('sizes parse and format consistently', () => {
  assert.equal(parseSizeToBytes('2.4 GB'), Math.round(2.4 * 1024 * 1024 * 1024));
  assert.equal(parseSizeToBytes('850 MB'), Math.round(850 * 1024 * 1024));
  assert.equal(parseSizeToBytes('unknown'), 0);
  assert.equal(formatSize(2.4 * 1024 * 1024 * 1024), '2.40 GB');
  assert.equal(formatSize(0), 'Unknown');
});

test('resolution aliases normalize to canonical keys', () => {
  assert.equal(normalizeResolution('4K'), '2160p');
  assert.equal(normalizeResolution('1080P'), '1080p');
  assert.equal(normalizeResolution(''), 'other');
  assert.equal(resolutionLabel('2160p'), '4K');
});

test('same title in different qualities shares a grouping key', () => {
  const a = getTitleInfo('Inception.2010.1080p.BluRay.x264-GROUP');
  const b = getTitleInfo('Inception.2010.720p.WEB-DL.x265-OTHER');
  const c = getTitleInfo('Interstellar.2014.1080p.BluRay.x264-GROUP');

  assert.equal(a.label, 'Inception (2010)');
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
});

test('series episodes group by season and episode', () => {
  const first = getTitleInfo('Breaking.Bad.S01E01.1080p.BluRay.x264-GROUP');
  const second = getTitleInfo('Breaking.Bad.S01E02.1080p.BluRay.x264-GROUP');

  assert.equal(first.label, 'Breaking Bad S01E01');
  assert.notEqual(first.key, second.key);
});

test('formatStream exposes a shared display title and quality badge', () => {
  const stream = formatStream({
    rawTitle: 'Inception.2010.1080p.BluRay.x264-GROUP',
    infoHash: HASH.toUpperCase(),
    sizeBytes: 2.4 * 1024 * 1024 * 1024,
    seeders: 42,
    source: '1337x'
  });

  assert.equal(stream.name, '[P2P] 1080p');
  assert.equal(stream.resolution, '1080p');
  assert.equal(stream.groupKey, 'inception|2010||');
  assert.ok(stream.title.startsWith('Inception (2010)\n'));
  assert.ok(stream.title.includes('Inception.2010.1080p.BluRay.x264-GROUP'));
  assert.equal(stream.infoHash, HASH);
  assert.equal(stream.sources[0], `dht:${HASH}`);
  assert.ok(stream.sources.some(source => source.startsWith('tracker:udp://')));
});

test('formatStream labels 2160p as 4K and flags Debrid cache hits', () => {
  const stream = formatStream({
    rawTitle: 'Inception.2010.2160p.UHD.BluRay.x265-GROUP',
    infoHash: HASH,
    sizeBytes: 10 * 1024 * 1024 * 1024,
    seeders: 10,
    source: 'RARBG',
    debridCached: true,
    debridProvider: 'TORBOX'
  });

  assert.equal(stream.name, '[TORBOX+] 4K');
  assert.equal(stream.debridCached, true);
});
