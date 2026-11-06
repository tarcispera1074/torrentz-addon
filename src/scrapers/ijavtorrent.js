const { makeJavScraper } = require('./jav');
module.exports = makeJavScraper('ijavtorrent', 'iJavTorrent', q => `https://ijavtorrent.com/search/${encodeURIComponent(q)}`);
