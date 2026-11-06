const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG } = require('../../src/config');
const { createManifest, ADDON_VERSION } = require('../../src/manifest');

test('default manifest is valid and uses the shared version constant', () => {
  const manifest = createManifest(DEFAULT_CONFIG);

  assert.equal(manifest.version, ADDON_VERSION);
  assert.equal(manifest.id, 'community.torrentz.addon');
  assert.deepEqual(manifest.resources, ['catalog', 'meta', 'stream']);
  assert.ok(manifest.types.includes('movie'));
  assert.ok(manifest.types.includes('series'));
  assert.equal(manifest.behaviorHints.configurable, true);
});

test('catalog ids are unique in every mode', () => {
  for (const mode of ['all', 'movies', 'xxx']) {
    const manifest = createManifest({ ...DEFAULT_CONFIG, mode });
    const ids = manifest.catalogs.map(catalog => catalog.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate catalog id in ${mode} mode`);
  }
});

test('movies mode exposes movie and series catalogs only', () => {
  const manifest = createManifest({ ...DEFAULT_CONFIG, mode: 'movies' });

  assert.equal(manifest.id, 'community.torrentz.movies');
  assert.deepEqual(manifest.types, ['movie', 'series']);
  assert.deepEqual(manifest.catalogs.map(c => c.type).sort(), ['movie', 'series']);
});

test('xxx mode exposes a single movie catalog', () => {
  const manifest = createManifest({ ...DEFAULT_CONFIG, mode: 'xxx' });

  assert.equal(manifest.id, 'community.torrentz.xxx');
  assert.deepEqual(manifest.types, ['movie']);
  assert.equal(manifest.catalogs.length, 1);
});

test('manifest name includes the Debrid provider name', () => {
  const manifest = createManifest({ ...DEFAULT_CONFIG, debridProvider: 'torbox' });

  assert.ok(manifest.name.endsWith('[TorBox]'), manifest.name);
});
