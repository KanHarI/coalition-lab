/** Static Firebase Hosting deployment using the active gcloud identity.
 * Access tokens stay in memory and never appear in argv, files, or logs.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const [project, site, domain] = process.argv.slice(2);
if (!project || !site) throw new Error('Usage: node scripts/deploy-hosting.mjs PROJECT SITE [DOMAIN]');
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
async function request(url, method = 'GET', body, raw = false) {
  const response = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': project, 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Google API HTTP ${response.status}: ${text}`);
    error.status = response.status;
    throw error;
  }
  return !raw && text ? JSON.parse(text) : {};
}
async function exists(url) {
  try { await request(url); return true; }
  catch (error) { if (error.status === 404) return false; throw error; }
}
const management = 'https://firebase.googleapis.com/v1beta1';
if (!await exists(`${management}/projects/${project}`)) {
  let operation = await request(`${management}/projects/${project}:addFirebase`, 'POST', {});
  console.log('Adding Firebase Hosting support to the Google Cloud project…');
  for (let i = 0; !operation.done && i < 120; i++) {
    await delay(2000);
    operation = await request(`${management}/${operation.name}`);
  }
  if (!operation.done || operation.error) throw new Error(`Firebase project setup incomplete: ${JSON.stringify(operation)}`);
}
const hosting = 'https://firebasehosting.googleapis.com/v1beta1';
const sitePath = `projects/${project}/sites/${site}`;
if (!await exists(`${hosting}/${sitePath}`)) {
  await request(`${hosting}/projects/${project}/sites?siteId=${encodeURIComponent(site)}`, 'POST', {});
  console.log(`Created static Hosting site ${site}`);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const files = {}, payloads = new Map();
for (const path of walk('out')) {
  const zipped = gzipSync(readFileSync(path));
  const hash = createHash('sha256').update(zipped).digest('hex');
  files[`/${relative('out', path).split('\\').join('/')}`] = hash;
  payloads.set(hash, zipped);
}
const version = await request(`${hosting}/sites/${site}/versions`, 'POST', {
  config: { headers: [
    { glob: '**', headers: { 'Cache-Control': 'public,max-age=60' } },
    { glob: '/_next/static/**', headers: { 'Cache-Control': 'public,max-age=31536000,immutable' } },
  ] },
});
const entries = Object.entries(files);
for (let start = 0; start < entries.length; start += 1000) {
  const upload = await request(`${hosting}/${version.name}:populateFiles`, 'POST', { files: Object.fromEntries(entries.slice(start, start + 1000)) });
  for (const hash of upload.uploadRequiredHashes || []) {
    const url = new URL(upload.uploadUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'upload-firebasehosting.googleapis.com') throw new Error('Unexpected upload destination');
    await request(`${upload.uploadUrl}/${hash}`, 'POST', payloads.get(hash), true);
  }
}
await request(`${hosting}/${version.name}?updateMask=status`, 'PATCH', { status: 'FINALIZED' });
const release = await request(`${hosting}/sites/${site}/releases?versionName=${encodeURIComponent(version.name)}`, 'POST', {});
console.log(JSON.stringify({ url: `https://${site}.web.app`, version: version.name, release: release.name, files: entries.length }));

if (domain) {
  const domainPath = `${hosting}/${sitePath}/customDomains/${domain}`;
  if (!await exists(domainPath)) {
    await request(`${hosting}/${sitePath}/customDomains?customDomainId=${encodeURIComponent(domain)}`, 'POST', {});
  }
  const info = await request(domainPath);
  console.log(JSON.stringify({ domain, hostState: info.hostState, ownershipState: info.ownershipState, requiredDnsUpdates: info.requiredDnsUpdates }, null, 2));
}
