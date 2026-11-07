const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installAdapter } = require('../helpers/mockHttp');
const realdebrid = require('../../src/debrid/realdebrid');
const torbox = require('../../src/debrid/torbox');
const { DebridPendingError } = require('../../src/debrid/errors');

const API_KEY = 'test-key';
const HASH = '0123456789abcdef0123456789abcdef01234567';

test('Real-Debrid reuses a downloaded torrent and unrestricts the video link', async () => {
  const restore = installAdapter(config => {
    const url = String(config.url);

    if (url.endsWith('/torrents/instantAvailability/' + HASH)) {
      return { data: { [HASH]: { rd: [{ 0: { filename: 'movie.mkv' } }] } } };
    }
    if (url.endsWith('/torrents')) {
      return { data: [] };
    }
    if (url.endsWith('/torrents/addMagnet')) {
      return { data: { id: 'torrent-1' } };
    }
    if (url.endsWith('/torrents/info/torrent-1')) {
      return {
        data: {
          status: 'downloaded',
          files: [{ id: 0, path: 'movie.mkv', bytes: 100 }],
          links: ['https://debrid.example/file']
        }
      };
    }
    if (url.endsWith('/unrestrict/link')) {
      return { data: { download: 'https://cdn.example/direct.mkv' } };
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  });

  try {
    const url = await realdebrid.resolveStream(API_KEY, HASH);
    assert.equal(url, 'https://cdn.example/direct.mkv');
  } finally {
    restore();
  }
});

test('Real-Debrid throws a pending error while the torrent is processing', async () => {
  const previousBudget = process.env.DEBRID_WAIT_MS;
  process.env.DEBRID_WAIT_MS = '1';

  const restore = installAdapter(config => {
    const url = String(config.url);

    if (url.endsWith('/torrents')) return { data: [] };
    if (url.endsWith('/torrents/addMagnet')) return { data: { id: 'torrent-2' } };
    if (url.endsWith('/torrents/info/torrent-2')) {
      return { data: { status: 'downloading', files: [], links: [] } };
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  });

  try {
    await assert.rejects(
      () => realdebrid.resolveStream(API_KEY, HASH),
      err => err instanceof DebridPendingError && err.statusCode === 503
    );
  } finally {
    restore();
    if (previousBudget === undefined) {
      delete process.env.DEBRID_WAIT_MS;
    } else {
      process.env.DEBRID_WAIT_MS = previousBudget;
    }
  }
});

test('TorBox resolves a just-added cached torrent using fresh list data and its cached state', async () => {
  const calls = [];
  const restore = installAdapter(config => {
    const url = new URL(String(config.url));
    calls.push(url);

    if (url.pathname.endsWith('/torrents/mylist')) {
      assert.equal(url.searchParams.get('bypass_cache'), 'true');
      if (!url.searchParams.has('id')) return { data: { success: true, data: [] } };
      assert.equal(url.searchParams.get('id'), '99');
      return {
        data: {
          success: true,
          data: {
            id: 99,
            hash: HASH,
            download_state: 'cached',
            files: [{ id: 7, name: 'Example.Movie.1080p.mkv', size: 1000 }]
          }
        }
      };
    }

    if (url.pathname.endsWith('/torrents/createtorrent')) {
      return { data: { success: true, data: { torrent_id: 99 } } };
    }

    if (url.pathname.endsWith('/torrents/requestdl')) {
      assert.equal(url.searchParams.get('torrent_id'), '99');
      assert.equal(url.searchParams.get('file_id'), '7');
      return { data: { success: true, data: 'https://cdn.torbox.example/video.mkv' } };
    }

    throw new Error(`Unexpected URL in test: ${url}`);
  });

  try {
    const streamUrl = await torbox.resolveStream(API_KEY, HASH);
    assert.equal(streamUrl, 'https://cdn.torbox.example/video.mkv');
    assert.equal(calls.filter(url => url.pathname.endsWith('/torrents/mylist')).length, 2);
  } finally {
    restore();
  }
});
