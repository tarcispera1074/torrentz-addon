const { searchPage } = require('./community');

async function search(query) {
  return searchPage(`https://myporn.club/s/${encodeURIComponent(query)}`, 'MyPornClub', { timeout: 8000 });
}

module.exports = { id: 'mypornclub', name: 'MyPornClub', search };
