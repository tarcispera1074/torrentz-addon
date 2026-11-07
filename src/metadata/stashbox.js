const { createHash } = require('node:crypto');
const { client } = require('../utils/http');
const cache = require('../utils/cache');

const SEARCH_TTL = 15 * 60 * 1000;
const SCENE_TTL = 24 * 60 * 60 * 1000;
const EMPTY_TTL = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4000;
const inFlightSearches = new Map();

const SOURCES = {
  tpdb: {
    name: 'ThePornDB',
    endpoint: 'https://theporndb.net/graphql',
    accessUrl: 'https://theporndb.net/user/api-tokens',
    homeUrl: 'https://theporndb.net/'
  },
  stashdb: {
    name: 'StashDB',
    endpoint: 'https://stashdb.org/graphql',
    accessUrl: 'https://guidelines.stashdb.org/docs/faq_getting-started/stashdb/accessing-stashdb/',
    homeUrl: 'https://stashdb.org/'
  },
  javstash: {
    name: 'JAVStash',
    endpoint: 'https://javstash.org/graphql',
    accessUrl: 'https://javstash.org/',
    homeUrl: 'https://javstash.org/'
  },
  pmvstash: {
    name: 'PMV Stash',
    endpoint: 'https://pmvstash.org/graphql',
    accessUrl: 'https://blog.pmvstash.org/',
    homeUrl: 'https://pmvstash.org/'
  },
  fansdb: {
    name: 'FansDB',
    endpoint: 'https://fansdb.cc/graphql',
    accessUrl: 'https://docs.fansdb.cc/',
    homeUrl: 'https://fansdb.cc/'
  }
};

const SCENE_FIELDS = `
  id
  title
  date
  code
  details
  urls { url }
  studio { name }
  performers { performer { name } as }
  images { url }
`;

const SEARCH_QUERY = `
  query SearchScenes($term: String!, $limit: Int) {
    searchScenes(term: $term, limit: $limit) {
      scenes { ${SCENE_FIELDS} }
    }
  }
`;

const BROWSE_QUERY = `
  query BrowseScenes($limit: Int!) {
    queryScenes(input: { page: 1, per_page: $limit, direction: DESC, sort: DATE }) {
      scenes { ${SCENE_FIELDS} }
    }
  }
`;

const LEGACY_SEARCH_QUERY = `
  query SearchScene($term: String!, $limit: Int) {
    searchScene(term: $term, limit: $limit) { ${SCENE_FIELDS} }
  }
`;

const FIND_SCENE_QUERY = `
  query FindScene($id: ID!) {
    findScene(id: $id) { ${SCENE_FIELDS} }
  }
`;

const CHECK_ACCESS_QUERY = `
  query CheckStashBoxReadAccess($term: String!, $limit: Int) {
    searchScenes(term: $term, limit: $limit) { scenes { id } }
  }
`;

const LEGACY_CHECK_ACCESS_QUERY = `
  query CheckStashBoxReadAccess($term: String!, $limit: Int) {
    searchScene(term: $term, limit: $limit) { id }
  }
`;

function tokenFingerprint(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}

function searchCacheKey(source, token, query) {
  return `stashbox-search:${source}:${tokenFingerprint(token)}:${String(query).trim().toLowerCase()}`;
}

function sceneCacheKey(source, token, id) {
  return `stashbox-scene:${source}:${tokenFingerprint(token)}:${String(id)}`;
}

function normalizeScene(source, raw) {
  if (!raw || raw.id === undefined || raw.id === null) return null;

  const info = SOURCES[source];
  const performers = (Array.isArray(raw.performers) ? raw.performers : [])
    .map(item => item?.performer?.name || item?.name || item?.as)
    .filter(Boolean);
  const studio = typeof raw.studio === 'string' ? raw.studio : raw.studio?.name;
  const images = Array.isArray(raw.images) ? raw.images : [];
  const urls = (Array.isArray(raw.urls) ? raw.urls : [])
    .map(item => typeof item === 'string' ? item : item?.url)
    .filter(Boolean);

  return {
    id: String(raw.id),
    provider: source,
    providerName: info.name,
    title: String(raw.title || '').trim(),
    date: String(raw.date || raw.release_date || '').trim(),
    code: String(raw.code || '').trim(),
    details: String(raw.details || '').trim(),
    studio: String(studio || '').trim(),
    performers: [...new Set(performers.map(name => String(name).trim()).filter(Boolean))],
    poster: images.find(image => image?.url)?.url || null,
    urls
  };
}

function extractScenes(response, operation) {
  if (Array.isArray(response?.errors) && response.errors.length > 0) {
    const error = new Error(response.errors.map(item => item.message).join('; '));
    error.graphqlErrors = response.errors;
    throw error;
  }

  const result = response?.data?.[operation];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.scenes)) return result.scenes;
  return result ? [result] : [];
}

async function postGraphQL(source, token, query, variables) {
  const response = await client.post(
    SOURCES[source].endpoint,
    { query, variables },
    {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        ApiKey: token
      }
    }
  );
  return response.data;
}

function isSchemaCompatibilityError(error) {
  return /cannot query field|unknown argument|unknown type|does not exist|not defined/i.test(error.message || '');
}

async function search(source, token, term, limit = 25) {
  const provider = SOURCES[source];
  const query = String(term || '').trim().slice(0, 160);
  const apiKey = String(token || '').trim();
  if (!provider || !apiKey) return [];

  const key = searchCacheKey(source, apiKey, query || '__recent__');
  const cached = cache.get(key);
  if (cached) return cached;
  if (inFlightSearches.has(key)) return inFlightSearches.get(key);

  const work = (async () => {
    try {
      let rawScenes;
      if (!query) {
        const response = await postGraphQL(source, apiKey, BROWSE_QUERY, {
          limit: Math.max(1, Math.min(50, limit))
        });
        rawScenes = extractScenes(response, 'queryScenes');
      } else {
        try {
          rawScenes = extractScenes(
            await postGraphQL(source, apiKey, SEARCH_QUERY, { term: query, limit: Math.max(1, Math.min(50, limit)) }),
            'searchScenes'
          );
        } catch (error) {
          // Older Stash-Box-compatible deployments expose the singular legacy
          // field and return the scene list directly.
          if (!isSchemaCompatibilityError(error)) throw error;
          rawScenes = extractScenes(
            await postGraphQL(source, apiKey, LEGACY_SEARCH_QUERY, { term: query, limit: Math.max(1, Math.min(50, limit)) }),
            'searchScene'
          );
        }
      }

      const scenes = rawScenes
        .map(item => normalizeScene(source, item))
        .filter(item => item && item.title);
      cache.set(key, scenes, scenes.length ? SEARCH_TTL : EMPTY_TTL);
      return scenes;
    } catch (error) {
      console.warn(`[Metadata] ${provider.name} scene search failed: ${error.message}`);
      return [];
    } finally {
      inFlightSearches.delete(key);
    }
  })();

  inFlightSearches.set(key, work);
  return work;
}

async function getScene(source, token, id) {
  const provider = SOURCES[source];
  const apiKey = String(token || '').trim();
  if (!provider || !apiKey || !id) return null;

  const key = sceneCacheKey(source, apiKey, id);
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const response = await postGraphQL(source, apiKey, FIND_SCENE_QUERY, { id: String(id) });
    const [scene] = extractScenes(response, 'findScene');
    const normalized = normalizeScene(source, scene);
    if (normalized) cache.set(key, normalized, SCENE_TTL);
    return normalized;
  } catch (error) {
    console.warn(`[Metadata] ${provider.name} scene lookup failed: ${error.message}`);
    return null;
  }
}

async function checkApiKey(source, token) {
  const provider = SOURCES[source];
  const apiKey = String(token || '').trim();
  if (!provider) return { valid: false, message: 'Unknown metadata source.' };
  if (!apiKey) return { valid: false, message: 'Enter an API key first.' };

  const variables = { term: 'Torrentz API key check', limit: 1 };
  try {
    try {
      const response = await postGraphQL(source, apiKey, CHECK_ACCESS_QUERY, variables);
      extractScenes(response, 'searchScenes');
    } catch (error) {
      if (!isSchemaCompatibilityError(error)) throw error;
      const response = await postGraphQL(source, apiKey, LEGACY_CHECK_ACCESS_QUERY, variables);
      extractScenes(response, 'searchScene');
    }
    return { valid: true, message: 'API key works; read access confirmed.' };
  } catch (error) {
    const status = error.response?.status;
    const detail = String(error.message || '');
    if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|invalid api.?key|invalid token|access denied|read permission|insufficient role/i.test(detail)) {
      return { valid: false, message: 'Key rejected or missing read permission.' };
    }
    if (status) {
      return { valid: false, message: `Could not verify the key (HTTP ${status}).` };
    }
    return { valid: false, message: 'Could not reach this API. Check the endpoint or try again.' };
  }
}

module.exports = {
  SOURCES,
  search,
  getScene,
  checkApiKey,
  normalizeScene,
  searchCacheKey,
  sceneCacheKey
};
