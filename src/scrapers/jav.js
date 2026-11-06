const { searchPage } = require('./community');

/** Build a small provider adapter for JAV sites with search pages. */
function makeJavScraper(id, name, urlBuilder) {
  return {
    id,
    name,
    async search(query) {
      return searchPage(urlBuilder(query), name, { timeout: 9000 });
    }
  };
}

module.exports = { makeJavScraper };
