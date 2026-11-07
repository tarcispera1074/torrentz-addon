const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG } = require('../../src/config');
const { createManifest, ADDON_VERSION } = require('../../src/manifest');

test('default manifest is valid and uses the shared version constant', () => {
  const manifest = createManifest(DEFAULT_CONFIG);

  assert.equal(manifest.version, ADDON_VERSION);
  assert.equal(manifest.id, 'community.torrentz.addon');
  assert.deepEqual(manifest.resources, ['catalog', 'meta', 'stream']);
  assert.deepEqual(manifest.types, ['movie']);
  assert.deepEqual(manifest.catalogs.map(catalog => catalog.name), [
    'Torrentz: xHamster (HD)',
    'Torrentz: xVideos (HD)',
    'Torrentz: RedTube (HD)',
    'Torrentz: YouPorn (HD)',
    'Torrentz: Tube8 (HD)'
  ]);
  assert.equal(manifest.behaviorHints.configurable, true);
});

test('porn-only manifest exposes a distinct catalog for each enabled keyed source', () => {
  const manifest = createManifest({
    ...DEFAULT_CONFIG,
    metadataSources: ['tpdb', 'stashdb', 'javstash', 'pmvstash', 'fansdb'],
    tubeSites: ['xhamster', 'xhamster_4k'],
    metadataApiKeys: {
      tpdb: 'tpdb-token',
      stashdb: 'stashdb-token',
      javstash: 'javstash-token',
      pmvstash: 'pmvstash-token',
      fansdb: 'fansdb-token'
    }
  });

  assert.deepEqual(manifest.catalogs.map(catalog => catalog.name), [
    'Torrentz: PornDB',
    'Torrentz: StashDB',
    'Torrentz: JAVStash',
    'Torrentz: PMV Stash',
    'Torrentz: FansDB',
    'Torrentz: xHamster (HD)',
    'Torrentz: xHamster (4K)'
  ]);
  assert.equal(new Set(manifest.catalogs.map(catalog => catalog.id)).size, 7);
  assert.deepEqual(
    manifest.catalogs.slice(-2).map(catalog => catalog.name),
    ['Torrentz: xHamster (HD)', 'Torrentz: xHamster (4K)']
  );
  assert.ok(manifest.idPrefixes.includes('tpdb-scene:'));
});

test('manifest name includes the Debrid provider name', () => {
  const manifest = createManifest({ ...DEFAULT_CONFIG, debridProvider: 'torbox' });

  assert.ok(manifest.name.endsWith('[TorBox]'), manifest.name);
});
