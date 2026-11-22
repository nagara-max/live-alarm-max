/* 収益化フェーズ1のガード（Playwright を直接使う node スクリプト）
 *  使い方: node tools/guard/phase1.spec.js
 *  - リポジトリのルートを python3 -m http.server で配信して確認する
 *  - 1件でも失敗すると exit 1 */
'use strict';
const { chromium, devices } = require('playwright');
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
  const ctx = await browser.newContext(opts.device ? Object.assign({}, devices[opts.device]) : opts.viewport ? { viewport: opts.viewport } : {});
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
    ok(await attr(page, '#lnkGoods', 'href') === 'goods.html?utm_source=app&utm_medium=settings', '#lnkGoods の href が goods.html（utm 付き）');
    ok(await attr(page, '#lnkGoods', 'target') === null, '#lnkGoods に target がない（同じタブ）');
    ok(await shown(page, '#lnkGoods') === true, '#lnkGoods は常に表示');
    ok(await page.$('#mSettings #boxSupport #lnkShare') !== null, '「Xで共有」#lnkShare が ⚙設定の #boxSupport の中にある');
    const sh = await page.evaluate(() => { const a = document.querySelector('#lnkShare'); return a ? { href: a.getAttribute('href'), t: a.getAttribute('target'), rel: a.getAttribute('rel') } : null; });
    ok(!!sh && /^https:\/\/twitter\.com\/intent\/tweet\?text=[^&]+&url=https%3A%2F%2Fnagara-alarm\.pages\.dev%2Fabout%3Futm_source%3Dshare%26utm_medium%3Dx$/.test(sh.href) && sh.t === '_blank' && /\bnoopener\b/.test(sh.rel), '#lnkShare は X の共有 URL（about・utm_source=share）・target=_blank・rel=noopener', sh);
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
    ok(await page.isVisible('#btnFirstRun'), 'config.js が 404 でも #btnFirstRun が見える（通常起動・アラーム0件）');
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
  ok(await page.$eval('#amazonNote', e => e.hidden && /Amazonのアソシエイトとして、テスト運営は適格販売により収入を得ています。/.test(e.textContent)), 'Amazon アソシエイトの文言（運営者名入り・承認まで非表示）');
  ok(!/[¥￥円]/.test(body), '価格表記（¥・円）がない');
  const imgs = await page.evaluate(() => [...document.images].map(i => ({ src: i.getAttribute('src') || '', alt: i.getAttribute('alt') || '', w: i.getAttribute('width'), h: i.getAttribute('height') })));
  ok(!imgs.some(i => /amazon|rakuten|moshimo|media-amazon|ssl-images/i.test(i.src)), '商品画像（amazon/rakuten 等の img）がない', imgs.map(i => i.src));
  ok(imgs.length >= 5 && imgs.every(i => /^\/img\/goods\/[\w-]+\.webp$/.test(i.src)), '画像は /img/goods/*.webp だけ（ヒーロー＋各シーン）', imgs.map(i => i.src));
  ok(imgs.every(i => i.alt.trim() !== '' && i.w && i.h), '画像はすべて alt・width・height 付き', imgs);
  const scripts = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')));
  ok(scripts.length > 0 && scripts.every(s => /^(config|hp-stats)\.js(\?v=[\d.]+)?$/.test(s)), '<script src> は config.js と hp-stats.js（同じサイト内）だけ', scripts);
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href*="amazon.co.jp"], a[href*="rakuten.co.jp"], a[href*="moshimo.com"]')].map(a => ({ rel: a.getAttribute('rel') || '', t: a.getAttribute('target') })));
  ok(links.length > 0, '商品のテキストリンクがある', links.length);
  ok(links.every(l => /\bsponsored\b/.test(l.rel) && /\bnoopener\b/.test(l.rel) && l.t === '_blank'), '商品リンクは rel="sponsored noopener" target="_blank"');
  ok(!/目覚まし時計/.test(body), '目覚まし時計を商品として紹介していない（このアプリ自体が目覚まし）');
  const night = await page.evaluate(() => { const n = document.querySelector('#night'); return n ? { t: n.textContent, a: [...n.querySelectorAll('a')].map(a => a.getAttribute('href')) } : null; });
  ok(!!night && night.a.includes('guide/iphone-bedtime-settings.html') && night.a.includes('guide/charging-overnight.html') && !night.a.some(h => /moshimo|rakuten|amazon/.test(h)), '「寝る前のコツ」からガイド2本へリンク（商品リンクなし）', night && night.a);
  ok(!!night && night.t.includes('大事な予定の日は、スマホ標準のアラームも一緒にセットしておくと安心です。'), '「寝る前のコツ」に標準アラーム併用の一文');
  const html = fs.readFileSync(path.join(ROOT, 'goods.html'), 'utf8');
  const nAmazon = (html.match(/<a [^>]*href="https:\/\/www\.amazon\.co\.jp[^"]*"/g) || []).length;
  ok(nAmazon === 0, 'Amazon の未提携リンクがない（承認まで楽天のみ）', nAmazon);
  ok(html.includes('<!-- TODO(owner): Amazon の提携承認後、もしも（Amazon）のリンクを追加 -->'), 'Amazon リンク追加の TODO(owner) コメントがある');
  const nRakutenPlain = (html.match(/<a [^>]*href="https:\/\/search\.rakuten\.co\.jp[^"]*"/g) || []).length;
  const nRakutenAff = (html.match(/<a [^>]*href="https:\/\/af\.moshimo\.com\/af\/c\/click\?a_id=5914685&amp;p_id=54&amp;[^"]*url=https%3A%2F%2Fsearch\.rakuten\.co\.jp[^"]*"/g) || []).length;
  const nMoshimo = (html.match(/<a [^>]*href="https:\/\/af\.moshimo\.com[^"]*"/g) || []).length;
  ok(nRakutenPlain === 0 && nRakutenAff >= 10 && nMoshimo === nRakutenAff, '楽天リンクはすべて もしも経由（a_id=5914685・10件以上）', { nRakutenPlain, nRakutenAff, nMoshimo });
  ok(/<meta property="og:image" content="https:\/\/nagara-alarm\.pages\.dev\/img\/goods\/hero\.webp">/.test(html), 'og:image が img/goods/hero.webp');
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
  ok(/<loc>https:\/\/nagara-alarm\.pages\.dev\/goods<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sm), 'sitemap.xml に /goods（lastmod あり）');
  const about = fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8');
  const faqLock = (about.match(/<summary>画面をロックしても鳴りますか？<\/summary>[\s\S]*?<\/details>/) || [''])[0];
  ok(/<a href="goods\.html">朝を気持ちよく始めるアイテム<\/a>/.test(faqLock), 'about.html の FAQ「画面をロックしても鳴りますか？」から goods.html へリンク');
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
    ok(body.includes('現在、アプリの画面に広告はありません'), 'アプリの画面に広告がないことを明記している');
    ok(body.includes('最終更新：2026年11月22日'), '最終更新が 2026年11月22日');
    ok(!body.includes('紹介ページの一部（「朝を気持ちよく始めるアイテム」のページ）には'), '「紹介リンクは goods.html だけ」の古い文言がない');
    ok(body.includes('ガイド記事の一部'), '紹介リンクがガイド記事の一部にもあることを明記');
    ok(/IP ?アドレス/.test(body) && body.includes('各社には、通信の仕組み上、IP アドレス'), '表の下に「各社には通信の仕組み上 IP アドレス…」');
    ok(body.includes('紹介リンクについて') && body.includes('アフィリエイトプログラム'), '「紹介リンクについて」段落');
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
    const adA = await page.evaluate(() => { const s = [...document.querySelectorAll('.faq summary')].find(x => x.textContent.trim() === '広告はありますか？'); return s ? s.parentElement.querySelector('.a').textContent : ''; });
    ok(adA.includes('アプリの画面（アラームの設定・再生画面・おやすみ画面）には、広告はありません') && adA.includes('使い方ガイド・コラムの一部の記事'), 'FAQ「広告はありますか？」がアプリ画面には無い・記事の一部にある、と書いている', adA);
    const faqLinks = await page.evaluate(() => [...document.querySelectorAll('.faq .a a')].map(a => a.getAttribute('href')));
    for (const g of ['guide/screen-lock-alarm.html', 'guide/iphone-bedtime-settings.html', 'guide/youtube-no-sound.html', 'guide/morning-stream-alarm.html']) ok(faqLinks.includes(g), 'about の FAQ から ' + g + ' へリンク', faqLinks);
    ok(await page.$('#guides .guides a[href="guide/iphone-bedtime-settings.html"]') !== null && await page.$('.final .share a[href^="https://twitter.com/intent/tweet?"][data-cta="share_x"][target="_blank"]') !== null, 'about に使い方ガイドの入口と「Xで共有」リンク');
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
    ok(await page.isVisible('#btnFirstRun'), u + ' で #btnFirstRun が見える（アラーム0件）');
    const mixed = await page.evaluate(() => ['#ring', '#standby'].map(s => document.querySelector(s)).filter(Boolean)
      .some(el => el.querySelector('#lnkTip, #lnkGoods, #boxSupport, a[href*="goods.html"]')));
    ok(mixed === false, u + ' の #ring・#standby の中に応援・グッズの要素がない');
    const ver = await page.evaluate(() => { const m = document.documentElement.innerHTML.match(/const APP_VERSION = '([\d.]+)'/); return m && m[1]; });
    ok(ver === '1.14.4', u + ' の APP_VERSION が 1.14.4', ver);
    await ctx.close();
  }
}

/* HP の統計（hp-stats.js）：about.html と同じ形で送る・統計オフなら送らない・移動を止めない */
async function testHpStats(browser, base) {
  console.log('[Task6] hp-stats.js（グッズ・ガイド記事の匿名統計）');
  const STATS = 'https://stats.invalid/hp';
  const cfg = Object.assign({}, BASE_CFG, { backendUrl: 'https://prod.invalid/hp', testBackendUrl: STATS });
  async function open(u, pre) {
    const r = await newPage(browser, base, { config: cfg });
    const got = [];
    await r.page.route('https://stats.invalid/**', route => { try { got.push(JSON.parse(route.request().postData() || 'null')); } catch (e) {} return route.fulfill({ status: 200, body: '' }); });
    await r.page.route('https://prod.invalid/**', route => { got.push({ prod: true }); return route.fulfill({ status: 200, body: '' }); });
    if (pre) await r.page.addInitScript(pre);
    await r.page.goto(base + u, { waitUntil: 'load' });
    await r.page.waitForTimeout(300);
    return Object.assign(r, { got });
  }
  const evs = got => got.filter(b => b && b.e).map(b => Object.assign({ c: b.c }, b.e[0]));
  {
    const { ctx, page, errors, got } = await open('/goods.html?utm_source=app&utm_medium=settings');
    let e = evs(got);
    const v = e.find(x => x.n === 'hp_view');
    ok(!!v && v.c.v === 'hp' && v.c.env === 'test' && v.p.pg === 'goods' && v.p.src === 'app' && v.p.med === 'settings' && 'inapp' in v.p && 'w' in v.p, 'goods.html で hp_view（c.v=hp・env=test・pg=goods・utm）を送る', v);
    ok(!got.some(b => b && b.prod), 'テスト環境では本番の backendUrl に送らない');
    // 商品リンクのクリック（テストでは移動だけ止める。hp-stats.js 自体は preventDefault しない）
    const prevented = await page.evaluate(() => {
      const a = document.querySelector('a[href^="https://af.moshimo.com/"]');
      let dp = null;
      document.addEventListener('click', ev => { dp = ev.defaultPrevented; ev.preventDefault(); }, { once: true });
      a.click(); return dp;
    });
    await page.waitForTimeout(200);
    e = evs(got);
    const c = e.find(x => x.n === 'hp_cta' && /^aff:/.test(x.p.where));
    ok(!!c && c.p.pg === 'goods' && c.p.where === 'aff:光で起こすライト', '商品リンクのクリックで hp_cta { where:"aff:<商品名>", pg }', c);
    ok(prevented === false, 'hp-stats.js はクリックの移動を止めない（defaultPrevented=false）', prevented);
    ok(errors.length === 0, 'goods.html（統計あり）で pageerror 0 件', errors);
    await ctx.close();
  }
  {
    const { ctx, errors, got } = await open('/goods.html', () => { localStorage.setItem('liveAlarm.test.v1', JSON.stringify({ settings: { stats: false } })); });
    ok(got.length === 0, '⚙設定で統計オフなら何も送らない', got.length);
    ok(errors.length === 0, '統計オフで pageerror 0 件', errors);
    await ctx.close();
  }
  {
    const { ctx, page, errors, got } = await open('/guide/morning-coffee.html');
    const v = evs(got).find(x => x.n === 'hp_view');
    ok(!!v && v.p.pg === 'guide/morning-coffee', 'ガイド記事で hp_view（pg=guide/morning-coffee）', v);
    await page.evaluate(() => { document.addEventListener('click', ev => ev.preventDefault(), { once: true }); document.querySelector('.share a').click(); });
    await page.waitForTimeout(200);
    const s = evs(got).find(x => x.n === 'hp_cta' && x.p.where === 'share_x');
    ok(!!s && s.p.pg === 'guide/morning-coffee', '「Xで共有」のクリックで hp_cta { where:"share_x" }', s);
    ok(errors.length === 0, 'ガイド記事（統計あり）で pageerror 0 件', errors);
    await ctx.close();
  }
}

/* ガイド記事：統計・共有リンク・紹介リンク */
async function testGuides(browser, base) {
  console.log('[Task7] ガイド記事の統計・共有リンク・紹介リンク');
  const fs = require('fs');
  const ARTS = ['charging-overnight', 'iphone-bedtime-settings', 'morning-coffee', 'morning-routine', 'morning-stream-alarm', 'morning-stretch', 'pc-alarm', 'screen-lock-alarm', 'wake-up-refreshed', 'youtube-no-sound', 'cold-morning', 'new-year-stream'];
  const AFF = ['morning-coffee', 'morning-routine', 'morning-stretch', 'charging-overnight', 'iphone-bedtime-settings'];
  const WINTER = ['cold-morning', 'new-year-stream'];   // 冬の季節記事（紹介リンクは記事チームが入れたもの。数は問わない）
  for (const a of ARTS) {
    const html = fs.readFileSync(path.join(ROOT, 'guide', a + '.html'), 'utf8');
    const scripts = [...html.matchAll(/<script [^>]*src="([^"]+)"/g)].map(m => m[1]);
    ok(scripts.length === 2 && scripts[0].startsWith('../config.js') && scripts[1].startsWith('../hp-stats.js'), a + '：<script src> は config.js → hp-stats.js だけ', scripts);
    const share = html.match(/<p class="share"><a href="([^"]+)" target="_blank" rel="noopener" data-cta="share_x">Xで共有する<\/a><\/p>\n<\/main>/);
    ok(!!share && share[1].startsWith('https://twitter.com/intent/tweet?text=') && share[1].includes('&amp;url=' + encodeURIComponent('https://nagara-alarm.pages.dev/guide/' + a + '?utm_source=share&utm_medium=x')), a + '：末尾（フッターの上）に「Xで共有する」リンク（その記事の URL）');
    const aff = (html.match(/<a [^>]*href="https:\/\/af\.moshimo\.com[^"]*"[^>]*>/g) || []);
    if (AFF.includes(a) || WINTER.includes(a)) {
      ok(aff.length >= 1 && (WINTER.includes(a) || aff.length <= 3), a + '：紹介リンクがある（既存記事は 1〜3 個）', aff.length);
      ok(aff.every(t => /href="https:\/\/af\.moshimo\.com\/af\/c\/click\?a_id=5914685&amp;p_id=54&amp;pc_id=54&amp;pl_id=27059&amp;url=https%3A%2F%2Fsearch\.rakuten\.co\.jp/.test(t) && / target="_blank"/.test(t) && / rel="sponsored noopener"/.test(t)), a + '：紹介リンクは goods.html と同じ形（もしも a_id=5914685・sponsored noopener・_blank）');
    } else {
      ok(aff.length === 0 && !html.includes('本ページはプロモーション'), a + '：紹介リンクなし（困りごと・使い方の記事）', aff.length);
    }
  }
  for (const a of AFF.concat(WINTER)) {
    const { ctx, page, errors } = await newPage(browser, base, { viewport: { width: 390, height: 844 }, config: BASE_CFG });
    await page.goto(base + '/guide/' + a + '.html', { waitUntil: 'load' });
    const prY = await page.evaluate(() => { const e = document.querySelector('.pr'); return e && e.textContent.trim() === '本ページはプロモーション（広告）を含みます' ? e.getBoundingClientRect().bottom : null; });
    ok(prY !== null && prY < 844, a + '：「本ページはプロモーション（広告）を含みます」が最初の画面内', prY);
    const body = await page.evaluate(() => document.body.innerText);
    ok(!/[¥￥]|\d+\s*円/.test(body), a + '：価格表記がない');
    ok(!/目覚まし時計/.test(body), a + '：目覚まし時計を商品として紹介していない');
    ok(await page.evaluate(() => [...document.images].every(i => !/amazon|rakuten|moshimo/i.test(i.src))), a + '：商品画像がない');
    ok(errors.length === 0, a + '：pageerror 0 件', errors);
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await newPage(browser, base, { config: 404 });
    await page.goto(base + '/guide/morning-coffee.html', { waitUntil: 'load' });
    ok(errors.length === 0, 'config.js が 404 でもガイド記事で pageerror 0 件', errors);
    await ctx.close();
  }
}

/* 配信者の共有リンク（?ch=）：追加画面がチャンネル入りで開く・自動で保存しない・鳴る画面に触れない */
async function testChLink(browser, base) {
  console.log('[Task7] 配信者の共有リンク（?ch=）');
  const CH_ID = 'UCabcdefghijklmnopqrstuv';
  const cfg = Object.assign({}, BASE_CFG, { backendUrl: 'https://prod.invalid/x', testBackendUrl: 'https://be.invalid/x' });
  const ALARM = { id: 'aexist1', enabled: false, label: '既存', channelInput: '@exist', channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz', channelTitle: '既存チャンネル', channelThumb: '',
    mode: 'weekday', time: '06:30', days: ['', '06:30', '06:30', '06:30', '06:30', '06:30', ''], skipHolidays: false, volume: 60, preferLive: true, play: 'live' };
  const SEED = JSON.stringify({ alarms: [ALARM], settings: { introSeen: true, consentAt: 1700000000000, stats: true } });
  async function open(u, seed = SEED) {
    const r = await newPage(browser, base, { config: cfg });
    const yt = [], ev = [];
    await r.page.route('https://prod.invalid/**', route => route.fulfill({ status: 200, body: '' }));
    await r.page.route('https://be.invalid/**', route => {
      const req = route.request();
      if (req.method() === 'POST') { try { (JSON.parse(req.postData() || 'null').e || []).forEach(x => ev.push(x)); } catch (e) {} return route.fulfill({ status: 200, body: '' }); }
      const q = new URL(req.url()).searchParams, json = b => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) });
      if (q.get('a') === 'yt') {
        const p = q.get('p'), params = JSON.parse(q.get('q') || '{}');
        yt.push({ p, params });
        if (p === 'channels' && (params.forHandle || params.id === CH_ID)) return json({ ok: true, data: { items: [{ id: CH_ID, snippet: { title: 'テスト配信者', thumbnails: {} } }] } });
        return json({ ok: true, data: { items: [] } });
      }
      if (q.get('a') === 'top') return json({ ok: true, list: [] });
      return json({ ok: true });
    });
    if (seed) await r.page.addInitScript(s => { if (!localStorage.getItem('liveAlarm.test.v1')) localStorage.setItem('liveAlarm.test.v1', s); }, seed);
    await r.page.goto(base + u, { waitUntil: 'load' });
    return Object.assign(r, { yt, ev });
  }
  const isOpen = (page, sel) => page.evaluate(s => document.querySelector(s).classList.contains('open'), sel);
  const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('liveAlarm.test.v1') || '{}').alarms);
  const ringSb = page => page.evaluate(() => ['#ring', '#standby'].map(s => { const el = document.querySelector(s); return el.className + '|' + el.innerHTML; }));
  // 比べる元：ch なしで開いた時の #ring・#standby
  let baseRS;
  {
    const { ctx, page } = await open('/');
    await page.waitForTimeout(400);
    baseRS = await ringSb(page);
    ok(await isOpen(page, '#mEdit') === false, 'ch なしでは追加画面は開かない');
    await ctx.close();
  }
  // @handle
  {
    const { ctx, page, errors, yt, ev } = await open('/?ch=%40testhandle&utm_source=creator');
    await page.waitForSelector('#mEdit.open', { timeout: 3000 }).catch(() => {});
    ok(await isOpen(page, '#mEdit'), '?ch=@handle で追加画面（#mEdit）が開く');
    ok(await page.inputValue('#fChannel') === '@testhandle', '#fChannel に @testhandle が入る', await page.inputValue('#fChannel'));
    ok(await page.textContent('#editTitle') === 'アラームを追加', '新しいアラームの追加画面（編集ではない）');
    await page.waitForFunction(id => editChannel && editChannel.id === id, CH_ID, { timeout: 4000 }).catch(() => {});
    ok(yt.some(x => x.p === 'channels' && x.params.forHandle === '@testhandle'), 'いつもと同じチャンネル確認（channels forHandle）をサーバー経由で行う', yt);
    ok(await page.evaluate(id => !!editChannel && editChannel.id === id && editChannel.title === 'テスト配信者', CH_ID), '確認したチャンネルが追加画面で選ばれた状態になる（保存はまだ）');
    ok(await page.evaluate(() => location.search) === '?utm_source=creator', 'URL から ch だけ消える（utm は残る）', await page.evaluate(() => location.href));
    await page.waitForTimeout(1200);
    const al = await stored(page);
    ok(JSON.stringify(al) === JSON.stringify([ALARM]), '自動で保存しない・既存のアラームは変わらない（保存データ）', al);
    ok(await page.evaluate(a => state.alarms.length === 1 && JSON.stringify(state.alarms[0]) === JSON.stringify(a), ALARM), '自動で保存しない・既存のアラームは変わらない（画面の状態）');
    ok(await isOpen(page, '#mEdit'), '保存は利用者が押すまで追加画面のまま');
    ok(JSON.stringify(await ringSb(page)) === JSON.stringify(baseRS), '#ring・#standby の中身・状態は ch なしの時と同じ');
    ok(!(await isOpen(page, '#ring')) && !(await isOpen(page, '#standby')), '#ring・#standby は開かない');
    await page.evaluate(() => flushStats());
    await page.waitForTimeout(300);
    const e = ev.find(x => x.n === 'ch_link_open');
    ok(!!e && e.p.handle === '@testhandle' && e.p.type === 'handle' && e.p.alarms === 1, '統計 ch_link_open { handle, type, alarms } を1回送る', e);
    ok(ev.filter(x => x.n === 'ch_link_open').length === 1, 'ch_link_open は1回だけ');
    const ao = ev.find(x => x.n === 'app_open');
    ok(!!ao && ao.p.src === 'creator', 'app_open の src=creator', ao && ao.p);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    ok(await isOpen(page, '#mEdit') === false, '再読み込みしても追加画面は開き直さない');
    ok(errors.length === 0, '?ch=@handle で pageerror 0 件', errors);
    await ctx.close();
  }
  // チャンネルID・チャンネルURL
  for (const [q, want, chk] of [
    [CH_ID, CH_ID, x => x.p === 'channels' && x.params.id === CH_ID],
    [encodeURIComponent('https://www.youtube.com/channel/' + CH_ID), CH_ID, x => x.p === 'channels' && x.params.id === CH_ID],
    [encodeURIComponent('https://www.youtube.com/@urlhandle/streams'), '@urlhandle', x => x.p === 'channels' && x.params.forHandle === '@urlhandle'],
  ]) {
    const { ctx, page, errors, yt } = await open('/?ch=' + q);
    await page.waitForSelector('#mEdit.open', { timeout: 3000 }).catch(() => {});
    ok(await isOpen(page, '#mEdit') && await page.inputValue('#fChannel') === want, '?ch=' + decodeURIComponent(q) + ' → 追加画面に ' + want, await page.inputValue('#fChannel'));
    await page.waitForFunction(id => editChannel && editChannel.id === id, CH_ID, { timeout: 4000 }).catch(() => {});
    ok(yt.some(chk), '  チャンネル確認のリクエスト', yt);
    ok(await page.evaluate(() => !/[?&]ch=/.test(location.search)), '  URL から ch が消える');
    ok(errors.length === 0, '  pageerror 0 件', errors);
    await ctx.close();
  }
  // 形が正しくない値は使わない
  for (const bad of ['javascript:alert(1)', 'https://evil.example/@abc', 'https://www.youtube.com.evil.example/@abc', '@a', '<img src=x onerror=alert(1)>', 'UCshort', 'https://www.youtube.com/watch?v=abcdefghijk', 'テストチャンネル', '']) {
    const { ctx, page, errors, yt } = await open('/?ch=' + encodeURIComponent(bad) + '&utm_source=creator');
    await page.waitForTimeout(500);
    ok(await isOpen(page, '#mEdit') === false && yt.length === 0, '?ch=' + JSON.stringify(bad) + ' は無視（追加画面を開かない・確認しない）', yt);
    ok(await page.evaluate(() => location.search) === '?utm_source=creator', '  URL から ch が消える', await page.evaluate(() => location.search));
    ok(JSON.stringify(await stored(page)) === JSON.stringify([ALARM]) && errors.length === 0, '  既存のアラームは変わらない・pageerror 0 件', errors);
    await ctx.close();
  }
  // 初めての人：使い方の案内を先に出し、閉じたあとに追加画面をチャンネル入りで開く
  {
    const { ctx, page, errors } = await open('/?ch=%40firsthandle', null);
    await page.waitForTimeout(400);
    ok(await isOpen(page, '#mIntro') && !(await isOpen(page, '#mEdit')), '初めての人は使い方の案内が先（追加画面はまだ開かない）');
    ok(await page.evaluate(() => /[?&]ch=/.test(location.search)), '案内の間は URL の ch を残す');
    ok(await page.evaluate(() => document.querySelector('#mIntro').classList.contains('welcome') && document.querySelectorAll('#slides .slide').length === 1), '初めての人の案内は「はじめに」1枚');
    await page.click('#introNext');   // 「アラームを作る」を1回押すだけ
    await page.waitForTimeout(150);
    ok(!(await isOpen(page, '#mIntro')) && await isOpen(page, '#mEdit') && await page.inputValue('#fChannel') === '@firsthandle', '「アラームを作る」で追加画面が @firsthandle 入りで開く（空の追加画面ではない）', await page.inputValue('#fChannel'));
    ok(await page.evaluate(() => !!state.settings.consentAt && state.settings.introSeen === true), '  同意（consentAt）と introSeen を記録');
    await page.waitForTimeout(800);
    ok(await page.evaluate(() => state.alarms.length === 0 && !/[?&]ch=/.test(location.search)), '自動で保存しない・URL から ch が消える');
    ok(errors.length === 0, '初めての人の ?ch= で pageerror 0 件', errors);
    await ctx.close();
  }
}

/* 使ってもらうための改善（2026-11-22 の提案 1・2・4・5・6）と、鳴る画面がポップアップの下に隠れない修正 */
async function testActivation(browser, base) {
  console.log('[Task9] はじめに1枚・アラーム0件の画面・統計の wd・PC の QR・Android の画面・鳴る画面の重なり');
  const cfg = Object.assign({}, BASE_CFG, { backendUrl: 'https://prod.invalid/x', testBackendUrl: 'https://be.invalid/x' });
  const VID = 'abcdefghijk', CH = 'UCabcdefghijklmnopqrstuv';
  const KEY = 'liveAlarm.test.v1';
  async function open(u, o = {}) {
    const r = await newPage(browser, base, { config: o.config || cfg, device: o.device, viewport: o.viewport });
    const ev = [];
    if (o.clock) await r.page.clock.install({ time: o.clock });
    await r.page.route('https://prod.invalid/**', route => route.fulfill({ status: 200, body: '' }));
    await r.page.route('https://be.invalid/**', route => {
      const req = route.request();
      if (req.method() === 'POST') { try { (JSON.parse(req.postData() || 'null').e || []).forEach(x => ev.push(x)); } catch (e) {} return route.fulfill({ status: 200, body: '' }); }
      const q = new URL(req.url()).searchParams, json = b => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(b) });
      if (q.get('a') === 'yt') {
        const p = q.get('p');
        if (p === 'playlistItems') return json({ ok: true, data: { items: [{ contentDetails: { videoId: VID } }] } });
        if (p === 'videos') return json({ ok: true, data: { items: [{ id: VID, snippet: { title: 'テストのライブ配信', liveBroadcastContent: 'live', thumbnails: {} }, liveStreamingDetails: { actualStartTime: '2026-11-22T00:00:00Z' } }] } });
        return json({ ok: true, data: { items: [] } });
      }
      if (q.get('a') === 'top') return json({ ok: true, list: [] });
      return json({ ok: true });
    });
    if (o.seed) await r.page.addInitScript(([k, s]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, s); }, [KEY, JSON.stringify(o.seed)]);
    await r.page.goto(base + u, { waitUntil: 'load' });
    await r.page.waitForTimeout(o.wait || 400);
    return Object.assign(r, { ev });
  }
  const isOpen = (page, sel) => page.evaluate(s => document.querySelector(s).classList.contains('open'), sel);
  const flush = async (page) => { await page.evaluate(() => flushStats()); await page.waitForTimeout(300); };
  const ALARM = { id: 'aseed1', enabled: true, label: '', channelInput: '@seed', channelId: CH, channelTitle: 'テストチャンネル', channelThumb: '',
    mode: 'weekday', time: '06:30', days: ['', '06:30', '06:30', '06:30', '06:30', '06:30', ''], skipHolidays: false, volume: 60, preferLive: true, play: 'live' };
  const SEEN = { introSeen: true, consentAt: 1700000000000, stats: true };

  // (1) 初めて開いた時：「はじめに」1枚・同意の文言・大きな「アラームを作る」→ 追加画面
  {
    const { ctx, page, errors, ev } = await open('/', { device: 'iPhone 13' });
    ok(await isOpen(page, '#mIntro'), '初回は案内（#mIntro）が開く');
    const w = await page.evaluate(() => ({ cls: document.querySelector('#mIntro').classList.contains('welcome'), n: document.querySelectorAll('#slides .slide').length, btn: document.querySelector('#introNext').textContent, txt: document.querySelector('#slides').innerText,
      links: [...document.querySelectorAll('#slides .gfine a')].map(a => a.getAttribute('href')), more: !!document.querySelector('#introMore'), prev: getComputedStyle(document.querySelector('#introPrev')).display, close: getComputedStyle(document.querySelector('#introClose')).display }));
    ok(w.cls && w.n === 1, '初回は「はじめに」1枚だけ（3枚のスライドではない）', w);
    ok(/^アラームを作る/.test(w.btn), '大きなボタンは「アラームを作る」', w.btn);
    ok(w.txt.includes('YouTube 利用規約') && w.txt.includes('同意したものとみなされます') && w.txt.includes('匿名の利用統計') && w.txt.includes('名前やメールアドレスは送りません') && w.txt.includes('プライバシーポリシー'), '同意の文言（YouTube 利用規約・匿名の統計・プライバシーポリシー）がある', w.txt);
    ok(w.links.includes('https://www.youtube.com/t/terms') && w.links.includes('privacy.html'), '同意の文言に利用規約・プライバシーポリシーのリンク', w.links);
    ok(w.txt.includes('この画面を開いたまま'), '大事なこと（画面を開いたままにする）が書いてある');
    ok(w.more && w.prev === 'none' && w.close !== 'none', '「使い方を見る」リンクがあり、「戻る」は出ない・「閉じる」は残る', w);
    await page.click('#introNext');
    await page.waitForTimeout(200);
    ok(!(await isOpen(page, '#mIntro')) && await isOpen(page, '#mEdit'), '「アラームを作る」で追加画面（#mEdit）が開く');
    ok(await page.textContent('#editTitle') === 'アラームを追加' && await page.inputValue('#fChannel') === '', '  新しいアラームの空の追加画面');
    ok(await page.evaluate(() => !!state.settings.consentAt && state.settings.introSeen === true && JSON.parse(localStorage.getItem('liveAlarm.test.v1')).settings.consentAt > 0), '  同意（consentAt）・introSeen を記録して保存');
    await flush(page);
    const iv = ev.find(x => x.n === 'intro_view'), done = ev.find(x => x.n === 'intro_done');
    ok(!!iv && iv.p.total === 1 && iv.p.w === 1 && !!done && done.p.w === 1 && done.p.consent === true, '統計：intro_view { total:1, w:1 }・intro_done { w:1, consent }', { iv, done });
    const ao = ev.find(x => x.n === 'app_open');
    ok(!!ao && ao.p.wd === 1 && typeof ao.p.lang === 'string' && ao.p.lang.length > 0, '統計：app_open に wd（自動操作のブラウザは 1）と lang', ao && ao.p);
    ok(errors.length === 0, '初回の「はじめに」で pageerror 0 件', errors);
    await ctx.close();
  }
  // (1b) 「使い方を見る」→ 今までの3枚。最後の「同意してはじめる」でも追加画面
  {
    const { ctx, page, errors } = await open('/', { viewport: { width: 1280, height: 800 } });
    await page.click('#introMore');
    await page.waitForTimeout(150);
    const f = await page.evaluate(() => ({ cls: document.querySelector('#mIntro').classList.contains('welcome'), n: document.querySelectorAll('#slides .slide').length, dots: document.querySelectorAll('#dots i').length, btn: document.querySelector('#introNext').textContent }));
    ok(!f.cls && f.n === 3 && f.dots === 3 && f.btn === '次へ', '「使い方を見る」で今までの3枚のスライドになる', f);
    for (let i = 0; i < 2; i++) { await page.click('#introNext'); await page.waitForTimeout(60); }
    const last = await page.evaluate(() => ({ btn: document.querySelector('#introNext').textContent, txt: document.querySelector('#slides .slide.on').innerText }));
    ok(last.btn === '同意してはじめる' && last.txt.includes('YouTube 利用規約') && last.txt.includes('匿名の利用統計'), '  3枚目は今までどおり同意の文言と「同意してはじめる」', last.btn);
    await page.click('#introNext'); await page.waitForTimeout(150);
    ok(!(await isOpen(page, '#mIntro')) && await isOpen(page, '#mEdit'), '  「同意してはじめる」で追加画面が開く');
    ok(errors.length === 0, '「使い方を見る」で pageerror 0 件', errors);
    await ctx.close();
  }
  // (1c) 個人モード（サーバーなし）でも「はじめに」。APIキーの案内あり・同意の文言なし
  {
    const { ctx, page, errors } = await open('/', { config: BASE_CFG });
    const t = await page.evaluate(() => ({ cls: document.querySelector('#mIntro').classList.contains('welcome'), txt: document.querySelector('#slides').innerText }));
    ok(t.cls && t.txt.includes('APIキー') && !t.txt.includes('同意したものとみなされます'), '個人モードの「はじめに」は APIキーの案内つき・同意の文言なし', t.txt);
    ok(errors.length === 0, '個人モードの「はじめに」で pageerror 0 件', errors);
    await ctx.close();
  }
  // (2) アラーム0件のトップ画面：#firstRun の大きなボタン1つ。「画面を暗くする」「＋ 追加」は隠す
  {
    const { ctx, page, errors, ev } = await open('/', { device: 'iPhone 13' });
    await page.click('#introClose');
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => !!state.settings.consentAt), '「✕ 閉じる」でも今までどおり同意を記録');
    const vis = {}; for (const s of ['#firstRun', '#btnFirstRun', '#btnStandby', '#standbyHint', '#btnAdd', '#alarmList .empty', '.hero']) vis[s] = await page.isVisible(s);
    ok(vis['#firstRun'] && vis['#btnFirstRun'], '0件の時は #firstRun と大きな「＋ 最初のアラームを作る」が見える', vis);
    ok(!vis['#btnStandby'] && !vis['#standbyHint'] && !vis['#btnAdd'] && !vis['#alarmList .empty'] && !vis['.hero'], '  「画面を暗くする」・その説明・「＋ 追加」・空のカードは隠れる', vis);
    const big = await page.evaluate(() => { const b = document.querySelector('#btnFirstRun').getBoundingClientRect(); return { w: b.width, h: b.height, top: b.top }; });
    ok(big.h >= 50 && big.w >= 250 && big.top < 844, '  ボタンは大きく、最初の画面の中にある', big);
    await page.click('#btnFirstRun'); await page.waitForTimeout(150);
    ok(await isOpen(page, '#mEdit') && await page.textContent('#editTitle') === 'アラームを追加', '  押すと追加画面が開く');
    await flush(page);
    ok(ev.some(x => x.n === 'first_run_add'), '  統計 first_run_add');
    ok(errors.length === 0, '0件の画面で pageerror 0 件', errors);
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open('/', { seed: { alarms: [ALARM], settings: SEEN }, device: 'iPhone 13' });
    const vis = {}; for (const s of ['#firstRun', '#btnStandby', '#btnAdd', '.hero']) vis[s] = await page.isVisible(s);
    ok(!vis['#firstRun'] && vis['#btnStandby'] && vis['#btnAdd'] && vis['.hero'], 'アラームが1件あれば今までの画面（「画面を暗くする」「＋ 追加」あり・#firstRun なし）', vis);
    ok(!(await isOpen(page, '#mIntro')), '  2回目以降は案内を自動で出さない');
    ok(errors.length === 0, '1件ある画面で pageerror 0 件', errors);
    await ctx.close();
  }
  // (5) PC だけ「スマホで開く」QR コード（静的な SVG・ライブラリなし）
  {
    const { ctx, page, errors } = await open('/', { viewport: { width: 1280, height: 800 }, seed: { alarms: [], settings: SEEN } });
    const q = await page.evaluate(() => { const b = document.querySelector('#pcQr'), s = b && b.querySelector('svg'); return b && { vis: !b.hidden && getComputedStyle(b).display !== 'none', svg: !!s, vb: s && s.getAttribute('viewBox'), label: s && s.getAttribute('aria-label'), d: s && s.querySelector('path[stroke]') && s.querySelector('path[stroke]').getAttribute('d').length, txt: b.innerText }; });
    ok(!!q && q.vis && q.svg && q.vb === '0 0 41 41' && q.d > 500, 'PC では #pcQr（インラインの SVG の QR コード）が見える', q);
    ok(!!q && /https:\/\/nagara-alarm\.pages\.dev\/\?utm_source=qr/.test(q.label) && q.txt.includes('スマホで開く'), '  QR の中身（utm_source=qr）と「スマホで開く」', q && q.label);
    const scripts = await page.evaluate(() => [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')));
    ok(scripts.every(x => /^config\.js/.test(x) || x === 'https://www.youtube.com/iframe_api'), '  QR 用のスクリプトは読まない（config.js と YouTube 公式プレーヤーだけ）', scripts);
    ok(errors.length === 0, 'PC の QR で pageerror 0 件', errors);
    await ctx.close();
  }
  {
    const { ctx, page } = await open('/', { device: 'iPhone 13', seed: { alarms: [], settings: SEEN } });
    ok(await page.isVisible('#pcQr') === false, 'スマホでは #pcQr を出さない');
    await ctx.close();
  }
  // (6) 非対応ブラウザ（Android）の画面：「Androidでも使いたい」→ android_wish を送って about.html へ
  {
    const { ctx, page, errors, ev } = await open('/', { device: 'Pixel 5' });
    ok(await isOpen(page, '#block'), 'Android では今までどおり #block（非対応）を出す');
    ok(await page.isVisible('#btnAndroidWish') && await page.textContent('#btnAndroidWish') === 'Androidでも使いたい' && await attr(page, '#btnAndroidWish', 'href') === 'about.html', '  「Androidでも使いたい」ボタン（about.html へのリンク）');
    ok(await page.isVisible('#btnCopyUrl') && (await page.textContent('#blockMsg')).includes('iPhone の Safari 専用'), '  URL をコピー・文言は今までどおり');
    ok(!(await isOpen(page, '#mIntro')), '  #block の時は案内を出さない（今までどおり）');
    await page.evaluate(() => { document.addEventListener('click', e => e.preventDefault(), { once: true }); document.querySelector('#btnAndroidWish').click(); });
    await page.waitForTimeout(500);
    const w = ev.find(x => x.n === 'android_wish');
    ok(!!w && w.p.os === 'android', '  押すと統計 android_wish { os:"android" } を送る（すぐ送信）', w);
    await page.click('#btnAndroidWish');
    await page.waitForURL(/about\.html/, { timeout: 3000 }).catch(() => {});
    ok(/\/about\.html$/.test(page.url()), '  about.html に移動する', page.url());
    ok(errors.length === 0, 'Android の画面で pageerror 0 件', errors);
    await ctx.close();
  }
  // (信頼性) 鳴る画面（#ring）はどのポップアップよりも前・#block と通知（toast）より後ろ
  {
    const { ctx, page, errors } = await open('/', { seed: { alarms: [ALARM], settings: SEEN }, viewport: { width: 390, height: 844 } });
    const z = await page.evaluate(() => { const g = s => +getComputedStyle(document.querySelector(s)).zIndex; return { ring: g('#ring'), block: g('#block'), toast: g('#toast'), modals: [...document.querySelectorAll('.modal')].map(m => [m.id, g('#' + m.id)]) }; });
    ok(z.modals.every(([, v]) => v < z.ring) && z.ring < z.block && z.ring < z.toast, '#ring の z-index は全ポップアップより上・#block と toast より下', z);
    for (const id of ['mGuide', 'mA2hs', 'mError', 'mReset', 'mEdit', 'mSettings', 'mIntro', 'mInApp']) {
      const top = await page.evaluate(id => {
        openModal(id); document.querySelector('#ring').classList.add('open');
        const b = document.querySelector('#rClose').getBoundingClientRect();
        const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        const r = el && el.id;
        document.querySelector('#ring').classList.remove('open'); document.querySelector('#' + id).classList.remove('open');
        return r;
      }, id);
      ok(top === 'rClose', '#' + id + ' を開いたままでも、鳴る画面の「OK」が一番前', top);
    }
    ok(errors.length === 0, '重なりの確認で pageerror 0 件', errors);
    await ctx.close();
  }
  // (信頼性) 本当に鳴らす：1分後のアラーム・サーバーはテスト用の返事・APIキーの取り方（#mGuide）を開いたまま
  //   REAL_FIRE=1 の時は実際の時計で1分待つ（ふだんは Playwright の時計で早送り）
  {
    const real = process.env.REAL_FIRE === '1';
    let start;
    if (real) { start = new Date(); } else { const d = new Date(); start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0, 50); }
    const at = new Date(start.getTime() + 60 * 1000);
    const hhmm = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0');
    const A = Object.assign({}, ALARM, { id: 'afire1', mode: 'everyday', time: hhmm, savedAt: start.getTime() - 1000 });
    const { ctx, page, errors, ev } = await open('/', { seed: { alarms: [A], settings: SEEN }, viewport: { width: 390, height: 844 }, clock: real ? undefined : start });
    await page.evaluate(() => openGuide());
    ok(await isOpen(page, '#mGuide') && !(await isOpen(page, '#ring')), '鳴る前：#mGuide が開いている・#ring は閉じている');
    if (real) {
      const ms = at.getTime() - Date.now();
      console.log('       (実際の時計で ' + Math.round(ms / 1000) + ' 秒待ちます：アラーム ' + hhmm + ')');
      await page.waitForFunction(() => document.querySelector('#ring').classList.contains('open'), null, { timeout: ms + 15000, polling: 500 }).catch(() => {});
    } else {
      await page.clock.fastForward(15000);
      await page.waitForFunction(() => document.querySelector('#ring').classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
    }
    ok(await isOpen(page, '#ring'), 'アラームの時刻に #ring が開く（' + (real ? '実際の時計' : '早送り') + '・' + hhmm + '）');
    await page.waitForFunction(() => /テストのライブ配信/.test(document.querySelector('#rName').textContent), null, { timeout: 5000 }).catch(() => {});
    ok((await page.textContent('#rName')).includes('テストのライブ配信'), '  テスト用サーバーの返事のライブ配信を流す', await page.textContent('#rName'));
    const top = await page.evaluate(() => { const r = [], pts = [[0.5, 0.15], [0.5, 0.5]]; for (const [x, y] of pts) { const el = document.elementFromPoint(innerWidth * x, innerHeight * y); r.push(!!(el && el.closest('#ring'))); } const b = document.querySelector('#rClose').getBoundingClientRect(); const c = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); r.push(c && c.id); return r; });
    ok(top[0] && top[1] && top[2] === 'rClose', '  #mGuide を開いたままでも、鳴る画面が一番前（中央・上・「OK」ボタン）', top);
    ok(await isOpen(page, '#mGuide'), '  #mGuide は閉じられていない（鳴る処理は変えていない）');
    await flush(page);
    ok(ev.some(x => x.n === 'alarm_fire' && x.p.ch === CH), '  統計 alarm_fire を送る');
    await page.click('#rClose');
    await page.waitForTimeout(200);
    ok(!(await isOpen(page, '#ring')), '  「OK」で鳴る画面を閉じられる');
    ok(errors.length === 0, '本当に鳴らす確認で pageerror 0 件', errors);
    await ctx.close();
  }
}

/* 公式SNS（TikTok・X）へのリンク：HP・グッズ・ガイド記事のフッターに、ふつうのリンクとして置く（埋め込み・外部スクリプトなし） */
function testSnsLinks() {
  console.log('[Task8] 公式SNSのリンク');
  const fs = require('fs');
  const files = ['about.html', 'goods.html', 'test/about.html', 'test/goods.html'].concat(fs.readdirSync(path.join(ROOT, 'guide')).filter(f => /\.html$/.test(f)).map(f => 'guide/' + f));
  for (const f of files) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const foot = (html.match(/<footer>[\s\S]*?<\/footer>/) || [''])[0];
    const sns = (foot.match(/<p class="sns">[\s\S]*?<\/p>/) || [''])[0];
    ok(/公式SNS/.test(sns)
      && /<a href="https:\/\/www\.tiktok\.com\/@nagara_create7" target="_blank" rel="noopener"[^>]*>TikTok<\/a>/.test(sns)
      && /<a href="https:\/\/x\.com\/nagara_protein" target="_blank" rel="noopener"[^>]*>X（Twitter）<\/a>/.test(sns), f + ' のフッターに公式SNS（TikTok・X）のリンク');
    ok(!/<script[^>]+(tiktok|twitter|x\.com)/i.test(html) && !/<(iframe|blockquote)[^>]+(tiktok|twitter)/i.test(html), f + ' に SNS の埋め込み・外部スクリプトがない');
  }
}

/* goods.html が参照する img/ 以下の画像が実在するか（別作業で作成中のため最後に確認） */
function testGoodsImages() {
  console.log('[Task5] goods.html の画像ファイル');
  const fs = require('fs');
  for (const f of ['goods.html', 'test/goods.html']) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const srcs = [...html.matchAll(/<img [^>]*src="([^"]+)"/g)].map(m => m[1]).filter(s => /^\/?img\//.test(s));
    ok(srcs.length > 0, f + ' が img/ の画像を参照している', srcs.length);
    const missing = srcs.filter(s => !fs.existsSync(path.join(ROOT, s.replace(/^\//, ''))));
    ok(missing.length === 0, f + ' が参照する img/ の画像がすべて存在する', missing);
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
    await testHpStats(browser, base);
    await testGuides(browser, base);
    await testChLink(browser, base);
    await testActivation(browser, base);
    testSnsLinks();
    testGoodsImages();
  } catch (e) {
    failed++; console.log('  FAIL 例外: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    proc.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
