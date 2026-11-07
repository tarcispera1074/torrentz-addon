const { DEFAULT_CONFIG } = require('./config');
const debrid = require('./debrid');

const ADDON_VERSION = '1.1.0';

/**
 * Manifest generator supporting split modes: 'movies', 'xxx', 'all'
 */
function createManifest(config = DEFAULT_CONFIG) {
  const mode = config.mode || 'all';
  let id = 'community.torrentz.addon';
  let name = 'Torrentz';
  let description = 'High-speed torrent scraper for ThePirateBay, 1337x, LimeTorrents, and RARBG';
  let types = ['movie', 'series', 'other'];
  let catalogs = [];

  if (mode === 'movies') {
    id = 'community.torrentz.movies';
    name = 'Torrentz (Movies & TV)';
    description = 'Mainstream Movies & TV Series torrent streams with Debrid support';
    types = ['movie', 'series'];
    catalogs = [
      {
        type: 'movie',
        id: 'torrentz_movies',
        name: 'Torrentz Movies',
        extra: [{ name: 'search', isRequired: false }]
      },
      {
        type: 'series',
        id: 'torrentz_series',
        name: 'Torrentz Series',
        extra: [{ name: 'search', isRequired: false }]
      }
    ];
  } else if (mode === 'xxx' || mode === 'other') {
    id = 'community.torrentz.xxx';
    name = 'Torrentz XXX';
    description = 'Adult video & performer torrent scraper';
    types = ['movie'];
    catalogs = [
      {
        type: 'movie',
        id: 'torrentz_xxx',
        name: 'Torrentz XXX',
        extra: [{ name: 'search', isRequired: false }]
      }
    ];
  } else {
    // Mode = 'all'
    id = 'community.torrentz.addon';
    name = 'Torrentz (All-in-One)';
    description = 'Movies, TV series, adult performers & custom torrents';
    types = ['movie', 'series'];
    catalogs = [
      {
        type: 'movie',
        id: 'torrentz_movies',
        name: 'Torrentz Movies',
        extra: [{ name: 'search', isRequired: false }]
      },
      {
        type: 'series',
        id: 'torrentz_series',
        name: 'Torrentz Series',
        extra: [{ name: 'search', isRequired: false }]
      }
    ];
  }

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
    idPrefixes: ['tt', 'torrentz:', 'torrentz-group:'],
    catalogs,
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}

module.exports = {
  ADDON_VERSION,
  createManifest
};
