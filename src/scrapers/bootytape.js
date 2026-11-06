const { searchPage } = require('./community');

async function search(query) {
  return searchPage(`https://bootytape.com/?q=${encodeURIComponent(query)}`, 'BootyTape', { timeout: 7000 });
}

module.exports = { id: 'bootytape', name: 'BootyTape', search };
