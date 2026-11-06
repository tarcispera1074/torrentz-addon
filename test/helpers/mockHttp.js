const { client } = require('../../src/utils/http');

/**
 * Install a deterministic Axios adapter for the shared HTTP client.
 * Returns a restore function.
 */
function installAdapter(handler) {
  const original = client.defaults.adapter;

  client.defaults.adapter = async (config) => {
    const result = await handler(config);
    const status = result?.status ?? 200;

    return {
      data: result?.data,
      status,
      statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
      headers: result?.headers || {},
      config,
      request: { path: config.url }
    };
  };

  return () => {
    client.defaults.adapter = original;
  };
}

module.exports = {
  installAdapter
};
