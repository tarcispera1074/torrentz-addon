const { client } = require('../utils/http');
const cache = require('../utils/cache');
const { normalizeTitle } = require('../utils/parser');
const { TUBE_SITES, TUBE_SITE_IDS } = require('./tube-sites');

const DEFAULT_TUBEHUB_URL = 'https://tubehub-addon.onrender.com';
const CATALOG_TTL = 5 * 60 * 1000;
const STREAM_TTL = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;
const TITLE_STOP_WORDS = new Set(['a', 'an', 'and', 'by', 'for', 'from', 'her', 'his', 'in', 'of', 'the', 'to', 'with']);

function baseUrl() {
  return String(process.env.TUBEHUB_ADDON_URL || DEFAULT_TUBEHUB_URL).replace(/\/+$/, '');
}

function siteCatalogKey(siteId, query, skip) {
  return `tubehub-catalog:${siteId}:${String(query).trim().toLowerCase()}:${skip}`;
}

async function searchSite(siteId, query, skip = 0) {
  if (!TUBE_SITE_IDS.includes(siteId)) return [];
  const safeSkip = Math.max(0, Math.floor(Number(skip) || 0));
  const key = siteCatalogKey(siteId, query, safeSkip);
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const extra = query
      ? `search=${encodeURIComponent(query)}&skip=${safeSkip}`
      : `skip=${safeSkip}`;
    const url = `${baseUrl()}/catalog/movie/tube_${siteId}/${extra}.json`;
    const response = await client.get(url, { timeout: REQUEST_TIMEOUT_MS });
    const items = Array.isArray(response.data?.metas) ? response.data.metas : [];
    cache.set(key, items, items.length ? CATALOG_TTL : 60_000);
    return items;
  } catch (error) {
    console.warn(`[TubeHub] ${siteId} catalog search failed: ${error.response?.status || error.code || 'network error'}`);
    return [];
  }
}

function exactTitleMatch(sceneTitle, itemTitle) {
  const wanted = normalizeTitle(sceneTitle);
  const actual = normalizeTitle(itemTitle);
  return Boolean(wanted && actual && (actual === wanted || actual.includes(wanted)));
}

function keywordMatch(query, itemTitle) {
  const words = normalizeTitle(query)
    .split(' ')
    .filter(word => word.length > 1 && !TITLE_STOP_WORDS.has(word));
  if (!words.length) return false;
  const actual = new Set(normalizeTitle(itemTitle).split(' '));
  const matched = words.filter(word => actual.has(word)).length;
  return matched >= Math.max(1, Math.ceil(words.length * 0.7));
}

function sceneKeywordMatch(scene, itemTitle) {
  const titleWords = normalizeTitle(scene?.title)
    .split(' ')
    .filter(word => word.length > 1 && !TITLE_STOP_WORDS.has(word));
  if (titleWords.length === 0) return false;

  const normalizedItem = normalizeTitle(itemTitle);
  const itemWords = new Set(normalizedItem.split(' '));
  const overlap = titleWords.filter(word => itemWords.has(word)).length / titleWords.length;
  const castMatch = (scene.performers || []).some(name => {
    const performer = normalizeTitle(name);
    return performer.length > 2 && normalizedItem.includes(performer);
  });
  const studio = normalizeTitle(scene.studio);
  const studioMatch = studio.length > 2 && normalizedItem.includes(studio);

  // Keyword-only results must still resemble the selected scene; matching a
  // performer by itself would mix in that performer's unrelated videos.
  if (titleWords.length <= 2) return overlap === 1 && (castMatch || studioMatch);
  if (overlap >= 0.7) return true;
  return overlap >= 0.5 && (castMatch || studioMatch);
}

function keywordQueries(scene) {
  const queries = [];
  const code = String(scene.code || '').trim();
  if (/^[A-Z0-9]{2,12}-\d{2,6}$/i.test(code)) queries.push(code);
  for (const performer of (scene.performers || []).slice(0, 2)) {
    if (performer) queries.push(String(performer));
  }
  if (scene.studio) queries.push(String(scene.studio));
  if (!(scene.performers || []).length) {
    const prefix = String(scene.title || '').split(/\s+/).slice(0, 2).join(' ');
    if (prefix) queries.push(prefix);
  }
  return [...new Set(queries.map(query => query.trim()).filter(Boolean))];
}

function tubeStreamKey(siteId, itemId, matchKind, matchQuery) {
  return `tubehub-stream:${siteId}:${matchKind}:${String(matchQuery).toLowerCase()}:${itemId}`;
}

async function resolveTubeItem(siteId, item, matchKind, matchQuery) {
  const cached = cache.get(tubeStreamKey(siteId, item.id, matchKind, matchQuery));
  if (cached) return cached;

  try {
    const id = encodeURIComponent(String(item.id || ''));
    const response = await client.get(`${baseUrl()}/stream/movie/${id}.json`, { timeout: REQUEST_TIMEOUT_MS });
    const streams = Array.isArray(response.data?.streams) ? response.data.streams : [];
    // TubeHub's proxy is the reliable choice for signed/IP-bound HLS and MP4
    // links. Keep a direct fallback only if that site has no proxy variant.
    const selected = streams.find(stream => /\(proxy\)/i.test(stream.name || '')) || streams.find(stream => stream.url);
    if (!selected?.url) return [];

    const parsed = new URL(selected.url);
    const expectedHost = new URL(baseUrl()).host;
    const proxied = parsed.host === expectedHost && parsed.pathname.startsWith('/proxy');
    if (!proxied && selected.behaviorHints?.notWebReady !== true) return [];

    const label = TUBE_SITES[siteId] || siteId;
    const matchDescription = matchKind === 'exact'
      ? `Exact title match: ${matchQuery}`
      : (matchKind === 'keyword' ? `Keyword match: ${matchQuery} — verify it is the same scene.` : '');
    const title = [item.name || 'Direct video', selected.title].filter(Boolean).join(' • ');
    const result = [{
      name: `TubeHub: ${label}${matchKind === 'keyword' ? ' (keyword match)' : ''}`,
      title: [title, matchDescription].filter(Boolean).join('\n'),
      url: selected.url,
      ...(selected.behaviorHints ? { behaviorHints: selected.behaviorHints } : {})
    }];
    cache.set(tubeStreamKey(siteId, item.id, matchKind, matchQuery), result, STREAM_TTL);
    return result;
  } catch (error) {
    console.warn(`[TubeHub] ${siteId} stream lookup failed: ${error.response?.status || error.code || 'network error'}`);
    return [];
  }
}

async function searchAndResolve(siteIds, query, matchKind, scene) {
  const catalogResults = await Promise.all(siteIds.map(async siteId => ({
    siteId,
    items: await searchSite(siteId, query)
  })));

  const candidatesBySite = new Map();
  for (const { siteId, items } of catalogResults) {
    for (const item of items) {
      const matched = matchKind === 'exact'
        ? exactTitleMatch(scene.title, item.name)
        : keywordMatch(query, item.name) && sceneKeywordMatch(scene, item.name);
      if (!matched) continue;
      const candidates = candidatesBySite.get(siteId) || [];
      if (!candidates.some(candidate => candidate.item.id === item.id)) {
        candidates.push({ siteId, item });
        candidatesBySite.set(siteId, candidates);
      }
      if (candidates.length >= 2) break;
    }
  }

  const perSite = await Promise.all([...candidatesBySite.values()].map(async candidates => {
    const results = await Promise.all(candidates.map(({ siteId, item }) =>
      resolveTubeItem(siteId, item, matchKind, query)
    ));
    return results.find(result => result.length) || [];
  }));
  return perSite.flat();
}

/**
 * Search OnlyPorn/TubeHub sites for the selected metadata scene. Exact wording
 * is always attempted first; only if it produces no playable results do we try
 * the scene's code, performers, studio, or other keywords.
 */
async function searchForScene(scene, selectedSites = []) {
  const sites = [...new Set((selectedSites || []).filter(site => TUBE_SITE_IDS.includes(site)))];
  const title = String(scene?.title || '').trim();
  if (!sites.length || !title) return [];

  const exactStreams = await searchAndResolve(sites, title, 'exact', scene);
  if (exactStreams.length) return exactStreams;

  for (const query of keywordQueries(scene).slice(0, 2)) {
    if (normalizeTitle(query) === normalizeTitle(title)) continue;
    const keywordStreams = await searchAndResolve(sites, query, 'keyword', scene);
    if (keywordStreams.length) return keywordStreams;
  }
  return [];
}

module.exports = {
  TUBE_SITES,
  TUBE_SITE_IDS,
  DEFAULT_TUBEHUB_URL,
  searchSite,
  searchForScene,
  exactTitleMatch,
  keywordMatch,
  sceneKeywordMatch
};
