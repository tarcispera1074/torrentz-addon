require('dotenv').config();

const { test } = require('node:test');
const assert = require('node:assert/strict');
const torbox = require('../../src/debrid/torbox');

const API_KEY = process.env.TORBOX_API_KEY;
const skip = API_KEY ? false : 'set TORBOX_API_KEY in .env to run live tests';

// Widely cached release; only used to verify the cache-check contract.
const INCEPTION_HASH = '224bf45881252643dfc2e71abc7b2660a21c68c4';

test('TorBox live cache check returns a Set of hashes', { skip }, async () => {
  const cached = await torbox.checkCache(API_KEY, [INCEPTION_HASH]);

  assert.ok(cached instanceof Set);
  assert.ok(cached.has(INCEPTION_HASH), 'expected Inception to be cached');
});
