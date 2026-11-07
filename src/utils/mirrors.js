const FAILURE_THRESHOLD = 3;
// Keep transient failures from hiding a source for most of a user session.
const COOLDOWN_MS = 60 * 1000;

const failures = new Map();

function hostOf(mirror) {
  try {
    return new URL(mirror).host;
  } catch (err) {
    return mirror;
  }
}

/**
 * A mirror is skipped for COOLDOWN_MS after FAILURE_THRESHOLD consecutive
 * failures, so dead domains are not probed on every single request.
 */
function canUse(mirror) {
  const host = hostOf(mirror);
  const state = failures.get(host);
  if (!state) return true;

  if (state.until) {
    if (Date.now() >= state.until) {
      failures.delete(host);
      return true;
    }
    return false;
  }

  return state.count < FAILURE_THRESHOLD;
}

function markFailure(mirror) {
  const host = hostOf(mirror);
  const state = failures.get(host) || { count: 0, until: 0 };
  state.count += 1;
  if (state.count >= FAILURE_THRESHOLD) {
    state.until = Date.now() + COOLDOWN_MS;
  }
  failures.set(host, state);
}

function markSuccess(mirror) {
  failures.delete(hostOf(mirror));
}

function reset() {
  failures.clear();
}

module.exports = {
  canUse,
  markFailure,
  markSuccess,
  reset
};
