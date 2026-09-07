import http from 'node:http';
import { readFile } from 'node:fs/promises';

// Test-only loopback server. Never exposes a directory or application endpoints.
const allowed = new Map([
  ['/test/fixtures/phase12-component-lab.html', ['../test/fixtures/phase12-component-lab.html', 'text/html; charset=utf-8']],
  ['/test/fixtures/phase12-chart-states.html', ['../test/fixtures/phase12-chart-states.html', 'text/html; charset=utf-8']],
  ...['tokens.css', 'foundation.css', 'components.css', 'components.js', 'overview.css', 'overview.js', 'charts.js'].map(name => [
    `/public/ui/v3/${name}`, [`../public/ui/v3/${name}`, name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8']
  ])
]);
const server = http.createServer(async (request, response) => {
  const entry = allowed.get(request.url);
  if (request.method !== 'GET' || !entry) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  try {
    const body = await readFile(new URL(entry[0], import.meta.url));
    response.writeHead(200, {
      'Content-Type': entry[1], 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-ancestors 'none'"
    });
    response.end(body);
  } catch {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Fixture unavailable');
  }
});
server.listen(3099, '127.0.0.1', () => process.stdout.write('Component lab: http://127.0.0.1:3099/test/fixtures/phase12-component-lab.html\n'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
