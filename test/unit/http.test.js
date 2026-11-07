const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { requestHtml } = require('../../src/utils/http');
const { installAdapter } = require('../helpers/mockHttp');

let restoreAdapter;
let originalPost;
let originalFlareSolverrUrl;

beforeEach(() => {
  originalPost = axios.post;
  originalFlareSolverrUrl = process.env.FLARESOLVERR_URL;
  delete process.env.FLARESOLVERR_URL;
});

afterEach(() => {
  if (restoreAdapter) {
    restoreAdapter();
    restoreAdapter = null;
  }
  axios.post = originalPost;
  if (originalFlareSolverrUrl === undefined) delete process.env.FLARESOLVERR_URL;
  else process.env.FLARESOLVERR_URL = originalFlareSolverrUrl;
});

test('requestHtml returns an ordinary successful page without invoking FlareSolverr', async () => {
  restoreAdapter = installAdapter(() => ({ data: '<html><title>Results</title></html>' }));
  axios.post = async () => assert.fail('FlareSolverr should not be called for an ordinary page');

  const response = await requestHtml('https://indexer.example/search', { timeout: 1000 });

  assert.equal(response.status, 200);
  assert.match(response.data, /Results/);
});

for (const status of [403, 429]) {
  test(`requestHtml retries HTTP ${status} through FlareSolverr`, async () => {
    restoreAdapter = installAdapter(() => ({ status, data: 'blocked' }));
    process.env.FLARESOLVERR_URL = 'http://solver.example:8191/';
    let solverRequest;
    axios.post = async (...args) => {
      solverRequest = args;
      return { data: { solution: { status: 200, response: '<html><title>Results</title></html>' } } };
    };

    const response = await requestHtml('https://indexer.example/search', { timeout: 1000 });

    assert.equal(response.status, 200);
    assert.match(response.data, /Results/);
    assert.equal(solverRequest[0], 'http://solver.example:8191/v1');
    assert.equal(solverRequest[1].cmd, 'request.get');
    assert.equal(solverRequest[1].url, 'https://indexer.example/search');
  });
}

test('requestHtml recognizes an HTTP 200 challenge shell and retries it', async () => {
  restoreAdapter = installAdapter(() => ({
    status: 200,
    data: '<!doctype html><html><head><title>Loading...</title></head><body></body></html>'
  }));
  process.env.FLARESOLVERR_URL = 'http://solver.example:8191';
  let solverCalls = 0;
  axios.post = async () => {
    solverCalls += 1;
    return { data: { solution: { status: 200, response: '<html><body>Search results</body></html>' } } };
  };

  const response = await requestHtml('https://indexer.example/search', { timeout: 1000 });

  assert.equal(solverCalls, 1);
  assert.match(response.data, /Search results/);
});

test('requestHtml preserves a blocked HTTP error if no solver is configured', async () => {
  restoreAdapter = installAdapter(() => ({ status: 403, data: 'blocked' }));

  await assert.rejects(
    requestHtml('https://indexer.example/search', { timeout: 1000 }),
    error => error.code === 'HTTP_CHALLENGE'
  );
});

test('requestHtml rejects a challenge when FlareSolverr returns another challenge', async () => {
  restoreAdapter = installAdapter(() => ({
    status: 200,
    data: '<!doctype html><html><head><title>Loading...</title></head><body></body></html>'
  }));
  process.env.FLARESOLVERR_URL = 'http://solver.example:8191';
  axios.post = async () => ({
    data: { solution: { status: 200, response: '<html><title>Just a moment...</title></html>' } }
  });

  await assert.rejects(
    requestHtml('https://indexer.example/search', { timeout: 1000 }),
    error => error.code === 'SCRAPER_CHALLENGE'
  );
});
