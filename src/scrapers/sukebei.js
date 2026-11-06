const { searchPage } = require('./community');

async function search(query) {
  return searchPage(
    `https://sukebei.nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(query)}`,
    'Sukebei Nyaa',
    { timeout: 9000 }
  );
}

module.exports = { id: 'sukebei', name: 'Sukebei Nyaa', search };
