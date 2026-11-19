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

async function testGoods(browser, base) {
  console.log('[Task2] goods.html（寝る前セットアップガイド）');
  const fs = require('fs');
  const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 390, height: 844 }, config: Object.assign({}, BASE_CFG, { operator: 'テスト運営' }) });
  const res = await page.goto(base + '/goods.html', { waitUntil: 'load' });
  ok(res && res.status() === 200, 'goods.html が開ける', res && res.status());
  if (!res || res.status() !== 200) { await ctx.close(); return; }
  ok(await page.$('#backBar') !== null, '帯 #backBar がある');
  ok(await page.$('#backBar a[href="./"]') !== null, '帯に「アプリに戻る」リンク（href="./"）がある');
  const pos = await page.evaluate(() => { const b = document.querySelector('#backBar'); return b ? getComputedStyle(b).position : ''; });
  ok(pos === 'fixed' || pos === 'sticky', '帯の position が fixed か sticky', pos);
  const barTxt = await page.evaluate(() => { const b = document.querySelector('#backBar'); return b ? b.textContent.replace(/\s+/g, ' ') : ''; });
  ok(/アラームはアプリの画面を開いている時だけ鳴ります/.test(barTxt), '帯の文言', barTxt);
  // 下までスクロールしても帯が画面内にある
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(100);
  const barBox = await page.evaluate(() => { const r = document.querySelector('#backBar').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  ok(barBox.top >= 0 && barBox.bottom <= 844 && barBox.bottom > 0, '一番下までスクロールしても帯が見えている', barBox);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  const prY = await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) { if (n.nodeValue.includes('本ページはプロモーション（広告）を含みます')) { const r = n.parentElement.getBoundingClientRect(); return r.bottom; } }
    return null;
  });
  ok(prY !== null && prY < 844, '「本ページはプロモーション（広告）を含みます」が最初の画面内（390×844）', prY);
  const body = await page.evaluate(() => document.body.innerText);
  ok(/Amazonのアソシエイトとして、テスト運営は適格販売により収入を得ています。/.test(body), 'Amazon アソシエイトの文言（運営者名入り）');
  ok(!/[¥￥円]/.test(body), '価格表記（¥・円）がない');
  const imgs = await page.evaluate(() => [...document.images].map(i => i.getAttribute('src') || ''));
  ok(!imgs.some(s => /amazon|rakuten|moshimo|media-amazon|ssl-images/i.test(s)), '商品画像（amazon/rakuten 等の img）がない', imgs);
  const scripts = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')));
  ok(scripts.every(s => /^config\.js(\?v=[\d.]+)?$/.test(s)), '外部 <script src> は config.js だけ', scripts);
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href*="amazon.co.jp"], a[href*="rakuten.co.jp"]')].map(a => ({ rel: a.getAttribute('rel') || '', t: a.getAttribute('target') })));
  ok(links.length > 0, '商品のテキストリンクがある', links.length);
  ok(links.every(l => /\bsponsored\b/.test(l.rel) && /\bnoopener\b/.test(l.rel)), '商品リンクは rel="sponsored noopener"');
  const html = fs.readFileSync(path.join(ROOT, 'goods.html'), 'utf8');
  const nLinks = (html.match(/<a [^>]*href="https:\/\/(www\.amazon\.co\.jp|search\.rakuten\.co\.jp)[^"]*"/g) || []).length;
  const nTodo = (html.match(/<!-- TODO\(owner\): もしもアフィリエイトのリンクに差し替え -->/g) || []).length;
  ok(nTodo >= nLinks && nLinks > 0, '各商品リンクに TODO(owner) コメント', { nLinks, nTodo });
  ok(/<link rel="canonical" href="https:\/\/nagara-alarm\.pages\.dev\/goods">/.test(html), 'canonical が /goods');
  ok(errors.length === 0, 'goods.html で pageerror 0 件', errors);
  await ctx.close();
  // config.js が読めなくても壊れない
  {
    const { ctx, page, errors } = await newPage(browser, base, { config: 404 });
    await page.goto(base + '/goods.html', { waitUntil: 'load' });
    ok(errors.length === 0, 'config.js が 404 でも goods.html で pageerror 0 件', errors);
    await ctx.close();
  }
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  ok(/<loc>https:\/\/nagara-alarm\.pages\.dev\/goods<\/loc><lastmod>2026-11-19<\/lastmod>/.test(sm), 'sitemap.xml に /goods（lastmod 2026-11-19）');
  const about = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
  const faqLock = (about.match(/<summary>画面をロックしても鳴りますか？<\/summary>[\s\S]*?<\/details>/) || [''])[0];
  ok(/<a href="goods\.html">寝る前のおすすめグッズ<\/a>/.test(faqLock), 'about.html の FAQ「画面をロックしても鳴りますか？」から goods.html へリンク');
}

async function testPolicyAbout(browser, base) {
  console.log('[Task3] privacy.html・about.html の文言');
  const fs = require('fs');
  {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/privacy.html', { waitUntil: 'load' });
    const t4 = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find(x => /^4\./.test(x.textContent.trim()));
      let el = h && h.nextElementSibling; while (el && el.tagName !== 'TABLE' && el.tagName !== 'H2') el = el.nextElementSibling;
      if (!el || el.tagName !== 'TABLE') return null;
      return { head: [...el.rows[0].cells].map(c => c.textContent.trim()), text: el.textContent, rows: [...el.rows].slice(1).map(r => r.cells.length) };
    });
    ok(!!t4, 'privacy 4章に表がある');
    if (t4) {
      ok(JSON.stringify(t4.head) === JSON.stringify(['送信先', '送信される情報', '目的']), '4章の表のヘッダが3列（送信先／送信される情報／目的）', t4.head);
      ok(t4.rows.every(n => n === 3), '4章の表の各行が3列', t4.rows);
      for (const w of ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.googleapis.com', 'もしもアフィリエイト', 'Amazon', '楽天', '応援']) ok(t4.text.includes(w), '4章の表に「' + w + '」');
    }
    const body = await page.evaluate(() => document.body.innerText);
    ok(body.includes('現在、本サービスに広告はありません。'), '「現在、本サービスに広告はありません。」を残している');
    ok(body.includes('最終更新：2026年11月19日'), '最終更新が 2026年11月19日');
    ok(/IP ?アドレス/.test(body) && body.includes('各社には、通信の仕組み上、IP アドレス'), '表の下に「各社には通信の仕組み上 IP アドレス…」');
    ok(body.includes('紹介リンクについて') && body.includes('アソシエイト'), '「紹介リンクについて」段落（アソシエイト参加）');
    ok(body.includes('応援は任意で、機能は変わりません'), '5章に「応援は任意で、機能は変わりません」');
    ok(errors.length === 0, 'privacy.html で pageerror 0 件', errors);
    await ctx.close();
  }
  const ph = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  ok(/<script src="config\.js\?v=1\.9\.7"><\/script>/.test(ph), 'privacy.html が config.js?v=1.9.7 を読む');
  const ah = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
  ok(/<script src="config\.js\?v=1\.9\.7"><\/script>/.test(ah), 'about.html が config.js?v=1.9.7 を読む');
  {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + '/about.html', { waitUntil: 'load' });
    const faq = await page.evaluate(() => [...document.querySelectorAll('.faq summary')].map(s => s.textContent.trim()));
    ok(faq.includes('広告はありますか？'), 'about の FAQ に「広告はありますか？」', faq);
    const biz = await page.evaluate(() => { const b = document.querySelector('#biz .box.company ul'); return b ? b.textContent : ''; });
    ok(biz.includes('起床時の再生画面・おやすみ画面には広告を表示しません'), '#biz 企業ボックスに「起床時の再生画面・おやすみ画面には広告を表示しません」');
    ok(/紹介ページ（HP）内での掲載/.test(biz), '#biz 企業ボックスに「紹介ページ（HP）内での掲載」');
    ok(await page.$('footer #lnkTip') !== null, 'about の footer に #lnkTip がある');
    ok(await shown(page, 'footer #lnkTip') === false, 'tipUrl が空なら about の #lnkTip は非表示');
    ok(errors.length === 0, 'about.html で pageerror 0 件', errors);
    await ctx.close();
  }
  {
    const url = 'https://ofuse.me/example';
    const { ctx, page } = await newPage(browser, base, { config: Object.assign({}, BASE_CFG, { tipUrl: url }) });
    await page.goto(base + '/about.html', { waitUntil: 'load' });
    ok(await shown(page, 'footer #lnkTip') === true, 'tipUrl が https なら about の #lnkTip を表示');
    ok(await attr(page, 'footer #lnkTip', 'href') === url, 'about の #lnkTip の href が tipUrl と一致');
    await ctx.close();
  }
  for (const bad of ['javascript:alert(1)', 'http://x']) {
    const { ctx, page } = await newPage(browser, base, { config: Object.assign({}, BASE_CFG, { tipUrl: bad }) });
    await page.goto(base + '/about.html', { waitUntil: 'load' });
    ok(await shown(page, 'footer #lnkTip') === false, 'tipUrl=' + JSON.stringify(bad) + ' なら about の #lnkTip は非表示');
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await newPage(browser, base, { config: 404 });
    await page.goto(base + '/about.html', { waitUntil: 'load' });
    ok(errors.length === 0, 'config.js が 404 でも about.html で pageerror 0 件', errors);
    await ctx.close();
  }
}

async function testAppBoot(browser, base) {
  console.log('[Task4] アプリの起動（ルートと test/）');
  for (const u of ['/', '/test/']) {
    const { ctx, page, errors } = await newPage(browser, base);
    await page.goto(base + u, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    ok(errors.length === 0, u + ' で pageerror 0 件', errors);
    ok(await page.isVisible('#btnStandby'), u + ' で #btnStandby が見える');
    const mixed = await page.evaluate(() => ['#ring', '#standby'].map(s => document.querySelector(s)).filter(Boolean)
      .some(el => el.querySelector('#lnkTip, #lnkGoods, #boxSupport, a[href*="goods.html"]')));
    ok(mixed === false, u + ' の #ring・#standby の中に応援・グッズの要素がない');
    const ver = await page.evaluate(() => { const m = document.documentElement.innerHTML.match(/const APP_VERSION = '([\d.]+)'/); return m && m[1]; });
    ok(ver === '1.14.1', u + ' の APP_VERSION が 1.14.1', ver);
    await ctx.close();
  }
}

(async () => {
  const { proc, base } = await startServer();
  const browser = await chromium.launch();
  try {
    await testIndexTip(browser, base);
    await testGoods(browser, base);
    await testPolicyAbout(browser, base);
    await testAppBoot(browser, base);
  } catch (e) {
    failed++; console.log('  FAIL 例外: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    proc.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
