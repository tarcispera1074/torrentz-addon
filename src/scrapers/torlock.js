const { searchPage } = require('./community');

async function search(query) {
  const slug = encodeURIComponent(String(query).trim().toLowerCase().replace(/\s+/g, '-'));
  return searchPage(`https://www.torlock.com/all/torrents/${slug}.html`, 'TorLock', { timeout: 7000 });
}

module.exports = { id: 'torlock', name: 'TorLock', search };
