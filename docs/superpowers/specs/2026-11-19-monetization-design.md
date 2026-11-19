# 収益化 設計書（広告・アフィリエイト・応援・スポンサー）

- 作成日：2026-11-19
- 作成：提案プランチーム
- 対象：nagara-alarm.pages.dev（`index.html` / `about.html` / `privacy.html` / `config.js` / `test/`）
- 状態：提案（未実装。既存ファイルは一切変更していません）
- 行番号は 2026-11-19 時点の `index.html`（APP_VERSION `1.14.0`）のものです。実装時は関数名・ID で探してください。

---

## 1. 目的と理由

- 運営費（ドメイン・将来のサーバー・開発時間）をまかない、継続的に改善できる状態にする。
- オーナーの方針：**広告は OK。ただしアラームの瞬間（鳴動・起床時の再生画面）を邪魔したり隠したりしないこと。アラームが確実に鳴ることを危うくしないこと。**
- このアプリの価値の 100% は「朝、確実に鳴ること」。1回の寝坊は、何か月分の広告収入より大きな損失（利用者離れ・口コミ悪化）になる。したがって設計の優先順位は **安全 ＞ 収益** とする。

## 2. ゴール / 非ゴール / アンチゴール

### ゴール
1. config.js に ID を入れるまでは **何も変わらない**（広告スクリプトを1バイトも読み込まない）。
2. 収益源を複数持つ（広告だけに依存しない）：AdSense・アフィリエイト・応援（投げ銭）・スポンサー。
3. 広告は「起きている人が操作している画面」にだけ出す。
4. 自動チェック（Playwright）と本番の自己監視（統計イベント）で、ガードが壊れていないことを継続的に確認できる。
5. AdSense・Amazon アソシエイト・景品表示法（ステマ規制）・電気通信事業法の外部送信規律に沿った表示。

### 非ゴール
- 有料プラン・課金基盤の実装（フェーズ4で検討のみ）。
- 広告の最適化（A/B テストによる単価最大化）は初期スコープ外。
- Android 対応・ネイティブアプリ化。

### アンチゴール（絶対に起こしてはいけないこと）
- **A1：アラームが鳴らない／遅れる**（ページ遷移・タブ離脱・クラッシュ・メモリ不足・メインスレッド占有で `tick()` が止まる）。
- **A2：鳴動画面（`#ring`）・おやすみモード（`#standby`）・朝の準備（`#ring.prime`）・テスト再生の上に、広告やポップアップが出る。**
- **A3：iPhone Safari の自動再生・音声セッションを壊す**（広告の動画/音声が `audioSession`・Now Playing・`silentEl` のループ再生・`primedAt` の状態を乱す）。
- A4：夜通し画面を点けたまま（Wake Lock）の端末で広告が動き続け、電池・発熱・無効なインプレッション（人が見ていない表示）を生む。
- A5：誤タップでアプリから離脱し、そのまま寝てしまう（＝朝鳴らない）。
- A6：テスト環境（`/test/`・localhost・`?env=test`）で本番の広告を出す（無効クリック・審査への悪影響）。

---

## 3. 現状の把握（画面と切り替えの地図）

### 3.1 画面・状態の一覧（index.html）

| 画面 / 状態 | 要素 ID（行） | 開く処理 | 閉じる処理 | z-index | 広告 |
|---|---|---|---|---|---|
| トップ（次のアラーム・一覧） | `#app` 367–407。ヒーロー `section.hero` 390–397（`#btnStandby` 395）、`#alarmList` 403、`.foot` 405–406 | 常時 | `startStandby()` で `#app.fadeout`（opacity 0。**DOM には残る**） | — | **条件付きで可**（フェーズ3） |
| アラーム追加/編集 | `#mEdit` 410–484 | `openEditor()` 2009 | `closeModal('mEdit')` 1924 | 50 | 不可（入力中の誤タップで編集内容が消える）。※「おすすめ」欄の PR 枠のみ可（後述） |
| 設定 | `#mSettings` 487–549 | `openSettings()` 2403 | `closeModal` | 50 | 広告不可。**応援リンク（静的テキスト）のみ可**（537–543 のバージョン欄の上） |
| APIキーの取り方 | `#mGuide` 552–560 | `openGuide()` 1955 | `closeModal` | 80 | 不可 |
| エラー | `#mError` 563–566 | `showError()` 1140 | `closeModal` | 85 | 不可 |
| 全削除の確認 | `#mReset` 569–575 | 設定から | `closeModal` | 90 | 不可 |
| アプリ内ブラウザ→Safari 案内 | `#mInApp` 578–585、`#inappBar` 369 | `openInAppSheet()` 2815 | `closeInAppSheet()` 2832 | 50 | 不可 |
| 引っ越し案内 / 完了 | `#mMove` 587 / `#mMoved` 595 | `openMove()` 2762 / boot | `closeModal` | 50 | 不可 |
| ホーム画面に追加 | `#mA2hs` 602–619、`#a2hsCard` 388 | `openA2hs()` 2672 | `closeModal` | 83 | 不可 |
| 使い方（初回・同意） | `#mIntro` 622–633 | `openIntro()` 2586 | `closeModal('mIntro')` | 50 | 不可（初回体験・同意画面） |
| **おやすみモード** | `#standby` 636–645 | `startStandby()` 1799（`#btnStandby` click 2506、`#rClose` 2529 からも） | `stopStandby()` 1816（`#sbExit` 2513） | 40 | **絶対不可** |
| **朝の準備（prime）** | `#ring.open.prime` | `primeForMorning()` 1592（1598 で直接 class 付与。`showRing` を通らない） | `endPrime()` 1629 | 60 | **絶対不可** |
| **鳴動・再生画面** | `#ring` 648–661（`#ytHolder` 651, `#tapSound` 652） | `fire()` 1643 → `showRing()` 1733 → `startVideo()` 1667 | `closeRing()` 1743（`#rClose` 2525） | 60 | **絶対不可** |
| テスト再生 / 再生テスト | `#ring`（`ringIsTest` / `testMode`） | 一覧の `data-play` → `fire(a,true)`、`primePlayer()` 1842 | `closeRing()` | 60 | **絶対不可**（YouTube API ポリシー上も、プレーヤー主体の画面に広告は置かない） |
| 非対応ブラウザ | `#block` 664–671 | `boot()` 2860–2865 | — | 100 | 不可（行き止まり画面・価値の低い画面） |
| トースト | `#toast` 674 | `toast()` 839 | 自動 | 200 | — |

### 3.2 アラームが鳴る仕組み（広告が干渉しうる箇所）

- `startTicker()` 1778：`setInterval(tick,1000)`＋Worker＋`silentEl` の `timeupdate` の三重で `tick()` 1760 を回す。**メインスレッドが重いと遅れる**。
- `tick()` は**どの画面にいても**時刻が来れば `fire(a)` 1772 を呼ぶ。つまり「トップ画面（広告あり）を開いたまま寝た」人にも鳴る。→ トップ画面も事実上「夜通し開かれる画面」になりうる（`standbyHint` 1911 が「この画面を開いたままにしておけば鳴ります」と案内している）。**ここが一番の設計ポイント。**
- iPhone は `startStandby()` 内のタップの中で `unlockAudio()` 1801・`primeForMorning()` 1802 を行い、朝の自動再生の許可を取る。広告処理をこの前に挟んで非同期待ちをしてはいけない（同期 DOM 削除なら可）。
- `syncAudioMode()` 1458 が `navigator.audioSession.type` を切り替え、`lockMode` 時は `silentEl` をループ再生＋`setMediaMeta()` 1498。広告の動画・音声はこれと競合しうる（A3）。
- `render()` 1874 は 60 秒ごと（2893）に `#alarmList` の `innerHTML` を作り直す → **広告枠を `#alarmList` の中に置いてはいけない**。
- `checkUpdate()` 2722 は index.html を fetch して `APP_VERSION` を正規表現で読む（広告とは無関係だが、`doUpdate()` 2744 の `location.replace` 以外に、ページ遷移は起きない作り）。
- Service Worker なし・CSP なし（`<meta http-equiv>` も `_headers` もなし）。→ 広告導入で CSP を壊す心配はないが、逆に CSP で守ることもできていない（後述 6.8）。
- 環境判定：`IS_TEST` 701、`PUBLIC` 704、`IN_APP` 719、`ENV` 722（file/frame/insecure）、`ON_OLD_SITE` 772。

### 3.3 about.html / privacy.html / test/

- about.html：`#scenes`・`#how`・`#features`（261–276）・`#faq`（278–294）・`#biz`（296–325、「🏢 企業・広告のご担当者さま」313–318）・`.final`（327–333）・footer（336–347）・**下部固定の `#stickyCta`（349）**。config.js を読み、匿名統計（hp_view など）を送っている。
- privacy.html：4章の末尾（62行目）に「**現在、本サービスに広告はありません**」、2章（31行目）に「Cookie…広告や他サイトでの追跡には使いません」。→ 広告開始と同時に書き換えが必須。
- `test/`：index/about/privacy/config.js の**完全なコピー**（diff なし）。`/test/` は `IS_TEST` で判定される。noindex はどこにも付いていない（about.html の重複ページが公開されている状態）。
- `robots.txt`・`ads.txt` なし。`sitemap.xml` は `/about`・`/`・`/privacy` の3件。

---

## 4. 収益化の選択肢と優先順位

前提（試算用の仮定。実数は統計シートで置き換えてください）：DAU 500、トップ画面の「起きている間の表示」1日1.5回/人、about.html 100 PV/日、日本のモバイル AdSense ページ RPM ¥100〜¥400。

| 順位 | 手段 | 期待収益（月・仮定ベース） | アラームへのリスク | 手間 | 評価 |
|---|---|---|---|---|---|
| 1 | **応援（投げ銭）リンク**：OFUSE（推し文化と相性◎、ファンレター文化）／Ko-fi／Buy Me a Coffee | ¥0〜5,000（MAU の 0.1〜0.5% × ¥300〜500） | **なし**（静的リンクのみ） | 極小 | すぐやる |
| 2 | **AdSense（about.html と新設コンテンツページのみ）** | ¥300〜1,200 | **なし**（アプリ本体に広告コードを入れない） | 小（審査待ちあり） | すぐやる。審査の土台にもなる |
| 3 | **スポンサー / PR**：①編集画面の「おすすめチャンネル」に「PR」枠（`FEATURED_LOCAL` 1354 / `topHTML()` 1389）、②about.html の `#biz` 経由のタイアップ | 1件 ¥10,000〜100,000（規模と営業次第） | **なし**（自前 HTML、外部スクリプトなし） | 中（営業・媒体資料） | 1件あたりが最も大きい。利用者数が増えたら本命 |
| 4 | **アフィリエイト**：Amazon アソシエイト／楽天アフィリエイト（または「もしもアフィリエイト」で一括）。寝る前セットアップ用品のガイドページ | ¥500〜3,000 | **なし**（静的リンク） | 中（記事作成） | SEO・AdSense 審査にも効く |
| 5 | **アプリ内 AdSense（トップ画面、隔離 iframe 方式）** | ¥2,000〜9,000（750 PV/日 × RPM） | **中**（ガードが前提） | 大（実装・監視） | フェーズ3。ガードと計測が整ってから |
| 6 | 有料機能（広告非表示・複数アラーム音・ローテーション等） | 不明 | 低 | 特大（決済・特商法表記・復元・サーバー検証） | 将来検討のみ |

結論：**「外部スクリプトを入れない収益（1・3・4）＋ about.html だけの AdSense（2）」を先に出し、アプリ内広告（5）は計測とガードが揃ってから、条件付きで追加する。**

補足：YouTube 埋め込みプレーヤー内で流れる YouTube の広告は、本サービスの収益にはなりません（変更不要・変更不可）。

---

## 5. 検討したアプローチ

### 案A：別ページ型（アプリ本体はゼロ広告）
- index.html には第三者スクリプトを一切入れない。アプリ内は静的リンク（応援・おすすめグッズ・PR チャンネル）だけ。
- AdSense は about.html と新設 `goods.html`（寝る前セットアップガイド）のみ。
- 長所：アラームへのリスクが実質ゼロ。実装が小さい。審査も通りやすい（コンテンツページ）。
- 短所：広告収益の上限が about/goods の PV に縛られる（アプリ利用者は about をあまり見ない）。

### 案B：同一文書型（index.html に adsbygoogle.js を直接読み込む）
- トップ画面に手動ユニットを置き、おやすみ・鳴動時は `<ins>` を DOM から削除。
- 長所：実装が素直。ターゲティング精度が最も高い。
- 短所：**一度読み込んだ adsbygoogle.js はページから取り除けない**（タイマー・計測・メモリが夜通し残る）。自動広告の設定を誤ると、アンカー広告（z-index 最大値）や全画面（vignette）広告が `#ring` より上に出うる。広告の動画が音声セッションに干渉する余地が残る。→ **不採用。**

### 案C：隔離 iframe 型（index.html には広告コードを入れず、同一オリジンの `ad-frame.html` を条件付きで差し込む）
- 広告は `ad-frame.html` の中でだけ読み込む。index.html は `<iframe sandbox>` を作る／消すだけ。
- 消す時は `iframe.remove()` → **AdSense の実行環境ごと破棄**され、夜通し何も残らない。
- `sandbox` に `allow-top-navigation` を付けない → 広告が親ページ（アラーム）を勝手に遷移させることを構造的に防ぐ（悪質広告の自動リダイレクト対策）。
- 短所：iframe 内の広告は文脈ターゲティングが弱く単価が下がる可能性。**AdSense の iframe 内掲載の可否は、申請時点のポリシーで要確認**（同一ドメインの iframe は許容とされてきたが、オーナーが AdSense ヘルプで最新を確認すること）。不可なら案Cの代わりに「案B＋厳格ガード」は採らず、アプリ内広告は見送る。

### 推奨
**フェーズ1〜2は案A、フェーズ3で案Cを追加。案Bは採らない。**

---

## 6. 推奨設計（詳細）

### 6.1 config.js に追加するキー（すべて空＝OFF）

```js
window.LIVE_ALARM_CONFIG = {
  // …既存のキー（backendUrl, testBackendUrl, operator, contact）はそのまま…

  /* ---- 収益化（空のままなら何も表示しない・何も読み込まない） ---- */
  ads: {
    // AdSense のサイト運営者 ID。例 'ca-pub-1234567890123456'（/^ca-pub-\d{16}$/ に一致しない時は OFF）
    adsenseClient: '',
    // 広告ユニットの「data-ad-slot」番号（AdSense 管理画面で手動ユニットを作って入力）
    slots: { about1: '', about2: '', goods1: '', app1: '' },
    // アプリ画面（トップ）の広告。フェーズ3まで false のまま
    appEnabled: false,
    // 次のアラームまでこの分数を切ったら、アプリ内の広告を出さない／消す
    quietBeforeAlarmMin: 120,
    // 操作がないまま、この秒数たったらアプリ内の広告を消す（開きっぱなし対策）
    idleRemoveSec: 90,
    // 夜間（この時刻の範囲）はアプリ内の広告を出さない。[開始時, 終了時]
    quietHours: [20, 9],
  },
  affiliate: {
    amazonTag: '',      // Amazon アソシエイトのトラッキングID 例 'xxxx-22'
    rakutenId: '',      // 楽天アフィリエイトID
    moshimoAId: '',     // もしもアフィリエイトを使う場合
  },
  tip: {
    url: '',            // OFUSE / Ko-fi / Buy Me a Coffee のページ URL（https のみ）
    label: '開発を応援する',
  },
};
```

- 判定はすべて「値が正しい形式の時だけ ON」。`IS_TEST`・`ON_OLD_SITE`・`ENV`（file/frame/insecure）・`IN_APP`・`#block` 表示時は**常に OFF**（テスト環境ではレイアウト確認用の灰色の「広告枠（テスト）」だけ表示）。
- **注意：** index.html は `config.js?v=1.9.6`（677行目）で読み込んでいる。config.js を変えた時は、この `?v=` も上げる（キャッシュ対策）。about.html/privacy.html は `config.js`（クエリなし）なので同様に `?v=` を付けるのが望ましい。
- `test/config.js` は別ファイル。test 側に本番 ID をコピーしても、コード側の `IS_TEST` 判定で出ない作りにする（二重の安全）。

### 6.2 ads.txt（新規ファイル、サイトのルート）

```
google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
```

- `nagara-alarm.pages.dev/ads.txt` で text/plain として返ること（Cloudflare Pages の静的配信でそのまま可）。`test/` には置かない。
- pages.dev のサブドメインで AdSense サイト追加ができるかは**オーナーが申請時に確認**（サブドメインのみのサイトは、ルートドメイン単位でしか ads.txt を見ない仕様の場合がある）。不可の場合は独自ドメイン取得（年1,500円前後）をフェーズ0に入れる。
- あわせて `robots.txt`（`Sitemap:` 行と `Disallow: /test/`）を推奨。test/ の各 HTML には `<meta name="robots" content="noindex">` を付ける（重複コンテンツは審査にも不利）。※ test/ は既存ファイルのため、実装時にオーナー了承のうえで。

### 6.3 about.html の変更

1. **広告枠（手動ユニットのみ・2枠まで）**
   - 枠1：`#features`（261–276）と `#faq`（278）の間。
   - 枠2：`#faq` の後（294）と `#biz`（296）の間。
   - ヒーロー（201–218）・CTA ボタンの近く・`.final`（327–333）には置かない（誤タップ誘発＝AdSense ポリシー違反、かつアプリへの導線を邪魔する）。
   - 各枠の上に小さく「広告」ラベル（AdSense 許可表記。ステマ規制にも合う）。
   - スクリプトは `ads.adsenseClient` が正しい時だけ、ページ下部の既存スクリプト（351–434）の後で動的に `pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=...` を挿入し、各 `<ins class="adsbygoogle" data-ad-client data-ad-slot data-ad-format="auto" data-full-width-responsive="true">` を作る。
2. **自動広告（Auto ads）は使わない。** 特に「アンカー広告」は既存の下部固定 `#stickyCta`（349）と重なり、「全画面（vignette）広告」は「さっそく使ってみる」→ アプリへの遷移時に全画面広告を挟むため。オーナーは AdSense 管理画面でサイトの自動広告を OFF、念のため「ページの除外」に `/`・`/index.html`・`/test/*` を登録。
3. **アプリへ戻る案内**：about.html は index.html の `.foot`（406行）から同じタブで開かれる。about を読んでいる間はアラームが鳴らない（アプリ画面を開いていないため）。localStorage `liveAlarm.v1` に有効なアラームがある時だけ、上部に「⏰ アラームはアプリの画面を開いている時だけ鳴ります → アプリに戻る」の帯を出す（既存の引っ越し帯 416–424 と同じ作り方）。
4. **`#biz` の強化**（313–318）：
   - 「🏢 企業・広告のご担当者さま」に、提供できる枠を明記：「アプリ内おすすめチャンネル欄の PR 枠」「HP 内の掲載」「朝配信企画のタイアップ」。
   - 「媒体資料（推定端末数・起床時刻の分布・人気チャンネル傾向）をお送りします」と記載（集計データの第三者提示は privacy.html 3章で既に告知済み）。
   - 「起床時の再生画面・おやすみ画面には広告を表示しません」と明記（広告主にも利用者にも安心材料）。
5. **応援リンク**：footer（338–342）に `tip.url` があれば「☕ 開発を応援する」。
6. **FAQ に1問追加**：「広告はありますか？」→「紹介ページと一部の画面にだけ表示します。アラームが鳴る画面・おやすみモードには表示しません。」
7. 統計：既存の `send()`（389）で `hp_ad_slot`（表示）・`hp_tip`・`hp_aff`（クリック）を送る（広告そのもののクリックは iframe 内なので取れない／取らない）。

### 6.4 新規ページ goods.html（寝る前セットアップガイド＋アフィリエイト）

- 内容（実用記事として成立させる）：
  1. 開いたまま充電するための**ベッドサイドのスマホスタンド**（縦置き・角度調整）
  2. **長めの充電ケーブル（2m/3m）**・MagSafe スタンド
  3. 本体スピーカーで物足りない人向けの **Bluetooth スピーカー**（※ iPhone の音声出力先が変わる点の注意書き）
  4. **併用推奨の普通の目覚まし時計**（privacy.html 5章「寝坊が許されない予定には端末標準の目覚まし等を併用」と一貫）
  5. 設定のコツ（自動ロック「なし」、低電力モードの注意、画面の明るさ）
- 各商品リンクは `affiliate.*` があればタグ付き URL、なければ**タグなしの通常リンク**（ページとして常に成立）。
- 冒頭に「**本ページはプロモーション（広告）を含みます**」（景品表示法・ステマ規制）。
- 末尾に Amazon 必須文言：「Amazonのアソシエイトとして、（運営者名）は適格販売により収入を得ています。」
- AdSense 枠は記事の途中に1つ（`slots.goods1`）。
- `sitemap.xml` に追加。about.html の FAQ「画面をロックしても鳴りますか？」（287）と `#how` STEP3（253）から内部リンク。
- アプリからは静的リンクのみ（下記 6.5）。

### 6.5 index.html の変更（フェーズ1〜2：外部スクリプトなし）

| 内容 | 場所 | 条件 |
|---|---|---|
| 応援リンク「☕ 開発を応援する」 | `#mSettings` のバージョン欄（537–543）の直前に `<div class="field" id="boxTip">` | `tip.url` が https の時だけ表示。`openSettings()` 2403 内で表示切替 |
| 「寝る前のおすすめグッズ」リンク | `.foot`（405–406）のリンク列に追加 | 常時可（静的リンク）。`target="_blank"` にしない（standalone では Safari に飛び、戻ってこないリスク）。goods.html 側に「アプリに戻る」帯を出す（6.3-3 と同じ） |
| PR（スポンサー）チャンネル枠 | `topHTML()` 1389 で `c.source === 'sponsor'` の時、`<span class="pk">おすすめ</span>` の代わりに `<span class="pk pr">PR</span>`。データはサーバー（Apps Script の `a=top` 応答、1379–1382）から `source:'sponsor'` で返す。`FEATURED_LOCAL` 1354 には入れない（期限管理をサーバー側に寄せる） | ランキング（`source` なし）の順位を金銭で動かさない。PR は最大1件・最後尾 or 先頭固定を契約で決める。`top_shown`（1406/1412）・`top_pick`（2232）にすでに `src` が入っているので、`'s'` を足せば**スポンサー向けの表示数・選択数レポートがそのまま作れる** |

- いずれも DOM に静的に置くだけ。`#standby`・`#ring` には一切リンクを置かない。

### 6.6 index.html の変更（フェーズ3：アプリ内広告＝案C）

#### 置く場所
- **1枠だけ**：トップ画面の `#alarmList`（403）の**後**、`.foot`（405）の**前**に `<div id="adSlotApp" class="adslot" hidden></div>` を静的に置く（`render()` が作り直すのは `#alarmList` の中だけなので消されない）。
- ヒーロー（`#btnStandby` 395 の周辺）には置かない（寝る直前に押すボタンの近くで誤タップ → 離脱 → 鳴らない、A5）。
- 枠の高さはあらかじめ確保（例 `min-height:100px`）し、広告の読み込みでボタン位置がずれないようにする（CLS・誤タップ防止）。

#### 新規 ad-frame.html（同一オリジン）
- 中身は「広告」ラベル＋`<ins class="adsbygoogle">`＋adsbygoogle.js のみ。client/slot はクエリで受け取り、`/^ca-pub-\d{16}$/`・`/^\d+$/` で検証。
- 親からは `<iframe src="ad-frame.html?c=...&s=..." sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="">` で読み込む。`allow-top-navigation` は**付けない**。`allow=""` で autoplay・camera 等の権限を委譲しない。
  - 注：同一オリジン＋`allow-scripts allow-same-origin` の組み合わせでは iframe 内のスクリプトが sandbox を外せる。ここで守りたいのは「AdSense 由来の広告クリエイティブ（さらに内側の別オリジン iframe）」なので許容。ad-frame.html 自体には自前コード以外を書かない。

#### index.html 側の広告マネージャー（新規 `<script>`、`'use strict'` の本体スクリプトの末尾近く、`boot()` 2837 の前）
```js
const Ads = (() => {
  const A = CFG.ads || {};
  const ON = A.appEnabled === true && /^ca-pub-\d{16}$/.test(A.adsenseClient || '') && /^\d+$/.test((A.slots || {}).app1 || '')
          && !IS_TEST && !ENV && !IN_APP && !ON_OLD_SITE;
  let frame = null, lastInput = Date.now(), why = '';
  const blocked = () => {
    if (standbyOn || priming) return 'standby';
    if ($('#ring').classList.contains('open') || $('#standby').classList.contains('open')) return 'ring';
    if (document.visibilityState !== 'visible') return 'hidden';
    if ($$('.modal.open').length) return 'modal';
    const nx = nextOverall(); if (nx && nx.at - Date.now() < (A.quietBeforeAlarmMin ?? 120) * 60000) return 'soon';
    const h = new Date().getHours(), [qs, qe] = A.quietHours || [20, 9]; if (qs > qe ? (h >= qs || h < qe) : (h >= qs && h < qe)) return 'night';
    if (Date.now() - lastInput > (A.idleRemoveSec ?? 90) * 1000) return 'idle';
    return '';
  };
  function kill(reason) { if (frame) { frame.remove(); frame = null; track('ad_off', { why: reason }); } $('#adSlotApp').hidden = true; }
  function update() {
    if (!ON) return;
    why = blocked();
    if (why) { kill(why); return; }
    if (!frame) { /* iframe を作って #adSlotApp に入れ、hidden を外す */ track('ad_on', {}); }
  }
  return { ON, kill, update, touch() { lastInput = Date.now(); } };
})();
```
（擬似コード。`$`・`$$`・`nextOverall`・`standbyOn`・`priming`・`track` は既存。）

#### フックする箇所（**明示呼び出し＋監視の二重化**）

| # | 場所（行） | 追加する処理 | 理由 |
|---|---|---|---|
| H1 | `startStandby()` 1799：`primeForMorning()` 1802 の**直後**（`standbyOn = true` 1803 の前後どちらでも可） | `Ads.kill('standby')`（同期） | タップ中の音声許可処理（1801–1802）を先に済ませ、同期 DOM 削除だけ行う。`await` は入れない |
| H2 | `primeForMorning()` 1592：`$('#ring').classList.add('open','prime')` 1598 の直前 | `Ads.kill('prime')` | prime は `showRing()` を通らない |
| H3 | `fire()` 1643 の先頭（`endPrime` 1644 の直後） | `Ads.kill('fire')` | 本番・テスト再生の両方の入口 |
| H4 | `showRing()` 1733 の先頭 | `Ads.kill('ring')` | `startVideo()` 1671・`primePlayer()` 1849 など全経路の共通の関所 |
| H5 | `stopStandby()` 1816 の末尾 | `setTimeout(Ads.update, 1500)` | おやすみ終了後、条件を満たす時だけ再表示 |
| H6 | `closeRing()` 1743 | **何もしない**（`#rClose` 2529 がそのまま `startStandby()` へ行くため。テスト再生後 2528 は `stopStandby()` 経由で H5 が動く） | 起床直後に広告を出さない |
| H7 | `render()` 1874 の末尾（1918 の後） | `Ads.update()` | 60秒ごと（2893）に「アラーム前の静音時間・夜間・放置」を再判定。トップ画面を開いたまま寝た人の広告もここで消える |
| H8 | 既存のタップ監視 2499（`pointerdown`/`touchend`/`keydown`, capture） | `Ads.touch()` を追加 | 放置判定用（`unlockAudio()` などの既存処理は変えない） |
| H9 | `openModal()` 1923 / `closeModal()` 1924 | `Ads.update()` | モーダル表示中は消す（モーダルの下で広告が動き続けない） |
| H10 | `document` の `visibilitychange`（1726 と同じ所に追加） | hidden→`Ads.kill('hidden')`、visible→`Ads.update()` | 背景では読み込ませない |
| H11 | `boot()` 2837：`render()` 2868 の後 | `setTimeout(Ads.update, 5000)` ＋ 下の監視を開始 | 起動直後の YouTube プレーヤー準備（2872–2873）を優先 |
| H12 | **監視（バックストップ）**：`new MutationObserver(...)` で `#ring` と `#standby` の `class` 属性を監視 | どちらかに `open` が付いたら即 `Ads.kill('observer')`。さらに `#ring.open`/`#standby.open` の時に `iframe[src*="ad-frame"]`・`ins.adsbygoogle`・`script[src*="googlesyndication"]` が文書内に1つでもあれば削除して `track('ad_guard_violation', {...})` | 将来どこかに新しい「鳴動の入口」が増えても守れる |

- **exitの順序**：H1〜H4・H12 はすべて同期の DOM 操作のみ（`iframe.remove()`）。ネットワーク待ちや `await` を入れない。
- 「次のアラームまで120分以内は出さない」「20時〜9時は出さない」「90秒操作がなければ消す」の3条件で、**夜にトップ画面を開いたまま寝た人の画面に広告が残らない**（A4・A5）。朝の起床直後（9時前）も出ない。
- `Ads.ON` が false（初期状態）なら、上記のフックはすべて何もしない（`frame` が常に null）。

#### 自動広告・広告フォーマット（オーナーの管理画面作業）
- 自動広告 OFF（アンカー・全画面・サイドレール等は z-index が非常に高く `#ring`（60）より上に出る）。
- 「広告の許可とブロック」でセンシティブなカテゴリ（ギャンブル・出会い等）をブロック。動画・音声付きの広告フォーマットが選べる場合はオフ（A3 対策。いずれにせよ iframe を消すので夜には残らない）。

### 6.7 privacy.html の変更（広告開始と同時に公開）

1. 最終更新日（21行目）を更新。
2. 2章「端末に保存する情報」の Cookie の行（31）：「（本サービスが保存する Cookie は）広告や他サイトでの追跡には使いません」と主語を明確化し、新設の「広告について」章を参照させる。
3. 4章の表（55–61）に行を追加：

| 送信先 | 内容・目的 |
|---|---|
| Google（Google AdSense） | 紹介ページ・おすすめグッズのページ（およびアプリのトップ画面の一部）で広告を表示するため、Cookie 等を使って閲覧情報が Google に送信されます |
| Amazon・楽天（アフィリエイト） | 紹介リンクから商品ページを開いた時、成果の計測のため各社の Cookie が使われます（各社のサイト上での送信） |
| OFUSE 等（応援） | リンク先のサービスでのみ情報を扱います |

4. 62行目の「現在、本サービスに広告はありません。」を削除し、**新章「広告について」**を追加（文案）：

> **広告について**
> 本サービスでは、第三者配信の広告サービス「Google AdSense」を利用しています。Google などの第三者配信事業者は Cookie を使用して、利用者がこのサイトや他のサイトに過去にアクセスした際の情報に基づいて広告を配信します。Google が広告 Cookie を使用することにより、利用者がこのサイトや他のサイトにアクセスした際の情報に基づいて、Google やそのパートナーが適切な広告を表示できます。
> 利用者は、[広告設定](https://adssettings.google.com/)でパーソナライズ広告を無効にできます。また、[www.aboutads.info](https://www.aboutads.info/) にアクセスすれば、パーソナライズ広告に使われる第三者配信事業者の Cookie を無効にできます。Google による情報の取扱いは「[Google のサービスを使用するサイトやアプリから収集した情報の Google による使用](https://policies.google.com/technologies/partner-sites)」をご覧ください。
> **アラームが鳴る画面（再生画面）・おやすみモードの画面には、広告を表示しません。**
> 本サービスは Amazon.co.jp を宣伝しリンクすることによってサイトが紹介料を獲得できる手段を提供することを目的に設定されたアフィリエイトプログラムである、Amazon アソシエイト・プログラムの参加者です。また、楽天アフィリエイト等のプログラムに参加しています。広告・紹介リンクを含むページには「広告」「PR」等と表示します。

5. 「外部送信について」（電気通信事業法の外部送信規律）として、4章の表を「送信先・送信される情報・利用目的」の3列にそろえ、オプトアウト方法を併記（上記の広告設定リンク、⚙設定の統計オフ）。
6. 3章の統計と広告は**別物**である旨を明記（運営者の統計は広告に使わない・広告事業者に渡さない）。
7. 応援（投げ銭）については「任意。応援しても機能は変わりません」と5章（利用規約）に1行。
8. test/privacy.html は本番と同じ文面に揃える（test でも文面確認できるように）。

### 6.8 CSP・Service Worker

- 現状どちらもなし。広告導入に CSP は必須ではない。導入する場合は AdSense の要求ドメインが多く変わりやすいため、**about.html/goods.html/ad-frame.html には CSP を付けない**、index.html には将来 `frame-src` を `'self' https://www.youtube.com https://www.youtube-nocookie.com` に絞る CSP を付けられる（案C なら index.html 自体は AdSense ドメインを必要としないのが利点）。
- Service Worker は導入しない（`checkUpdate()` 2722 の更新方式と衝突させないため）。導入する場合は ad-frame.html と広告ドメインを**キャッシュ対象外**にする。

### 6.9 ポリシー面の注意（要確認事項）

- **YouTube API サービス デベロッパー ポリシー**：YouTube プレーヤー内・プレーヤー上への広告や、YouTube のコンテンツが主体の画面での広告販売には制限がある。→ `#ring`（プレーヤー画面）には広告を置かない設計で回避。トップ画面の広告がこれに抵触しないかは、フェーズ3の前にオーナーが最新ポリシー（収益化の項）を確認。
- **AdSense**：誤クリックを誘う配置の禁止（ボタン近く・固定バー近くは不可）、コンテンツの少ない画面への掲載の制限（トップ画面が「コンテンツのない画面」と判断される可能性 → フェーズ3は審査通過後に1枠から）、iframe 内掲載の可否（6.6）。
- **景品表示法（ステマ規制、2023年10月〜）**：広告・PR・アフィリエイトには「広告」「PR」「プロモーションを含みます」を明示。PR チャンネル枠も同様。
- **Amazon アソシエイト**：所定の文言の表示が必須。登録後180日以内に3件の売上が必要（未達だと再申請）。小規模サイトは「もしもアフィリエイト」経由の方が始めやすい。
- 有料機能を始める場合のみ「特定商取引法に基づく表記」が必要（投げ銭サービスの利用だけなら、各サービス側の規約に従う）。

---

## 7. 監視

### 7.1 自動ガードチェック（Playwright）— 新規 `tools/ad-guard/`（例）

ローカルで `python3 -m http.server 8000` を立て、`http://localhost:8000/?adguard=1` を開いて実行。localhost は `IS_TEST` なので本番広告は出ない。チェック用に **`?adguard=1` の時だけ**（かつ `IS_TEST` の時だけ）、`Ads` が本番と同じ判定で「ダミー広告 iframe（`ad-frame.html?dummy=1`、外部通信なし）」を差し込むモードを用意する。外部の広告ドメインは `page.route('**/*googlesyndication*', …)` で遮断し、もし要求が出たらテスト失敗にする。

| # | シナリオ | 合格条件 |
|---|---|---|
| G1 | config の ads 系がすべて空（初期状態）でトップ→編集→設定→おやすみ→テスト再生 | `googlesyndication.com`・`doubleclick.net`・`adservice.google.*`・`ad-frame.html` への**リクエストが0件**。`#adSlotApp` は hidden |
| G2 | ダミー広告 ON・トップ表示（日中・次のアラームまで3時間以上に `page.clock` を設定） | `iframe[src*="ad-frame"]` が1つ、`#adSlotApp` 内に限定、`sandbox` に `allow-top-navigation` が無い |
| G3 | G2 から「画面を暗くする」（`#btnStandby`） | 同じタスク内で `iframe[src*="ad-frame"]`・`ins.adsbygoogle`・`script[src*="googlesyndication"]` が**0件**。`#standby.open` |
| G4 | おやすみ中に `page.clock.runFor('8:00:00')` 相当（アラーム時刻まで進める） | 期間中、広告関連リクエスト0件・広告要素0件。`fire` 後 `#ring.open` |
| G5 | 鳴動中：画面の格子点（例 5×9 点）で `document.elementFromPoint()` | すべて `#ring` の子孫（または `#toast`）。z-index で上に来る要素がない |
| G6 | トップ画面を開いたまま（おやすみを押さずに）時刻を進める | 90秒無操作で広告 iframe が消える／アラーム120分前に消える／20時以降は出ない。`fire` 時に広告0件 |
| G7 | 一覧の「▶ テスト再生」（`data-play`）、`primePlayer`、`#sbPrime`（朝の準備） | いずれも `#ring.open` の間は広告0件 |
| G8 | モーダル（`#mEdit`・`#mSettings`・`#mIntro`）を開く | 開いている間は広告0件 |
| G9 | `/test/`・`?env=test`・`?oldsite=1`・iPhone の LINE UA（`IN_APP`） | 本番 ID を入れても広告は出ない |
| G10 | about.html：ID 未設定 | 広告リクエスト0件・枠は非表示。ID 設定（ダミー）時は「広告」ラベル付きの枠が2つだけ、`#stickyCta` と重ならない |
| G11 | 回帰：既存のアラーム動作 | `fire()` から `#ring.open` までの時間、`tick()` の間隔（1秒±0.3秒）が広告 ON/OFF で変わらない |

- 端末：`devices['iPhone 15']`（WebKit）と Desktop Chrome の2つで回す。
- 実行タイミング：index.html・about.html・config.js・ad-frame.html を変更してデプロイする前に毎回（手動コマンド1つ）。リポジトリに CI がないため、まずはローカル実行を手順書に書く。将来 GitHub Actions に載せる場合は、Cloudflare Pages のプレビュー URL に対して実行。

### 7.2 本番の自己監視（既存の匿名統計を利用）

- `Ads` の H12（MutationObserver）が違反を検知したら `track('ad_guard_violation', { where, n })`。**1件でも出たら即 `ads.appEnabled=false` に戻す**運用ルール。
- `ad_on` / `ad_off(why)` を記録し、「広告が出ている時間帯」「消えた理由（standby/soon/night/idle）」を確認。
- 回帰 KPI（広告導入前の2週間と比較）：
  - `alarm_fire` に対する `play_start` の比率、`play_blocked` の比率（iPhone の自動再生が悪化していないか）
  - `prime` の `ok` 率
  - `standby_start` 率、`ring_close` の `played` 率
  - 悪化が統計的に明らかなら（例：`play_blocked` が +3pt 以上）フェーズ3を即停止。
- 統計の送信内容が増えるため、privacy.html 3章の表に「広告枠の表示・非表示の記録（広告の中身やクリックは記録しません）」を1行追加。

### 7.3 緊急停止

- config.js の `ads.appEnabled=false`（または `adsenseClient=''`）にしてデプロイ → 次回読み込みから即 OFF（Cloudflare Pages の既定キャッシュは再検証ありのため反映が早い。`?v=` も上げる）。
- 将来オプション：Apps Script の応答に `adsOff:true` を含め、`loadTop()` 1373 と同じ要領でリモート停止できるようにする（任意）。

---

## 8. オーナーにしかできないこと

1. **AdSense アカウントの申請・サイト追加・審査対応**（about.html と goods.html が審査対象のコンテンツになる）。pages.dev のサブドメインで登録できるか確認。できなければ独自ドメインの取得と Cloudflare Pages への設定。
2. 審査通過後、**サイト運営者 ID（ca-pub-…）と手動ユニットの slot 番号**を config.js に入力。**自動広告は OFF**、ページ除外に `/`・`/test/*`。センシティブカテゴリのブロック設定。
3. AdSense の支払い情報・税務情報（日本居住者の情報、マイナンバーは不要だが住所の PIN 確認あり）。
4. Amazon アソシエイト／楽天アフィリエイト（またはもしもアフィリエイト）の登録とトラッキング ID の入力。goods.html に載せる商品の最終選定（実際に使える物か）。
5. OFUSE 等のクリエイターページ作成と URL の入力。
6. スポンサー：料金表・契約条件（期間、PR 枠の位置、表示回数レポート）の決定と営業。PR 枠のデータを Apps Script 側で返す設定。
7. privacy.html の文面の最終確認（運営者名・問い合わせ先は既存の config.js の `operator`/`contact`）。
8. YouTube API ポリシーと AdSense の iframe 掲載可否の最新確認（フェーズ3の前）。

---

## 9. 段階的な導入

| フェーズ | 内容 | アラームへのリスク | 完了条件 |
|---|---|---|---|
| **0：準備** | config.js にキー追加（すべて空）。ads.txt の雛形（ID 入力後に公開）。robots.txt、test/ の noindex。G1・G9・G11 の Playwright チェックを作成し、**現状で合格**することを確認（基準線） | なし | G1 合格（広告関連リクエスト0件） |
| **1：外部スクリプトなしの収益** | 応援リンク（設定画面・about footer）。goods.html（アフィリエイト＋ステマ表記＋Amazon 文言）。about.html の `#biz` 強化・FAQ 追加・「アプリに戻る」帯。PR チャンネル枠（`topHTML()` の `source:'sponsor'`） | なし | 表示確認、`top_shown` に `s` が記録される |
| **2：about.html / goods.html の AdSense** | AdSense 審査申請 → 通過後に ID を入力。手動ユニット2〜3枠。privacy.html 改定を**同時に**公開 | なし（アプリ本体はゼロ広告） | G10 合格、審査通過、privacy 反映 |
| **3：アプリ内広告（案C）** | ad-frame.html、`Ads` マネージャー、H1〜H12 のフック、ダミー広告モード。まず `appEnabled` を test 環境のダミーで G2〜G8 合格 → 本番は1枠のみ | 中（ガードで低減） | G1〜G11 全合格、本番2週間で `ad_guard_violation` 0件、回帰 KPI 悪化なし |
| **4：見直し** | 収益と KPI を見て、継続／枠の追加なし／停止を判断。スポンサーが取れればアプリ内 AdSense をやめる選択肢も。有料機能（広告非表示など）の検討 | — | — |

**どのフェーズでも、`#standby`・`#ring`（prime・テスト再生を含む）には広告・外部リンク・外部スクリプトを置かない。** これを破る変更は、このドキュメントの改定（オーナー承認）なしには行わない。
