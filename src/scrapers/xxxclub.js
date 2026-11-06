const { searchPage } = require('./community');

async function search(query) {
  // XXXClub's browse pages are public; its search endpoint currently returns a
  // generic error to automated requests, so use the newest FullHD listing.
  return searchPage('https://xxxclub.to/torrents/browse/2/', 'XXXClub', { timeout: 8000 });
}

module.exports = { id: 'xxxclub', name: 'XXXClub', search };
