const { makeJavScraper } = require('./jav');
module.exports = makeJavScraper('ffjav', 'FFJAV', q => `https://ffjav.com/search/${encodeURIComponent(q)}`);
