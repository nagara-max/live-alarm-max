/* 収益化フェーズ1のガード（Playwright を直接使う node スクリプト）
 *  使い方: node tools/guard/phase1.spec.js
 *  - リポジトリのルートを python3 -m http.server で配信して確認する
 *  - 1件でも失敗すると exit 1 */
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const ROOT = path.resolve(__dirname, '..', '..');
let failed = 0, passed = 0;
function ok(cond, name, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
}
async function startServer() {
  const port = await freePort();
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(base + '/config.js'); if (r.ok) return { proc, base }; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
  }
  proc.kill(); throw new Error('server did not start');
}

/* 外部への通信は止める（テストを速く・安定させるため。ローカル配信のファイルだけ通す） */
async function newPage(browser, base, opts = {}) {
  const ctx = await browser.newContext(opts.viewport ? { viewport: opts.viewport } : {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    return route.abort();
  });
  if (opts.config !== undefined) {
    await page.route('**/config.js*', route => {
      if (opts.config === 404) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.LIVE_ALARM_CONFIG = ' + JSON.stringify(opts.config) + ';' });
    });
  }
  return { ctx, page, errors };
}

/* 要素が「表示される状態」か（モーダルが閉じていても、要素自体が隠されていないか） */
async function shown(page, sel) {
  return page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return null;
    return !el.hidden && getComputedStyle(el).display !== 'none';
  }, sel);
}

/* 属性を読む（要素がなければ undefined。待たない） */
async function attr(page, sel, name) {
  return page.evaluate(([s, n]) => { const el = document.querySelector(s); return el ? el.getAttribute(n) : undefined; }, [sel, name]);
}

const BASE_CFG = { backendUrl: '', testBackendUrl: '', operator: 'テスト運営', contact: '' };

async function testIndexTip(browser, base) {
  console.log('[Task1] index.html の応援リンク・グッズへの入口');
  // 実物の config.js（tipUrl 空）
  {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    ok(await page.$('#mSettings #boxSupport') !== null, '#boxSupport が ⚙設定（#mSettings）の中にある');
    ok(await page.$('#lnkTip') !== null, '#lnkTip がある');
    ok(await shown(page, '#lnkTip') === false, 'tipUrl が空なら #lnkTip は非表示');
    ok(await attr(page, '#lnkGoods', 'href') === 'goods.html', '#lnkGoods の href が goods.html');
    ok(await attr(page, '#lnkGoods', 'target') === null, '#lnkGoods に target がない（同じタブ）');
    ok(await shown(page, '#lnkGoods') === true, '#lnkGoods は常に表示');
    ok(errors.length === 0, '実物の config.js で pageerror 0 件', errors);
    await ctx.close();
  }
  // https の tipUrl
  {
    const url = 'https://ofuse.me/example';
    const { ctx, page, errors } = await newPage(browser, base, { config: Object.assign({}, BASE_CFG, { tipUrl: url }) });
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    ok(await shown(page, '#lnkTip') === true, 'tipUrl が https なら #lnkTip を表示');
    ok(await attr(page, '#lnkTip', 'href') === url, '#lnkTip の href が tipUrl と一致');
    ok(await attr(page, '#lnkTip', 'target') === null, '#lnkTip に target がない（同じタブ）');
    const txt = (await page.evaluate(() => { const e = document.querySelector('#lnkTip'); return e ? e.textContent : ''; })).trim();
    ok(txt === '☕ 開発を応援する（任意。機能は変わりません）', '#lnkTip のラベル', txt);
    ok(errors.length === 0, 'https の tipUrl で pageerror 0 件', errors);
    await ctx.close();
  }
  // 危険・不正な tipUrl
  for (const bad of ['javascript:alert(1)', 'http://x', ' https://x', 'data:text/html,1', 123, null]) {
    const { ctx, page } = await newPage(browser, base, { config: Object.assign({}, BASE_CFG, { tipUrl: bad }) });
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    const href = await attr(page, '#lnkTip', 'href');
    ok(await shown(page, '#lnkTip') === false && !(href && /^(javascript|data|http):/i.test(href)), 'tipUrl=' + JSON.stringify(bad) + ' なら #lnkTip は非表示', href);
    await ctx.close();
  }
  // config.js が読めない
  {
    const { ctx, page, errors } = await newPage(browser, base, { config: 404 });
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    ok(errors.length === 0, 'config.js が 404 でも pageerror 0 件', errors);
    ok(await shown(page, '#lnkTip') === false, 'config.js が 404 なら #lnkTip は非表示');
    ok(await page.isVisible('#btnStandby'), 'config.js が 404 でも #btnStandby が見える（通常起動）');
    await ctx.close();
  }
}

(async () => {
  const { proc, base } = await startServer();
  const browser = await chromium.launch();
  try {
    await testIndexTip(browser, base);
  } catch (e) {
    failed++; console.log('  FAIL 例外: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    proc.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
