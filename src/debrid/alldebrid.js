const { client } = require('../utils/http');
const { pollUntil, debridPollOptions } = require('../utils/poll');
const { DebridPendingError, DebridError } = require('./errors');

const API_BASE = 'https://api.alldebrid.com/v4';
const AGENT = 'stremio-addon';
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|m4v|webm|flv)$/i;

function baseParams(apiKey) {
  const params = new URLSearchParams();
  params.append('agent', AGENT);
  params.append('apikey', apiKey);
  return params;
}

async function findExistingMagnet(apiKey, hash) {
  try {
    const res = await client.get(`${API_BASE}/magnet/status?${baseParams(apiKey).toString()}`, { timeout: 8000 });
    const magnets = res.data?.data?.magnets;
    const list = Array.isArray(magnets) ? magnets : (magnets ? [magnets] : []);
    return list.find(m => String(m.hash || '').toLowerCase() === hash) || null;
  } catch (err) {
    return null;
  }
}

function pickVideoLink(links) {
  const list = (links || []).map(item => (
    typeof item === 'string' ? { link: item, filename: '' } : item
  ));
  const video = list
    .filter(item => VIDEO_EXT.test(item.filename || item.name || ''))
    .sort((a, b) => (b.size || 0) - (a.size || 0));
  return video[0] || list[0] || null;
}

async function checkCache(apiKey, infoHashes) {
  if (!apiKey || !infoHashes || infoHashes.length === 0) return new Set();

  const cachedHashes = new Set();
  const chunkSize = 40;

  for (let i = 0; i < infoHashes.length; i += chunkSize) {
    const chunk = infoHashes.slice(i, i + chunkSize);
    try {
      const params = baseParams(apiKey);
      chunk.forEach(h => params.append('magnets[]', h));

      const res = await client.get(`${API_BASE}/magnet/instant?${params.toString()}`, { timeout: 5000 });
      if (res.data?.status === 'success' && Array.isArray(res.data?.data?.magnets)) {
        for (const item of res.data.data.magnets) {
          if (item.instant && item.hash) {
            cachedHashes.add(item.hash.toLowerCase());
          }
        }
      }
    } catch (err) {
      console.warn(`[AllDebrid] Cache check error: ${err.message}`);
    }
  }

  return cachedHashes;
}

async function resolveStream(apiKey, infoHash) {
  const hash = String(infoHash).toLowerCase();
  const magnet = `magnet:?xt=urn:btih:${hash}`;

  // 1. Reuse an existing magnet when possible.
  let magnetId = null;
  const existing = await findExistingMagnet(apiKey, hash);
  if (existing) {
    magnetId = existing.id;
  } else {
    try {
      const uploadRes = await client.get(
        `${API_BASE}/magnet/upload?agent=${AGENT}&apikey=${apiKey}&magnet=${encodeURIComponent(magnet)}`,
        { timeout: 8000 }
      );
      magnetId = uploadRes.data?.data?.magnets?.[0]?.id;
    } catch (err) {
      const retryMatch = await findExistingMagnet(apiKey, hash);
      magnetId = retryMatch?.id;
      if (!magnetId) throw new DebridError('AllDebrid', 'failed to upload magnet');
    }
  }

  if (!magnetId) throw new DebridError('AllDebrid', 'failed to upload magnet');

  // 2. Poll until AllDebrid reports the magnet as ready.
  const ready = await pollUntil(async () => {
    const params = baseParams(apiKey);
    params.append('id', magnetId);

    const statusRes = await client.get(`${API_BASE}/magnet/status?${params.toString()}`, { timeout: 8000 });
    const data = statusRes.data?.data?.magnets;
    const info = Array.isArray(data) ? data[0] : data;

    if (!info) return null;

    const statusCode = Number(info.statusCode);
    const statusText = String(info.status || '');

    if (statusCode === 5 || /error|fail/i.test(statusText)) {
      throw new DebridError('AllDebrid', `magnet status is "${statusText || statusCode}"`);
    }

    const isReady = statusCode === 4 || /ready/i.test(statusText);
    const links = info.links || [];
    if (isReady && links.length > 0) return info;
    return null;
  }, debridPollOptions());

  if (!ready) throw new DebridPendingError('AllDebrid', 5);

  // 3. Unlock the largest video link.
  const chosen = pickVideoLink(ready.links);
  const linkToUnlock = chosen?.link;
  if (!linkToUnlock) throw new DebridError('AllDebrid', 'no download link available');

  const unlockRes = await client.get(
    `${API_BASE}/link/unlock?agent=${AGENT}&apikey=${apiKey}&link=${encodeURIComponent(linkToUnlock)}`,
    { timeout: 8000 }
  );

  return unlockRes.data?.data?.link || null;
}

module.exports = {
  id: 'alldebrid',
  name: 'AllDebrid',
  checkCache,
  resolveStream
};
