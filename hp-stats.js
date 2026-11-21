/* =========================================================
 * HP（グッズのページ・ガイド記事）の匿名の閲覧統計
 *  - about.html の send() と同じ送り方・同じイベント名（hp_view / hp_scroll / hp_cta / hp_leave）・同じ c（v:'hp'）
 *  - 違いは各イベントの p に pg（ページ名。例：goods、guide/morning-coffee）を足すことだけ
 *  - 商品の紹介リンク（もしも経由の楽天リンク）を押した時は hp_cta { where: 'aff:<商品名>' }
 *    アプリを開くリンクは hp_cta { where: 'app' }、data-cta 付きのリンク（Xで共有など）は hp_cta { where: data-cta }
 *  - テスト環境・統計オフ（アプリの⚙設定）・古い住所（GitHub Pages）の扱いは about.html と同じ
 *  - 送信は sendBeacon（なければ fetch keepalive）。クリックの移動は止めない
 *  - config.js の後に読み込む。何が起きてもページの表示・リンクには影響しない
 * ========================================================= */
(function () {
  'use strict';
  try {
    var c = window.LIVE_ALARM_CONFIG || {}, isTest = /\/test\//.test(location.pathname) || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    var url = isTest ? c.testBackendUrl : c.backendUrl;
    if (!url || location.hostname === 'nagara-max.github.io') return;
    var SK = isTest ? 'liveAlarm.test.v1' : 'liveAlarm.v1', UK = isTest ? 'liveAlarm.test.uid' : 'liveAlarm.uid', HK = isTest ? 'liveAlarm.test.uidByHp' : 'liveAlarm.uidByHp';
    var uid = '';
    try {
      var st = JSON.parse(localStorage.getItem(SK) || 'null');
      if (st && st.settings && st.settings.stats === false) return;
      uid = localStorage.getItem(UK);
      if (!uid) { uid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12); localStorage.setItem(UK, uid); localStorage.setItem(HK, '1'); }
    } catch (e) { uid = 'nostore-' + Math.random().toString(36).slice(2, 12); }

    // ページ名：/goods → goods、/guide/morning-coffee(.html) → guide/morning-coffee、/guide/ → guide/index（/test/ は外す）
    var pg = location.pathname.replace(/^\/test\//, '/').replace(/\.html$/, '').replace(/\/$/, '/index').replace(/^\//, '').slice(0, 40) || 'index';

    var ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua);
    var nonSafari = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|Brave|Line\/|FBAN|FBAV|FBIOS|Instagram|Twitter|MicroMessenger|KAKAOTALK|Snapchat|Pinterest|YJApp|Yahoo|BytedanceWebview|musical_ly|TikTok/i;
    var inapp = ios && navigator.standalone !== true && !(/Safari\//.test(ua) && /Version\//.test(ua) && !nonSafari.test(ua));
    var sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), seq = 0, t0 = Date.now(), maxD = 0;
    var br = /Line\//.test(ua) ? 'LINE' : /Instagram|FBAN|FBAV|Twitter|TikTok/.test(ua) ? 'SNSアプリ内' : /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'その他';
    var ctx = { u: uid, v: 'hp', env: isTest ? 'test' : 'prod', pf: ios ? 'ios' : /Android/.test(ua) ? 'android' : /Mobile/.test(ua) ? 'mobile' : 'pc', sa: 0, br: br };
    var send = function (n, p) {
      p = p || {}; p.pg = pg;
      var body = JSON.stringify({ c: ctx, e: [{ n: n, t: Date.now(), s: sid, q: ++seq, p: p }] });
      try { if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return; } catch (e) {}
      try { fetch(url, { method: 'POST', body: body, mode: 'no-cors', keepalive: true }).catch(function () {}); } catch (e) {}
    };

    var q = new URLSearchParams(location.search), ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    send('hp_view', { src: (q.get('utm_source') || q.get('ref') || '').slice(0, 40), med: (q.get('utm_medium') || '').slice(0, 30), cmp: (q.get('utm_campaign') || '').slice(0, 40), ref: ref, inapp: inapp ? 1 : 0, w: innerWidth });

    var marks = [25, 50, 75, 100], sent = {};
    addEventListener('scroll', function () {
      var h = document.documentElement.scrollHeight - innerHeight, d = h > 0 ? Math.round(scrollY / h * 100) : 100;
      if (d > maxD) maxD = d;
      marks.forEach(function (m) { if (maxD >= m && !sent[m]) { sent[m] = 1; send('hp_scroll', { d: m }); } });
    }, { passive: true });

    // クリック（移動は止めない：preventDefault しない）
    document.addEventListener('click', function (e) {
      try {
        var a = e.target && e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        var href = a.getAttribute('href') || '', where = '';
        if (a.hasAttribute('data-cta')) where = a.getAttribute('data-cta');
        else if (/^https:\/\/af\.moshimo\.com\//.test(href)) {
          var name = (a.firstChild && a.firstChild.nodeType === 3 ? a.firstChild.nodeValue : a.textContent) || '';
          where = 'aff:' + name.replace(/\s+/g, ' ').trim();
        } else if (/^(\.\.?\/)+(\?|$)/.test(href)) where = 'app';
        if (where) send('hp_cta', { where: where.slice(0, 60) });
      } catch (err) {}
    }, true);

    var left = false;
    var leave = function () { if (left) return; left = true; send('hp_leave', { sec: Math.round((Date.now() - t0) / 1000), d: maxD }); };
    addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') leave(); });
  } catch (e) {}
})();
