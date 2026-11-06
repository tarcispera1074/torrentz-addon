const { client } = require('../utils/http');
const { pollUntil, debridPollOptions } = require('../utils/poll');
const { DebridPendingError, DebridError } = require('./errors');

const API_BASE = 'https://api.real-debrid.com/rest/1.0';
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|m4v|webm|flv)$/i;

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

function formHeaders(apiKey) {
  return {
    ...authHeaders(apiKey),
    'Content-Type': 'application/x-www-form-urlencoded'
  };
}

async function findExistingTorrent(apiKey, hash) {
  try {
    const res = await client.get(`${API_BASE}/torrents`, {
      headers: authHeaders(apiKey),
      timeout: 8000
    });
    if (Array.isArray(res.data)) {
      return res.data.find(t => String(t.hash || '').toLowerCase() === hash) || null;
    }
  } catch (err) {
    // Ignore; we'll try to add the magnet instead.
  }
  return null;
}

function chooseVideoFile(files) {
  const videoFiles = (files || [])
    .filter(f => VIDEO_EXT.test(f.path || ''))
    .sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
  return videoFiles[0] || null;
}

function pickLink(info) {
  const links = info?.links || [];
  if (links.length === 0) return null;

  const files = info?.files || [];
  const chosen = chooseVideoFile(files);
  if (chosen && links.length === files.length) {
    const index = files.indexOf(chosen);
    if (index >= 0 && links[index]) return links[index];
  }

  return links[0];
}

/**
 * Check which infohashes are instantly available (cached) on Real-Debrid
 */
async function checkCache(apiKey, infoHashes) {
  if (!apiKey || !infoHashes || infoHashes.length === 0) return new Set();

  const cachedHashes = new Set();
  const chunkSize = 50; // RD allows batching hashes in URL
  const chunks = [];

  for (let i = 0; i < infoHashes.length; i += chunkSize) {
    chunks.push(infoHashes.slice(i, i + chunkSize));
  }

  for (const chunk of chunks) {
    try {
      const url = `${API_BASE}/torrents/instantAvailability/${chunk.join('/')}`;
      const res = await client.get(url, {
        headers: authHeaders(apiKey),
        timeout: 5000
      });

      if (res.data) {
        for (const [hash, val] of Object.entries(res.data)) {
          if (val && Array.isArray(val.rd) && val.rd.length > 0) {
            cachedHashes.add(hash.toLowerCase());
          }
        }
      }
    } catch (err) {
      console.warn(`[RealDebrid] Cache check error: ${err.message}`);
    }
  }

  return cachedHashes;
}

/**
 * Resolve torrent hash to a direct streamable HTTP URL
 */
async function resolveStream(apiKey, infoHash) {
  const hash = String(infoHash).toLowerCase();

  // 1. Reuse an existing torrent when possible (avoids "already added" errors).
  let torrentId = null;
  const existing = await findExistingTorrent(apiKey, hash);
  if (existing) {
    torrentId = existing.id;
  } else {
    const magnet = `magnet:?xt=urn:btih:${hash}`;
    try {
      const addRes = await client.post(
        `${API_BASE}/torrents/addMagnet`,
        `magnet=${encodeURIComponent(magnet)}`,
        { headers: formHeaders(apiKey), timeout: 8000 }
      );
      torrentId = addRes.data?.id;
    } catch (err) {
      const retryMatch = await findExistingTorrent(apiKey, hash);
      torrentId = retryMatch?.id;
      if (!torrentId) throw new DebridError('Real-Debrid', 'failed to add magnet');
    }
  }

  if (!torrentId) throw new DebridError('Real-Debrid', 'failed to add magnet');

  // 2. Poll until RD reports the torrent as downloaded (selecting a file first
  //    when RD is waiting for file selection).
  let selectionSent = false;

  const ready = await pollUntil(async () => {
    const infoRes = await client.get(`${API_BASE}/torrents/info/${torrentId}`, {
      headers: authHeaders(apiKey),
      timeout: 8000
    });
    const info = infoRes.data || {};
    const status = info.status;

    if (['magnet_error', 'error', 'virus', 'dead'].includes(status)) {
      throw new DebridError('Real-Debrid', `torrent status is "${status}"`);
    }

    if (status === 'waiting_files_selection') {
      if (!selectionSent) {
        const chosen = chooseVideoFile(info.files);
        const fileId = chosen?.id || 'all';
        try {
          await client.post(
            `${API_BASE}/torrents/selectFiles/${torrentId}`,
            `files=${fileId}`,
            { headers: formHeaders(apiKey), timeout: 8000 }
          );
          selectionSent = true;
        } catch (err) {
          // Retry selection on the next poll.
          selectionSent = false;
        }
      }
      return null;
    }

    if (status === 'downloaded' && (info.links || []).length > 0) {
      return info;
    }

    return null;
  }, debridPollOptions());

  if (!ready) throw new DebridPendingError('Real-Debrid', 5);

  const link = pickLink(ready);
  if (!link) throw new DebridError('Real-Debrid', 'no download link available');

  // 3. Unrestrict the selected link.
  const unrestrictRes = await client.post(
    `${API_BASE}/unrestrict/link`,
    `link=${encodeURIComponent(link)}`,
    { headers: formHeaders(apiKey), timeout: 8000 }
  );

  return unrestrictRes.data?.download || null;
}

module.exports = {
  id: 'realdebrid',
  name: 'Real-Debrid',
  checkCache,
  resolveStream
};
