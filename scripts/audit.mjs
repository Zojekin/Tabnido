import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd(),
  dist = resolve(root, 'dist');
const json = async (path) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
async function files(dir) {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}
const manifest = await json(join(dist, 'manifest.json'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'tabs', 'scripting', 'favicon']);
assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
for (const field of [
  'externally_connectable',
  'homepage_url',
  'update_url',
  'browser_specific_settings',
])
  assert.equal(manifest[field], undefined, field);
const references = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap((c) => c.js),
];
for (const path of references) assert((await stat(resolve(dist, path))).isFile(), path);
assert.deepEqual(manifest.content_scripts[0].exclude_matches, [
  '*://chrome.google.com/webstore/*',
  '*://chromewebstore.google.com/*',
]);
const banned =
  /supabase|sentry|tabsence\.app|mailto:|createCheckoutSession|onMessageExternal|setUninstallURL|PREMIUM_REQUIRED|syncAcrossDevices|best pizza near me|skyscanner|chromewebstore\.google\.com\/detail/i;
const urlList = new Set();
for (const path of await files(dist)) {
  if (!/\.(?:js|html|css|json)$/.test(path)) continue;
  const source = await readFile(path, 'utf8');
  assert(!banned.test(source), `Removed feature leaked into ${relative(dist, path)}`);
  for (const match of source.matchAll(/https?:\/\/[^\s"'`<>]+/g)) urlList.add(match[0]);
  if (path.includes('content-scripts') && path.endsWith('.js'))
    assert(
      !/\b(?:import\s*(?:\(|["'{*])|export\s)/.test(source),
      'Content script has unresolved module syntax',
    );
  if (path.endsWith('.css'))
    assert(!/url\(\s*['"]?https?:/i.test(source), 'Remote stylesheet resource');
  if (path.endsWith('.html')) {
    for (const match of source.matchAll(/(?:src|href)="([^"]+)"/g))
      assert((await stat(resolve(dist, match[1].replace(/^\//, '')))).isFile(), match[1]);
  }
}
const locales = await readdir(join(dist, '_locales'));
assert.deepEqual(locales.sort(), ['en', 'zh_CN']);
console.log(
  JSON.stringify(
    {
      status: 'PASS',
      manifestPaths: references.length,
      builtFiles: (await files(dist)).length,
      literalUrls: [...urlList],
      browserAcceptance: 'NOT ASSESSED BY STATIC AUDIT',
    },
    null,
    2,
  ),
);
