/**
 * Raised when a Debrid provider accepted the torrent but has not finished
 * downloading it yet. The HTTP layer turns this into a 503 + Retry-After
 * response instead of a hard failure.
 */
class DebridPendingError extends Error {
  constructor(provider, retryAfter = 5) {
    super(`${provider}: torrent is still processing`);
    this.name = 'DebridPendingError';
    this.provider = provider;
    this.retryAfter = retryAfter;
    this.statusCode = 503;
  }
}

/**
 * Raised for provider-side fatal errors (dead torrent, missing file, etc.).
 */
class DebridError extends Error {
  constructor(provider, message) {
    super(`${provider}: ${message}`);
    this.name = 'DebridError';
    this.provider = provider;
    this.statusCode = 502;
  }
}

module.exports = {
  DebridPendingError,
  DebridError
};
