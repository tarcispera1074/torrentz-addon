const { searchPage } = require('./community');
const { requestHtml } = require('../utils/http');
const { parseResults } = require('./community');
const { torrentInfoHash } = require('./pornrips');

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
      for (const urlBuilder of urls) {
        const results = await searchJavPage(urlBuilder(query), name);
        if (results.length > 0) return results;
      }
      return [];
    }
  };
}

async function searchJavPage(url, source) {
  try {
    const response = await requestHtml(url, { timeout: 9000 });
    if (response.status !== 200 || typeof response.data !== 'string') return [];
    const html = response.data;
    const inline = parseResults(html, source);
    if (inline.length > 0) return inline;

    const links = [...html.matchAll(/href=["']([^"']+\.torrent(?:\?[^"']*)?)["']/gi)]
      .map(match => new URL(match[1], new URL(url).origin).href)
      .slice(0, 30);
    const results = [];
    for (const link of links) {
      try {
        const torrent = await require('../utils/http').client.get(link, { responseType: 'arraybuffer', timeout: 9000 });
        const infoHash = torrentInfoHash(Buffer.from(torrent.data));
        if (!infoHash) continue;
        results.push({ rawTitle: link.split('/').pop().replace(/\.torrent.*$/i, ''), infoHash, sizeBytes: 0, seeders: 0, source });
      } catch (err) {
        // Continue with other public releases.
      }
    }
    return results;
  } catch (err) {
    return [];
  }
}

async function searchHomepage(name, homepage, query) {
  try {
    const response = await requestHtml(homepage, { timeout: 9000 });
    if (response.status !== 200 || typeof response.data !== 'string') return [];
    const results = parseResults(response.data, name);
    if (results.length > 0) return results;

    // Some sites expose magnets only on release detail pages. Follow a small,
    // bounded set of public links and never attempt authenticated pages.
    const links = [...response.data.matchAll(/href=["']([^"']+)["']/gi)]
      .map(match => match[1])
      .filter(href => /torrent|magnet|detail|download|\/\d+|\/item|\/video|\/product/i.test(href))
      .slice(0, 12);
    const origin = new URL(homepage).origin;
    const found = [];
    for (const href of links) {
      const page = await searchJavPage(new URL(href, origin).href, name);
      found.push(...page);
      if (found.length >= 50) break;
    }
    return found;
  } catch (err) {
    return [];
  }
}

module.exports = { makeJavScraper, makeJavScraperWithFallback, searchHomepage };
