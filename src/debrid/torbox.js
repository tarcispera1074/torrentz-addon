const { client } = require('../utils/http');
const { pollUntil, debridPollOptions } = require('../utils/poll');
const { DebridPendingError, DebridError } = require('./errors');

const API_BASE = 'https://api.torbox.app/v1/api';
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|wmv|m4v|webm|flv)$/i;

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

/**
 * Check which infohashes are cached on TorBox
 */
async function checkCache(apiKey, infoHashes) {
  if (!apiKey || !infoHashes || infoHashes.length === 0) return new Set();

  const cachedHashes = new Set();
  try {
    const hashesParam = infoHashes.join(',');
    const url = `${API_BASE}/torrents/checkcached?hash=${hashesParam}&format=list`;
    const res = await client.get(url, {
      headers: authHeaders(apiKey),
      timeout: 6000
    });

    if (res.data?.success) {
      const data = res.data.data;
      if (Array.isArray(data)) {
        data.forEach(item => {
          if (typeof item === 'string') {
            cachedHashes.add(item.toLowerCase());
          } else if (item && item.hash) {
            // If item has cached property, verify it's true
            if (item.cached === undefined || item.cached === true) {
              cachedHashes.add(item.hash.toLowerCase());
            }
          }
        });
      } else if (typeof data === 'object' && data !== null) {
        for (const [h, val] of Object.entries(data)) {
          if (val === true || (val && val.cached !== false)) {
            cachedHashes.add(h.toLowerCase());
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[TorBox] Cache check error: ${err.message}`);
  }

  return cachedHashes;
}

async function getTorrentList(apiKey) {
  try {
    const listRes = await client.get(`${API_BASE}/torrents/mylist`, {
      headers: authHeaders(apiKey),
      timeout: 8000
    });
    return Array.isArray(listRes.data?.data) ? listRes.data.data : [];
  } catch (err) {
    return [];
  }
}

function findTorrent(list, hash, torrentId) {
  return list.find(t =>
    (torrentId && String(t.id) === String(torrentId)) ||
    (t.hash && String(t.hash).toLowerCase() === hash)
  ) || null;
}

function pickVideoFile(files) {
  const videoFiles = (files || [])
    .filter(f => VIDEO_EXT.test(f.name || f.short_name || ''))
    .sort((a, b) => (b.size || 0) - (a.size || 0));
  return videoFiles[0] || (files || [])[0] || null;
}

function isReady(torrent) {
  if (!torrent) return false;
  if (torrent.download_finished === true || torrent.download_present === true) return true;
  return /completed|uploaded|finished/i.test(String(torrent.download_state || ''));
}

/**
 * Resolve torrent hash to a direct streamable HTTP URL using TorBox
 */
async function resolveStream(apiKey, infoHash) {
  const hash = String(infoHash).toLowerCase();

  // 1. Look for an existing torrent in the account first.
  let list = await getTorrentList(apiKey);
  let torrent = findTorrent(list, hash, null);

  // 2. Add the magnet when it is not already present.
  let torrentId = torrent?.id || null;
  if (!torrentId) {
    try {
      const params = new URLSearchParams();
      params.append('magnet', `magnet:?xt=urn:btih:${hash}`);
      params.append('seed', '1');
      params.append('allow_zip', 'false');

      const createRes = await client.post(`${API_BASE}/torrents/createtorrent`, params.toString(), {
        headers: {
          ...authHeaders(apiKey),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 8000
      });

      torrentId = createRes.data?.data?.torrent_id;
    } catch (err) {
      // The torrent may already exist; fall through to the list lookup.
      console.log('[TorBox] createtorrent info:', err.response?.data?.detail || err.message);
    }
  }

  // 3. Poll until TorBox reports the download as finished/cached.
  const ready = await pollUntil(async () => {
    list = await getTorrentList(apiKey);
    torrent = findTorrent(list, hash, torrentId);
    if (!torrent) return null;

    torrentId = torrentId || torrent.id;
    if (isReady(torrent)) return torrent;
    return null;
  }, debridPollOptions());

  if (!ready) throw new DebridPendingError('TorBox', 5);

  // 4. Select the best/largest video file.
  const chosenFile = pickVideoFile(ready.files);
  const fileId = chosenFile ? chosenFile.id : 0;
  const resolvedTorrentId = ready.id || torrentId;

  // 5. Request a download link.
  try {
    const dlUrl = `${API_BASE}/torrents/requestdl?token=${encodeURIComponent(apiKey)}&torrent_id=${resolvedTorrentId}&file_id=${fileId}&zip=false`;
    const dlRes = await client.get(dlUrl, { headers: authHeaders(apiKey), timeout: 8000 });

    if (dlRes.data?.data && typeof dlRes.data.data === 'string') {
      return dlRes.data.data;
    }
  } catch (err) {
    console.warn('[TorBox] requestdl error, using direct permalink:', err.message);
  }

  if (!resolvedTorrentId) throw new DebridError('TorBox', 'torrent id unavailable');

  // Fallback to TorBox official permanent redirect link
  return `${API_BASE}/torrents/requestdl?token=${encodeURIComponent(apiKey)}&torrent_id=${resolvedTorrentId}&file_id=${fileId}&redirect=true`;
}

module.exports = {
  id: 'torbox',
  name: 'TorBox',
  checkCache,
  resolveStream
};
