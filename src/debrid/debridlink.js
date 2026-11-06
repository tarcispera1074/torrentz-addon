const { client } = require('../utils/http');
const { pollUntil, debridPollOptions } = require('../utils/poll');
const { DebridPendingError, DebridError } = require('./errors');

const API_BASE = 'https://debrid-link.com/api/v2';
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|m4v|webm|flv)$/i;

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

async function checkCache(apiKey, infoHashes) {
  if (!apiKey || !infoHashes || infoHashes.length === 0) return new Set();

  const cachedHashes = new Set();
  try {
    const res = await client.get(`${API_BASE}/seedbox/cached?url=${infoHashes.join(',')}`, {
      headers: authHeaders(apiKey),
      timeout: 5000
    });

    if (res.data?.success && res.data?.value) {
      for (const [hash, isCached] of Object.entries(res.data.value)) {
        if (isCached) {
          cachedHashes.add(hash.toLowerCase());
        }
      }
    }
  } catch (err) {
    console.warn(`[DebridLink] Cache check error: ${err.message}`);
  }

  return cachedHashes;
}

function pickVideo(files) {
  const videoFiles = (files || [])
    .filter(f => VIDEO_EXT.test(f.name || f.path || ''))
    .sort((a, b) => (b.size || 0) - (a.size || 0));
  return videoFiles[0] || (files || [])[0] || null;
}

function findSeedboxItem(list, hash, id) {
  return (list || []).find(item =>
    (id && String(item.id) === String(id)) ||
    (item.hash && String(item.hash).toLowerCase() === hash)
  ) || null;
}

async function resolveStream(apiKey, infoHash) {
  const hash = String(infoHash).toLowerCase();
  const headers = authHeaders(apiKey);

  // 1. Add the magnet (or reuse the existing seedbox entry).
  let itemId = null;
  let immediateFiles = [];

  try {
    const addRes = await client.post(`${API_BASE}/seedbox/add`, {
      url: `magnet:?xt=urn:btih:${hash}`,
      async: false
    }, { headers, timeout: 8000 });

    itemId = addRes.data?.value?.id || null;
    immediateFiles = addRes.data?.value?.files || [];
  } catch (err) {
    // Ignore and fall back to the seedbox list lookup.
  }

  const immediate = pickVideo(immediateFiles);
  if (immediate?.downloadUrl) return immediate.downloadUrl;

  // 2. Poll the seedbox list until the files (and download URLs) are ready.
  const ready = await pollUntil(async () => {
    try {
      const listRes = await client.get(`${API_BASE}/seedbox/list`, { headers, timeout: 8000 });
      const list = Array.isArray(listRes.data?.value) ? listRes.data.value : [];
      const item = findSeedboxItem(list, hash, itemId);
      if (!item) return null;

      itemId = itemId || item.id;
      const file = pickVideo(item.files);
      if (file?.downloadUrl) return file;
      return null;
    } catch (err) {
      return null;
    }
  }, debridPollOptions());

  if (!ready) throw new DebridPendingError('Debrid-Link', 5);
  return ready.downloadUrl;
}

module.exports = {
  id: 'debridlink',
  name: 'Debrid-Link',
  checkCache,
  resolveStream
};
