const { makeJavScraper } = require('./jav');
module.exports = makeJavScraper('projectjav', 'Project JAV', q => `https://projectjav.com/search/${encodeURIComponent(q)}`);
