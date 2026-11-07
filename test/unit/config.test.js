const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_CONFIG,
  decodeConfig,
  encodeConfig,
  sanitizeConfig
} = require('../../src/config');

test('URL-safe base64 round-trips every config field', () => {
  const input = {
    mode: 'movies',
    providers: ['tpb', '1337x'],
    debridProvider: 'torbox',
    debridApiKey: 'secret-token',
    metadataSources: ['tpdb', 'javstash'],
    metadataApiKeys: { tpdb: 'tpdb-secret', javstash: 'javstash-secret', invalid: 'ignored' },
    showP2PFallback: false,
    maxStreamsPerResolution: 8,
    resolutions: ['1080p', '720p'],
    groupByTitle: false
  };

  const decoded = decodeConfig(encodeConfig(input));

  assert.equal(decoded.mode, 'movies');
  assert.deepEqual(decoded.providers, ['tpb', '1337x']);
  assert.equal(decoded.debridProvider, 'torbox');
  assert.equal(decoded.debridApiKey, 'secret-token');
  assert.deepEqual(decoded.metadataSources, ['tpdb', 'javstash']);
  assert.deepEqual(decoded.metadataApiKeys, { tpdb: 'tpdb-secret', javstash: 'javstash-secret' });
  assert.equal(decoded.showP2PFallback, false);
  assert.equal(decoded.maxStreamsPerResolution, 8);
  assert.deepEqual(decoded.resolutions, ['1080p', '720p']);
  assert.equal(decoded.groupByTitle, false);
});

test('base64 config with padding is accepted', () => {
  const encoded = Buffer.from(JSON.stringify({ mode: 'movies', groupByTitle: false }), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const decoded = decodeConfig(encoded);

  assert.equal(decoded.mode, 'movies');
  assert.equal(decoded.groupByTitle, false);
});

test('pipe format preserves "=" characters inside API keys', () => {
  const decoded = decodeConfig('mode=movies|providers=tpb,1337x|debrid=torbox|key=abc=def==');

  assert.equal(decoded.mode, 'movies');
  assert.deepEqual(decoded.providers, ['tpb', '1337x']);
  assert.equal(decoded.debridProvider, 'torbox');
  assert.equal(decoded.debridApiKey, 'abc=def==');
});

test('pipe format supports grouping and max stream options', () => {
  const decoded = decodeConfig('group=false|maxstreams=12|resolutions=1080p,720p');

  assert.equal(decoded.groupByTitle, false);
  assert.equal(decoded.maxStreamsPerResolution, 12);
  assert.deepEqual(decoded.resolutions, ['1080p', '720p']);
});

test('invalid config strings fall back to defaults', () => {
  assert.deepEqual(decodeConfig(''), DEFAULT_CONFIG);
  assert.deepEqual(decodeConfig('%%%not-base64%%%'), DEFAULT_CONFIG);
  assert.deepEqual(decodeConfig('manifest.json'), DEFAULT_CONFIG);
});

test('sanitizeConfig drops unknown keys and blocks prototype pollution', () => {
  const input = JSON.parse('{"mode":"hacker","debridProvider":"not-a-provider","providers":["tpb","unknown","thepiratebay"],"__proto__":{"polluted":true},"constructor":"nope"}');
  const clean = sanitizeConfig(input);

  assert.equal(clean.mode, undefined);
  assert.equal(clean.debridProvider, null);
  assert.deepEqual(clean.providers, ['tpb']);
  assert.equal(clean.polluted, undefined);
  assert.equal({}.polluted, undefined);
});

test('sanitizeConfig clamps numeric options and normalizes resolutions', () => {
  assert.equal(sanitizeConfig({ maxStreamsPerResolution: 999 }).maxStreamsPerResolution, 200);
  assert.equal(sanitizeConfig({ maxStreamsPerResolution: -2 }).maxStreamsPerResolution, 1);
  assert.equal(sanitizeConfig({ maxStreamsPerResolution: 'oops' }).maxStreamsPerResolution, 5);
  assert.deepEqual(sanitizeConfig({ resolutions: ['4k', '1080P', 'bogus'] }).resolutions, ['2160p', '1080p']);
});

test('provider aliases resolve to canonical ids', () => {
  const decoded = decodeConfig('providers=thepiratebay,1337x');
  assert.deepEqual(decoded.providers, ['tpb', '1337x']);
});

test('metadata sources are allowlisted and API keys are trimmed and bounded', () => {
  const clean = sanitizeConfig({
    metadataSources: ['TPDB', 'stashdb', 'unsupported', 'tpdb'],
    metadataApiKeys: { tpdb: `  ${'x'.repeat(600)}  `, unknown: 'nope' }
  });

  assert.deepEqual(clean.metadataSources, ['tpdb', 'stashdb']);
  assert.equal(clean.metadataApiKeys.tpdb.length, 512);
  assert.equal(clean.metadataApiKeys.unknown, undefined);
});
