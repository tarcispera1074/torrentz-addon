const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CONFIG } = require('../../src/config');
const { createManifest, createTubeHubManifest, createTubeSiteManifest, ADDON_VERSION } = require('../../src/manifest');

test('default manifest is valid and uses the shared version constant', () => {
  const manifest = createManifest(DEFAULT_CONFIG);

  assert.equal(manifest.version, ADDON_VERSION);
  assert.equal(manifest.id, 'community.torrentz.addon');
  assert.deepEqual(manifest.resources, ['catalog', 'meta', 'stream']);
  assert.deepEqual(manifest.types, ['movie']);
  assert.deepEqual(manifest.catalogs, []);
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
    'Torrentz: FansDB'
  ]);
  assert.equal(new Set(manifest.catalogs.map(catalog => catalog.id)).size, 5);
  assert.ok(manifest.idPrefixes.includes('tpdb-scene:'));
});

test('selected direct video sites share one TubeHub stream addon manifest', () => {
  const config = { ...DEFAULT_CONFIG, tubeSites: ['xhamster', 'xhamster_4k'] };
  const tubeHub = createTubeHubManifest(config);
  const hd = createTubeSiteManifest(config, 'xhamster');
  const uhd = createTubeSiteManifest(config, 'xhamster_4k');

  assert.equal(tubeHub.name, 'TubeHub');
  assert.equal(tubeHub.id, 'community.torrentz.tubehub');
  assert.deepEqual(tubeHub.resources, ['stream']);
  assert.ok(tubeHub.idPrefixes.includes('stashdb-scene:'));
  assert.equal(hd.name, 'xHamster (HD)');
  assert.equal(uhd.name, 'xHamster (4K)');
  assert.notEqual(hd.id, uhd.id);
  assert.equal(createTubeSiteManifest(config, 'redtube'), null);
  assert.equal(createTubeHubManifest({ ...config, tubeSites: [] }), null);
});

test('manifest name includes the Debrid provider name', () => {
  const manifest = createManifest({ ...DEFAULT_CONFIG, debridProvider: 'torbox' });

  assert.ok(manifest.name.endsWith('[TorBox]'), manifest.name);
});
