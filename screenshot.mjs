import puppeteer from 'puppeteer';
import { readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const OUT_DIR = join(ROOT, 'temporary screenshots');

const url = process.argv[2] ?? 'http://localhost:3000';
const label = process.argv[3] ?? '';
// Optional viewport override: node screenshot.mjs <url> <label> <width> <height>
const width = Number(process.argv[4]) || 1440;
const height = Number(process.argv[5]) || 900;

await mkdir(OUT_DIR, { recursive: true });

// Auto-increment so screenshots are never overwritten.
const existing = await readdir(OUT_DIR).catch(() => []);
const highest = existing.reduce((max, name) => {
  const n = /^screenshot-(\d+)/.exec(name);
  return n ? Math.max(max, Number(n[1])) : max;
}, 0);
const filename = `screenshot-${highest + 1}${label ? `-${label}` : ''}.png`;
const outPath = join(OUT_DIR, filename);

const browser = await puppeteer.launch({
  headless: true, // 'new' was removed in Puppeteer 22+; `true` is now new headless

  args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });

  // Chrome can't allocate a capture texture taller than 16384px. A tall page at
  // 2x blows past that and comes back with duplicated/stitched bands, so step the
  // scale factor down until the full-page capture fits.
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const scale = pageHeight * 2 > 16_000 ? 1 : 2;
  if (scale !== 2) {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    console.log(`Page is ${pageHeight}px tall — capturing at ${scale}x to stay under Chrome's texture limit.`);
  }

  // Let webfonts settle, then walk the full page so scroll-triggered reveals and
  // counters fire before capture. Stepping with real delays (rather than a rAF
  // loop) gives IntersectionObserver time to actually deliver callbacks.
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.6);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 300));
    window.scrollTo(0, 0);
  });
  // Long enough for the 1.5s stat counters and 0.75s reveals to finish.
  await new Promise((r) => setTimeout(r, 2500));

  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`Saved ${outPath}  (${width}x${height})`);
} finally {
  await browser.close();
}
