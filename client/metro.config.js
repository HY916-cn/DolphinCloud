// npm run web: Metro also forwards the API paths to a running container (DOLPHIN_DEV_API, default the local
// test container on https://localhost:18444), so in development the app and the API share one origin as in production.
const { getDefaultConfig } = require('expo/metro-config');
const https = require('node:https');

const config = getDefaultConfig(__dirname);
const api = new URL(process.env.DOLPHIN_DEV_API ?? 'https://localhost:18444');
const proxied = /^\/(auth|rest|storage)\/v1\/|^\/config\.js$/;

config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  if (!proxied.test(req.url)) return middleware(req, res, next);
  const upstream = https.request(
    // The local container uses Caddy's own CA, which this machine does not trust.
    { host: api.hostname, port: api.port, path: req.url, method: req.method, headers: { ...req.headers, host: api.host }, rejectUnauthorized: false },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
  );
  upstream.on('error', (e) => { res.statusCode = 502; res.end(String(e)); });
  req.pipe(upstream);
};

module.exports = config;
