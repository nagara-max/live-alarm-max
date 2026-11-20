# 収益化 フェーズ1（縮小版）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アラームの動作に一切触れずに、応援リンク・おすすめグッズページ（アフィリエイト）・プライバシーポリシーの是正を公開できる状態にする。

**Architecture:** 静的 HTML の追加と文言変更のみ。アプリ本体（index.html）は⚙設定モーダルに HTML 数行と、独立した小さな `<script>`（応援リンクの表示切替だけ）を足す。外部スクリプト・広告スクリプトは一切読み込まない。

**Tech Stack:** 素の HTML/CSS/JS（既存と同じ）。確認は bash の grep と Playwright（プリインストール済み）。

**Spec:** `docs/superpowers/specs/2026-11-19-monetization-design.md`（「チェックチームのレビュー」→「推奨する縮小版フェーズ1」が正。6.3〜6.7 は文案の参照元）

## Global Constraints

- `index.html` に `googlesyndication` / `doubleclick` / `adsbygoogle` / `amazon-adsystem` を含めない。外部 `<script src>` を新規追加しない（全ファイル共通）。
- `#ring`（鳴動画面）・`#standby`（おやすみモード）・トップのヒーロー／`#btnStandby` 付近には何も置かない。アプリからの入口は ⚙設定（`#mSettings`）の中だけ。
- `tick()` / `fire()` / `showRing()` / `primeForMorning()` / `startStandby()` / `render()` など既存 JS ロジックは変更しない。
- アプリ内リンクは同じタブ（`target="_blank"` にしない）。
- 応援リンクは `config.js` の `tipUrl` が `https://` で始まる時だけ表示。空なら非表示。ラベル「☕ 開発を応援する（任意。機能は変わりません）」。
- goods.html：冒頭（最初の画面内）に「本ページはプロモーション（広告）を含みます」、末尾に「Amazonのアソシエイトとして、<運営者名>は適格販売により収入を得ています。」、上部に常時固定の帯「⏰ アラームはアプリの画面を開いている時だけ鳴ります → アプリに戻る」。価格・商品画像は書かない（テキストリンクのみ）。
- アフィリエイト ID は未取得。リンクは通常の検索 URL で置き、各リンクに `<!-- TODO(owner): もしもアフィリエイトのリンクに差し替え -->` を付ける。
- privacy.html の「現在、本サービスに広告はありません。」は残す（AdSense を入れないため事実のまま）。
- `test/` の index.html / about.html / privacy.html / config.js は現在ルートと完全に同一。変更後もルートと同一に保つ（goods.html も test/ にコピー）。
- `APP_VERSION` を `'1.14.0'` → `'1.14.1'`、`config.js?v=1.9.6` → `config.js?v=1.9.7`（index.html 677行）。about.html・privacy.html の `config.js` 読み込みにも `?v=1.9.7` を付ける。

## Review Focus

1. **tipUrl が空／http／javascript: の時**：応援リンクが表示されない（XSS 経路にならない）。→ Task 1 のテスト。
2. **iPhone ホーム画面版で goods.html を開いてそのまま寝る**：帯が常に見え、押すと `./` に戻る。→ Task 2 のテスト（帯の存在・href・position:fixed/sticky）。
3. **config.js が読めない（オフライン等）**：応援スクリプトが例外を出さずアプリが通常起動する。→ Task 1 のテスト（`LIVE_ALARM_CONFIG` 未定義でもエラーなし）。
4. **鳴動・おやすみ画面への混入**：`#ring` / `#standby` 内に tip/goods 要素がない。→ Task 4 のガード。
5. **test/ とルートのずれ**：コピー漏れ。→ Task 4 のガードで `diff -q`。

---

### Task 1: 応援リンクとグッズへの入口（config.js・index.html）

**Files:**
- Modify: `config.js`（`contact` の後に `tipUrl: ''` とコメント）
- Modify: `index.html`：677行 `?v=1.9.7`、705行 `APP_VERSION = '1.14.1'`、537行のバージョン欄 `<div class="field" style="margin-top:14px;…">` の直前に `<div class="field" id="boxSupport">` を追加
- Test: `tools/guard/phase1.spec.js`（Task 4 で作るガードと同じファイル。ここでは tip 部分のテストを先に書く）

**Interfaces:**
- Produces: `#boxSupport` 内に `a#lnkTip`（初期 `hidden`、href は JS で設定）と `a#lnkGoods`（`href="goods.html"`、常時表示、文言「🛏 寝る前のおすすめグッズ」）。`config.js` の `window.LIVE_ALARM_CONFIG.tipUrl: string`。

- [ ] **Step 1: テストを書く**（Playwright、`python3 -m http.server` で配信したルートを開く）
  - `tipUrl` 空 → `#lnkTip` が非表示、`#lnkGoods` の href が `goods.html`
  - `page.route('**/config.js*')` で `tipUrl:'https://ofuse.me/example'` を返す → `#lnkTip` 表示・href 一致・`target` 属性なし
  - `tipUrl:'javascript:alert(1)'` / `'http://x'` → 非表示
  - config.js を 404 にする → `pageerror` が 0 件
- [ ] **Step 2: 実行して失敗を確認**：`node tools/guard/phase1.spec.js` → `#lnkTip` が見つからず FAIL
- [ ] **Step 3: 実装**：HTML を追加し、本体スクリプトとは別の `<script>`（`#boxSupport` の直後、IIFE、try/catch）で `/^https:\/\//.test(cfg.tipUrl)` の時だけ `href` を設定し `hidden` を外す。既存スタイル（`.field` `.flabel` `.btn sm ghost`）を使う。
- [ ] **Step 4: テストが通ることを確認**
- [ ] **Step 5: Commit**

### Task 2: goods.html（寝る前セットアップガイド）

**Files:**
- Create: `goods.html`（about.html の `<head>`・配色・フォント・footer の作りを踏襲。`<link rel="canonical" href="https://nagara-alarm.pages.dev/goods">`）
- Modify: `sitemap.xml`（`/goods` を追加、lastmod 2026-11-19）
- Modify: `about.html`：FAQ「画面をロックしても鳴りますか？」の回答末尾に `<a href="goods.html">寝る前のおすすめグッズ</a>` への内部リンク

**Interfaces:**
- Consumes: `config.js` の `operator`（Amazon 文言の運営者名。about.html 352–358 と同じ方式で `#operator` に流し込む）

- [ ] **Step 1: テストを書く**：`goods.html` を開き
  - 帯 `#backBar` が存在し、`a[href="./"]` を含み、computed `position` が `fixed` か `sticky`
  - 「本ページはプロモーション（広告）を含みます」が viewport 390×844 で最初の画面内（boundingBox.y < 844）
  - 「Amazonのアソシエイトとして」を含む
  - `img` に amazon/rakuten の src がない、`¥`/`円` の価格表記がない
  - 外部 `<script src>` が config.js 以外ない
- [ ] **Step 2: 失敗を確認**（ファイルなし）
- [ ] **Step 3: 実装**：設計書 6.4 の内容（スタンド・長いケーブル/MagSafe・Bluetooth スピーカー（出力先の注意）・普通の目覚まし時計の併用・設定のコツ：自動ロック「なし」/低電力モード/明るさ）を実用記事として書く。商品はテキストリンク（`rel="sponsored noopener"`、`target="_blank"`）＋ TODO コメント。
- [ ] **Step 4: テストが通ることを確認**
- [ ] **Step 5: Commit**

### Task 3: privacy.html・about.html の文言

**Files:**
- Modify: `privacy.html`：最終更新を「2026年11月19日」。4章の表を3列「送信先／送信される情報／目的」にし、行を追加：Google Fonts（fonts.googleapis.com・fonts.gstatic.com）、YouTube Data API（www.googleapis.com、個人モードのみ）、アフィリエイト（もしもアフィリエイト・Amazon・楽天：リンク先で各社の Cookie）、応援サービス（リンク先でのみ情報を扱う）。表の下に「各社には通信の仕組み上 IP アドレス・ブラウザ情報・閲覧ページ等が送られます」。「紹介リンクについて」段落（アソシエイト参加・PR 表示の方針）を追加。5章に「応援は任意で、機能は変わりません」。`config.js?v=1.9.7`。
- Modify: `about.html`：`#biz` 企業ボックスの `<ul>` に「起床時の再生画面・おやすみ画面には広告を表示しません」「紹介ページ（HP）内での掲載」を追加。FAQ に「広告はありますか？」（答：アプリの画面にはありません。紹介ページの一部に商品紹介リンク（PR）があります）。footer の links に応援リンク `a#lnkTip`（Task 1 と同じ判定、既存 IIFE 352–358 内で設定）。`config.js?v=1.9.7`。

- [ ] **Step 1: テストを書く**：privacy の4章表のヘッダが3列、`fonts.googleapis.com` を含む、「現在、本サービスに広告はありません」を含む。about の FAQ に「広告はありますか？」、`tipUrl` 空で footer の `#lnkTip` 非表示
- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4: 通過確認** → **Step 5: Commit**

### Task 4: 監視ガードと test/ 同期

**Files:**
- Create: `tools/guard/phase1.spec.js`（Task 1–3 のテストをまとめる。Playwright を `require('playwright')` で直接使う node スクリプト。サーバーは自前で `python3 -m http.server` を子プロセス起動）
- Create: `tools/guard/check.sh`：(1) `grep -E 'googlesyndication|doubleclick|adsbygoogle|amazon-adsystem' index.html test/index.html` が 0 件 (2) `#ring`・`#standby` の要素ブロック内に `lnkTip`/`lnkGoods` がない (3) `diff -q` で index/about/privacy/config/goods がルートと test/ で同一 (4) `node tools/guard/phase1.spec.js`。全部通れば `OK` を出して exit 0。
- Copy: `index.html about.html privacy.html config.js goods.html` → `test/`

- [ ] **Step 1:** check.sh を書き、test/ コピー前に実行して (3) が FAIL することを確認
- [ ] **Step 2:** コピーして `bash tools/guard/check.sh` → `OK`
- [ ] **Step 3:** 既存アプリの起動確認：Playwright で `/` を開き `pageerror` 0 件、`#btnStandby` が見える
- [ ] **Step 4: Commit**

## オーナー作業（実装外）
- OFUSE 等のページを作り `config.js` の `tipUrl` に URL を入れる（test/config.js も）
- もしもアフィリエイトに登録し、goods.html の TODO リンクを差し替え
- iPhone 実機で「テスト再生」「おやすみ→鳴動」を1回確認してから main に反映
