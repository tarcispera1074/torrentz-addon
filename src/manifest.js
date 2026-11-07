const { DEFAULT_CONFIG } = require('./config');
const debrid = require('./debrid');
const { TUBE_SITES } = require('./streaming/tube-sites');

const ADDON_VERSION = '1.4.4';

const METADATA_CATALOGS = [
  { source: 'tpdb', label: 'PornDB' },
  { source: 'stashdb', label: 'StashDB' },
  { source: 'javstash', label: 'JAVStash' },
  { source: 'pmvstash', label: 'PMV Stash' },
  { source: 'fansdb', label: 'FansDB' }
];

/**
 * Build the adult-only manifest, exposing one independently searchable catalog
 * for each Stash-Box source configured with a key.
 */
function createManifest(config = DEFAULT_CONFIG) {
  const sources = new Set(config.metadataSources || []);
  const catalogs = METADATA_CATALOGS
    .filter(({ source }) => sources.has(source) && config.metadataApiKeys?.[source])
    .map(({ source, label }) => ({
      type: 'movie',
      id: `torrentz_${source}`,
      name: `Torrentz: ${label}`,
      extra: [{ name: 'search', isRequired: false }]
    }));

  const id = 'community.torrentz.addon';
  let name = 'Torrentz';
  const description = 'Adult scene metadata with torrent results from enabled providers';
  const types = ['movie'];

  if (config.debridProvider) {
    const prov = debrid.getProvider(config.debridProvider);
    name += ` [${prov ? prov.name : config.debridProvider.toUpperCase()}]`;
  }

  return {
    id,
    version: ADDON_VERSION,
    name,
    description,
    resources: ['catalog', 'meta', 'stream'],
    types,
    idPrefixes: [
      'tt',
      'torrentz:',
      'torrentz-group:',
      'tpdb-scene:',
      'stashdb-scene:',
      'javstash-scene:',
      'pmvstash-scene:',
      'fansdb-scene:'
    ],
    catalogs,
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}

/** A single TubeHub stream addon aggregating the selected direct video sites. */
function createTubeHubManifest(config = DEFAULT_CONFIG) {
  if (!Array.isArray(config.tubeSites) || config.tubeSites.length === 0) return null;

  return {
    id: 'community.torrentz.tubehub',
    version: ADDON_VERSION,
    name: 'TubeHub',
    description: 'Direct video streams from selected TubeHub websites',
    resources: ['stream'],
    types: ['movie'],
    idPrefixes: [
      'tpdb-scene:',
      'stashdb-scene:',
      'javstash-scene:',
      'pmvstash-scene:',
      'fansdb-scene:'
    ],
    behaviorHints: { configurable: true, configurationRequired: false }
  };
}

/** Legacy per-site manifests remain available for existing installs. */
function createTubeSiteManifest(config = DEFAULT_CONFIG, siteId) {
  const siteName = TUBE_SITES[siteId];
  if (!siteName || !(config.tubeSites || []).includes(siteId)) return null;

  return {
    id: `community.torrentz.tube.${siteId}`,
    version: ADDON_VERSION,
    name: siteName,
    description: `Direct video streams from ${siteName}`,
    resources: ['stream'],
    types: ['movie'],
    idPrefixes: [
      'tpdb-scene:',
      'stashdb-scene:',
      'javstash-scene:',
      'pmvstash-scene:',
      'fansdb-scene:'
    ],
    behaviorHints: { configurable: true, configurationRequired: false }
  };
}

module.exports = {
  ADDON_VERSION,
  METADATA_CATALOGS,
  createManifest,
  createTubeHubManifest,
  createTubeSiteManifest
};
