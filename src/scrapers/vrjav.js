const { makeJavScraper } = require('./jav');
module.exports = makeJavScraper('vrjav', 'VRJAV', q => `https://vrjav.net/search/${encodeURIComponent(q)}`);
