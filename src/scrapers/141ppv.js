const { makeJavScraper } = require('./jav');
module.exports = makeJavScraper('141ppv', '141PPV', q => `https://141ppv.com/search/${encodeURIComponent(q)}`);
