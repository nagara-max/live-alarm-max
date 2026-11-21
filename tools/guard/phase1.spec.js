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
  ok(/<loc>https:\/\/nagara-alarm\.pages\.dev\/goods<\/loc><lastmod>2026-11-19<\/lastmod>/.test(sm), 'sitemap.xml に /goods（lastmod 2026-11-19）');
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
    ok(body.includes('最終更新：2026年11月21日'), '最終更新が 2026年11月21日');
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
    ok(await page.isVisible('#btnStandby'), u + ' で #btnStandby が見える');
    const mixed = await page.evaluate(() => ['#ring', '#standby'].map(s => document.querySelector(s)).filter(Boolean)
      .some(el => el.querySelector('#lnkTip, #lnkGoods, #boxSupport, a[href*="goods.html"]')));
    ok(mixed === false, u + ' の #ring・#standby の中に応援・グッズの要素がない');
    const ver = await page.evaluate(() => { const m = document.documentElement.innerHTML.match(/const APP_VERSION = '([\d.]+)'/); return m && m[1]; });
    ok(ver === '1.14.2', u + ' の APP_VERSION が 1.14.2', ver);
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
