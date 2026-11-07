const { searchPage } = require('./community');
const { client, requestHtml } = require('../utils/http');
const { parseResults } = require('./community');
const { torrentInfoHash } = require('./pornrips');

const DETAIL_TIMEOUT_MS = 5000;
const HOMEPAGE_TIMEOUT_MS = 5000;

/** Build a small provider adapter for JAV sites with search pages. */
function makeJavScraper(id, name, urlBuilder) {
  return {
    id,
    name,
    async search(query) {
      return searchJavPage(urlBuilder(query), name);
    }
  };
}

function makeJavScraperWithFallback(id, name, urls) {
  return {
    id,
    name,
    async search(query) {
      const deadline = Date.now() + 7500;
      for (const urlBuilder of urls) {
        const remaining = deadline - Date.now();
        if (remaining < 1000) break;
        const results = await searchJavPage(urlBuilder(query), name, { timeout: remaining });
        if (results.length > 0) return results;
      }
      return [];
    }
  };
}

async function searchJavPage(url, source, options = {}) {
  const timeout = Math.max(1000, Math.min(9000, options.timeout || 9000));
  try {
    const response = await requestHtml(url, { timeout });
    if (response.status !== 200 || typeof response.data !== 'string') return [];
    const html = response.data;
    const inline = parseResults(html, source);
    if (inline.length > 0) return inline;

    const links = [...html.matchAll(/href=["']([^"']+\.torrent(?:\?[^"']*)?)["']/gi)]
      .map(match => new URL(match[1], new URL(url).origin).href)
      .slice(0, 8);

    // Download candidates in parallel so a page with many links cannot consume
    // the whole search budget one file at a time.
    const settled = await Promise.allSettled(links.map(async link => {
      const torrent = await client.get(link, {
        responseType: 'arraybuffer',
        timeout: Math.min(timeout, DETAIL_TIMEOUT_MS)
      });
      const infoHash = torrentInfoHash(Buffer.from(torrent.data));
      if (!infoHash) return null;
      return {
        rawTitle: link.split('/').pop().replace(/\.torrent.*$/i, ''),
        infoHash,
        sizeBytes: 0,
        seeders: 0,
        source
      };
    }));

    return settled
      .filter(outcome => outcome.status === 'fulfilled' && outcome.value)
      .map(outcome => outcome.value);
  } catch (err) {
    return [];
  }
}

async function searchHomepage(name, homepage, query) {
  try {
    const response = await requestHtml(homepage, { timeout: HOMEPAGE_TIMEOUT_MS });
    if (response.status !== 200 || typeof response.data !== 'string') return [];
    const results = parseResults(response.data, name);
    if (results.length > 0) return results;

    // Some sites expose magnets only on release detail pages. Follow a small,
    // bounded set of public links and never attempt authenticated pages.
    const links = [...new Set([...response.data.matchAll(/href=["']([^"']+)["']/gi)]
      .map(match => match[1])
      .filter(href => /torrent|magnet|detail|download|\/\d+|\/item|\/video|\/product/i.test(href)))]
      .slice(0, 8);

    const origin = new URL(homepage).origin;
    const pages = await Promise.all(
      links.map(href => searchJavPage(new URL(href, origin).href, name, { timeout: DETAIL_TIMEOUT_MS }))
    );

    const found = [];
    const seen = new Set();
    for (const page of pages) {
      for (const item of page) {
        if (seen.has(item.infoHash)) continue;
        seen.add(item.infoHash);
        found.push(item);
        if (found.length >= 50) return found;
      }
    }
    return found;
  } catch (err) {
    return [];
  }
}

module.exports = { makeJavScraper, makeJavScraperWithFallback, searchHomepage };
