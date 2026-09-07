// Read-only static asset check; does not call business APIs or execute application code.
const base = new URL(process.argv[2] || 'http://127.0.0.1:3000/');
if (!['127.0.0.1','localhost'].includes(base.hostname)) throw new Error('Loopback URL required');
const pending = [base.href], seen = new Set(), failures = [], external = [];
let bytes = 0;
while (pending.length) {
  const url = pending.shift();
  if (seen.has(url)) continue;
  seen.add(url);
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) { failures.push({path:new URL(url).pathname,status:response.status}); continue; }
  const content = await response.text();
  bytes += Buffer.byteLength(content);
  const paths = url === base.href
    ? [...content.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(match=>match[1])
    : new URL(url).pathname.endsWith('.js') && !new URL(url).pathname.startsWith('/vendor/')
      ? [...content.matchAll(/(?:from\s*|import\s*\()(['"])(\.{1,2}\/[^'"]+)\1/g)].map(match=>match[2]) : [];
  for (const path of paths) {
    const asset = new URL(path,url);
    if (asset.origin !== base.origin) external.push(asset.origin);
    else pending.push(asset.href);
  }
}
console.log(JSON.stringify({checked:seen.size,static_text_bytes:bytes,failed:failures,external_asset_origins:[...new Set(external)]},null,2));
if (failures.length || external.length) process.exitCode=1;
