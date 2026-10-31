import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
const require = createRequire('C:/Users/Zojekin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/Zojekin/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  args: ['--use-mock-keychain', '--password-store=basic']
});

try {
  const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
  const source = await readFile('public/brand/symbol.svg', 'utf8');
  // 替换为高质感沉稳中性灰 #9e9e9e
  const graySource = source.replace(/fill="#141414"/g, 'fill="#9e9e9e"');

  await page.setContent(graySource);
  const bounds = await page.locator('svg').evaluate(el => {
    const b = el.getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });

  const canvas = Math.max(bounds.width, bounds.height) / 0.96;
  const viewBox = [
    bounds.x - (canvas - bounds.width) / 2,
    bounds.y - (canvas - bounds.height) / 2,
    canvas,
    canvas
  ].join(' ');

  const graySvg = graySource
    .replace(/width="[^"]*"/, 'width="128"')
    .replace(/height="[^"]*"/, 'height="128"')
    .replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);

  await mkdir('public/icon/gray', { recursive: true });
  await mkdir('dist/icon/gray', { recursive: true });

  for (const size of [16, 32, 48, 96, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${graySvg}`);
    await page.screenshot({ path: `public/icon/gray/${size}.png`, omitBackground: true });
    await page.screenshot({ path: `dist/icon/gray/${size}.png`, omitBackground: true });
  }

  console.log('Gray icons successfully rendered into public/icon/gray and dist/icon/gray!');
} finally {
  await browser.close();
}
