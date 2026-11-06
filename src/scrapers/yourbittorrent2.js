const { searchPage } = require('./community');

async function search(query) {
  return searchPage(`https://yourbittorrent2.com/search?q=${encodeURIComponent(query)}`, 'YourBittorrent2', { timeout: 7000 });
}

module.exports = { id: 'yourbittorrent2', name: 'YourBittorrent2', search };
