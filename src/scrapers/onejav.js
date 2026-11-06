const { makeJavScraper } = require('./jav');
module.exports = makeJavScraper('onejav', 'OneJAV', q => `https://onejav.com/search/${encodeURIComponent(q)}`);
