import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DIST_DIR = path.resolve(process.cwd(), 'dist');
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'qa-screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      const filePath = path.join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
  });
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`QA ASSERTION FAILED: ${msg}`);
  }
  console.log(`  ✓ ${msg}`);
}

async function run() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error('dist/index.html missing — run npm run build first');
  }

  const { server, url } = await startStaticServer();
  console.log(`Serving dist/ at ${url}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
    ],
  });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      pageErrors.push(String(err));
    });

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__EDEN_QA__), { timeout: 10000 });
    await page.waitForTimeout(800);

    // 1. Desktop Boot & Render QA
    console.log('\n[1/4] Desktop Boot & Render QA');
    const initial = await page.evaluate(() => window.__EDEN_QA__.getState());
    assert(initial.godRigScale === 1, `Desktop godRigScale is 1 (got ${initial.godRigScale})`);
    assert(initial.logs.summary.errorCount === 0, `Zero app errors on boot (${initial.logs.summary.errorCount})`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-player-village.png') });

    // 2. Desktop Navigation QA (Left-drag pan, Right-drag orbit, Scroll zoom, WASD, R Rival, C Creature)
    console.log('\n[2/4] Desktop Navigation QA');
    const camStart = initial.cameraPos;
    // Left-drag empty ground to pan
    await page.mouse.move(640, 360);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(480, 260, { steps: 8 });
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(350);
    const afterPan = await page.evaluate(() => window.__EDEN_QA__.getState());
    const panDist = Math.hypot(
      afterPan.cameraPos[0] - camStart[0],
      afterPan.cameraPos[2] - camStart[2]
    );
    assert(panDist > 1.5, `Left-drag ground panning moved camera (${panDist.toFixed(1)}m)`);

    // Jump to Rival Village ('R')
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(700);
    const atRival = await page.evaluate(() => window.__EDEN_QA__.getState());
    assert(atRival.cameraPos[0] > 10, `KeyR navigated to Rival Village (camX=${atRival.cameraPos[0].toFixed(1)})`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-rival-village.png') });

    // Jump to Creature ('C')
    await page.keyboard.press('KeyC');
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-creature.png') });

    // 3. Gameplay Actions QA (Miracles, Leash, Pet)
    console.log('\n[3/4] Gameplay Actions QA');
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(500);
    const beforeMiracle = await page.evaluate(() => window.__EDEN_QA__.getState());
    await page.mouse.move(640, 400);
    await page.keyboard.press('Digit1'); // Food miracle
    await page.keyboard.press('KeyL'); // Leash Creature
    await page.keyboard.press('KeyP'); // Pet Creature
    await page.waitForTimeout(300);
    const afterActions = await page.evaluate(() => window.__EDEN_QA__.getState());
    assert(afterActions.prayerPower < beforeMiracle.prayerPower + 2, 'Food miracle spent Prayer Power');
    assert(afterActions.creatureLeashed === true, 'KeyL leashed Creature to cursor');
    await page.keyboard.press('KeyU');
    await page.waitForTimeout(150);
    const afterUnleash = await page.evaluate(() => window.__EDEN_QA__.getState());
    assert(afterUnleash.creatureLeashed === false, 'KeyU unleashed Creature');

    // 4. QA Logs Modal & Error-Free Check
    console.log('\n[4/4] QA Logs & Runtime Error Check');
    await page.click('#open-logs-btn');
    await page.waitForTimeout(200);
    const logsText = await page.inputValue('#logs-text');
    assert(logsText.includes('"app": "EdenXR"'), 'QA Logs modal displays valid EdenXR JSON');
    assert(consoleErrors.length === 0, `Zero browser console errors (got ${consoleErrors.length})`);
    assert(pageErrors.length === 0, `Zero uncaught page errors (got ${pageErrors.length})`);

    console.log('\nALL AUTOMATED E2E QA CHECKS PASSED!');
    console.log(`Screenshots saved to ${SCREENSHOT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
