const { test } = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../../src/utils/cache');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('cache returns values before the TTL expires and drops them after', async () => {
  cache.clear();
  cache.set('ttl:key', { value: 1 }, 20);

  assert.deepEqual(cache.get('ttl:key'), { value: 1 });
  await sleep(40);
  assert.equal(cache.get('ttl:key'), null);
});

test('cache evicts the oldest entry when it exceeds 2000 items', () => {
  cache.clear();

  for (let i = 0; i < 2000; i++) {
    cache.set(`evict:${i}`, i, 60_000);
  }
  assert.equal(cache.get('evict:0'), 0);

  cache.set('evict:2000', 2000, 60_000);

  assert.equal(cache.get('evict:0'), null);
  assert.equal(cache.get('evict:2000'), 2000);
});
