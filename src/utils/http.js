const axios = require('axios');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseProxyUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const protocol = url.protocol.replace(':', '');
    if (protocol.startsWith('socks')) {
      return { type: 'socks', url: rawUrl };
    }
    return {
      type: 'http',
      config: {
        protocol,
        host: url.hostname,
        port: parseInt(url.port, 10) || (protocol === 'https' ? 443 : 80),
        auth: url.username
          ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
          : undefined
      }
    };
  } catch (err) {
    console.warn(`[HTTP] Ignoring invalid proxy URL: ${rawUrl}`);
    return null;
  }
}

const PROXY = parseProxyUrl(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '');

let socksAgent = null;
let socksWarned = false;
if (PROXY && PROXY.type === 'socks') {
  try {
    const { SocksProxyAgent } = require('socks-proxy-agent');
    socksAgent = new SocksProxyAgent(PROXY.url);
  } catch (err) {
    if (!socksWarned) {
      console.warn('[HTTP] SOCKS proxy configured but "socks-proxy-agent" is not installed; ignoring proxy.');
      socksWarned = true;
    }
  }
}

function isNoProxy(host) {
  const raw = process.env.NO_PROXY || process.env.no_proxy || '';
  if (!raw || !host) return false;

  const target = host.toLowerCase();
  for (const entry of raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
    if (entry === '*') return true;
    const entryHost = entry.split(':')[0].replace(/^\./, '');
    if (target === entryHost || target.endsWith(`.${entryHost}`)) return true;
  }
  return false;
}

function proxyForUrl(rawUrl) {
  if (!PROXY) return false;
  try {
    const host = new URL(rawUrl).hostname;
    if (isNoProxy(host)) return false;
  } catch (err) {
    // Relative URL: fall back to using the proxy
  }
  return PROXY.type === 'http' ? PROXY.config : false;
}

const client = axios.create({
  timeout: 8000,
  headers: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': getRandomUserAgent()
  }
});

// Randomize User-Agent, resolve proxy per target (honouring NO_PROXY) and
// attach a SOCKS agent when one was configured.
client.interceptors.request.use((config) => {
  if (!config.headers['User-Agent'] || config.headers['User-Agent'].includes('axios')) {
    config.headers['User-Agent'] = getRandomUserAgent();
  }

  if (config.proxy === undefined) {
    config.proxy = proxyForUrl(config.url || '');
  }

  if (PROXY && PROXY.type === 'socks' && socksAgent) {
    const host = (() => {
      try { return new URL(config.url).hostname; } catch (err) { return ''; }
    })();
    if (!isNoProxy(host)) {
      config.proxy = false;
      config.httpAgent = socksAgent;
      config.httpsAgent = socksAgent;
    }
  }

  return config;
});

// One transparent retry for transient GET failures, but never retry a
// timeout: that would double the latency of already-slow providers.
client.interceptors.response.use(null, async (error) => {
  const config = error.config || {};
  const status = error.response?.status;
  const code = error.code || '';
  const timedOut = code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(error.message || '');
  const retryable = !timedOut && (!error.response || status === 429 || status >= 500);

  if (!retryable || config.method !== 'get' || (config._retryCount || 0) >= 1) {
    return Promise.reject(error);
  }

  config._retryCount = (config._retryCount || 0) + 1;
  await sleep(400 + Math.floor(Math.random() * 600));
  return client.request(config);
});

/**
 * Fetch an HTML page. When FLARESOLVERR_URL is set, retry blocked or challenge
 * pages through FlareSolverr (including HTTP 200 challenge shells).
 */
function isChallengePage(status, body) {
  const text = typeof body === 'string' ? body : '';
  return status === 403 || status === 429 || status === 503 ||
    /cf-browser-verification|__cf_chl|cf-challenge|just a moment|attention required|checking your browser|verify you are human|enable javascript and cookies to continue/i.test(text) ||
    /^\s*(?:<!doctype html>\s*)?<html[^>]*>\s*<head[^>]*>\s*<title>\s*(?:loading|access denied|security check)/i.test(text);
}

async function requestHtml(url, options = {}) {
  let response;
  let originalError;
  try {
    response = await client.get(url, options);
  } catch (err) {
    originalError = err;
    response = err.response;
  }

  const status = response?.status;
  const body = typeof response?.data === 'string' ? response.data : '';
  if (!isChallengePage(status, body)) {
    if (originalError) throw originalError;
    return response;
  }

  const solverUrl = process.env.FLARESOLVERR_URL;
  if (!solverUrl) {
    if (originalError) throw originalError;
    const error = new Error(`HTTP ${status || 200} challenge page from ${new URL(url).host}`);
    error.code = 'HTTP_CHALLENGE';
    throw error;
  }

  const maxTimeout = Math.max(3000, Math.min(Number(options.timeout) || 8000, 10000));
  try {
    const solver = await axios.post(
      `${solverUrl.replace(/\/+$/, '')}/v1`,
      { cmd: 'request.get', url, maxTimeout },
      { timeout: maxTimeout + 5000 }
    );
    const html = solver.data?.solution?.response;
    if (!html || isChallengePage(solver.data?.solution?.status, html)) {
      throw new Error('FlareSolverr did not return an unblocked page');
    }
    return { status: 200, data: html, headers: {}, config: {} };
  } catch (solverError) {
    const error = new Error(`Request blocked and FlareSolverr failed: ${solverError.message}`);
    error.code = 'SCRAPER_CHALLENGE';
    error.cause = originalError || solverError;
    throw error;
  }
}

module.exports = {
  client,
  requestHtml,
  getRandomUserAgent,
  isNoProxy,
  proxyForUrl
};
