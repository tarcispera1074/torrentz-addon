const { searchPage } = require('./community');

async function search(query) {
  // The public site currently exposes its search pages only after login. Keep
  // this provider selectable and fail closed when no public magnets are served.
  return searchPage(`https://pussytorrents.org/?search=${encodeURIComponent(query)}`, 'PussyTorrents', { timeout: 6000 });
}

module.exports = { id: 'pussytorrents', name: 'PussyTorrents', search };
