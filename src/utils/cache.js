class Cache {
  constructor(defaultTTLMs = 60 * 60 * 1000) { // 1 hour default
    this.store = new Map();
    this.defaultTTL = defaultTTLMs;
  }

  get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, ttlMs = this.defaultTTL) {
    // Basic eviction if memory grows too big (keep at most 2000 entries)
    if (this.store.size >= 2000) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  clear() {
    this.store.clear();
  }
}

module.exports = new Cache();
