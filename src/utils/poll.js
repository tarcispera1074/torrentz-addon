function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll an async function until it returns a truthy value or the retry budget
 * is exhausted.
 *
 * @param {(attempt: number) => Promise<any>} fn
 * @param {{attempts?: number, baseDelay?: number, maxDelay?: number}} options
 * @returns {Promise<any|null>}
 */
async function pollUntil(fn, { attempts = 8, baseDelay = 750, maxDelay = 4000 } = {}) {
  let lastResult = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    lastResult = await fn(attempt);
    if (lastResult) return lastResult;

    if (attempt < attempts - 1) {
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      await sleep(delay + Math.floor(Math.random() * 250));
    }
  }

  return null;
}

/**
 * Poll budget derived from DEBRID_WAIT_MS (default 15s).
 */
function debridPollOptions() {
  const total = parseInt(process.env.DEBRID_WAIT_MS, 10);
  const budget = Number.isFinite(total) && total > 0 ? total : 15000;
  return {
    attempts: Math.max(1, Math.ceil(budget / 1500)),
    baseDelay: 750,
    maxDelay: 4000
  };
}

module.exports = {
  sleep,
  pollUntil,
  debridPollOptions
};
