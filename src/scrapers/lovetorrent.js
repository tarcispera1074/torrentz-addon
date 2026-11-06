const { searchPage } = require('./community');

async function search(query) {
  return searchPage(`https://lovetorrent.net/search/${encodeURIComponent(query)}`, 'LoveTorrent', { timeout: 8000 });
}

module.exports = { id: 'lovetorrent', name: 'LoveTorrent', search };
