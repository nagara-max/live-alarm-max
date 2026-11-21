#!/usr/bin/env bash
# 収益化フェーズ1の監視ガード
#   使い方: bash tools/guard/check.sh   （全部通れば OK を出して exit 0）
#   (1) アプリ本体に広告スクリプトの文字列がない
#   (2) 鳴動画面（#ring）・おやすみ画面（#standby）の中に応援・グッズのリンクがない
#   (3) test/ のファイルがルートと同じ
#   (4) Playwright のチェック（tools/guard/phase1.spec.js）
set -u
cd "$(dirname "$0")/../.."
fail=0
ng() { echo "NG: $*"; fail=1; }

echo "[1] 広告スクリプトの文字列"
if grep -nE 'googlesyndication|doubleclick|adsbygoogle|amazon-adsystem' index.html test/index.html; then
  ng "index.html に広告スクリプトの文字列があります"
else
  echo "  ok"
fi

echo "[2] #ring・#standby の中身"
if python3 - index.html test/index.html <<'PY'
import sys
from html.parser import HTMLParser
VOID = {'area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr'}
BAD = ('lnkTip', 'lnkGoods', 'boxSupport', 'goods.html', 'tipUrl')
class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []      # 開いている要素
        self.inside = {}     # id -> 開始時のスタックの深さ
        self.found = {}      # id -> 中身の文字列
        self.hits = []
    def _feed_inside(self, text):
        for k in self.inside: self.found[k] = self.found.get(k, '') + text
    def handle_starttag(self, tag, attrs):
        raw = self.get_starttag_text() or ''
        self._feed_inside(raw)
        a = dict(attrs)
        if tag in VOID: return
        self.stack.append(tag)
        if a.get('id') in ('ring', 'standby'):
            self.inside[a['id']] = len(self.stack)
            self.found.setdefault(a['id'], '')
    def handle_endtag(self, tag):
        if tag in VOID: return
        while self.stack:
            t = self.stack.pop()
            for k, d in list(self.inside.items()):
                if len(self.stack) < d: del self.inside[k]
            if t == tag: break
        self._feed_inside('</%s>' % tag)
    def handle_data(self, d): self._feed_inside(d)
ok = True
for f in sys.argv[1:]:
    p = P(); p.feed(open(f, encoding='utf-8').read())
    for k in ('ring', 'standby'):
        if k not in p.found:
            print('  NG: %s に #%s が見つかりません' % (f, k)); ok = False; continue
        body = p.found[k]
        if len(body) < 50:
            print('  NG: %s の #%s の中身が取れません' % (f, k)); ok = False; continue
        for b in BAD:
            if b in body:
                print('  NG: %s の #%s の中に %s があります' % (f, k, b)); ok = False
sys.exit(0 if ok else 1)
PY
then echo "  ok"; else ng "#ring・#standby の中に応援・グッズのリンクがあります"; fi

echo "[3] test/ とルートの同一性"
for f in index.html about.html privacy.html config.js goods.html hp-stats.js; do
  if ! diff -q "$f" "test/$f" >/dev/null 2>&1; then ng "test/$f がルートの $f と違います（またはありません）"; fi
done
[ $fail -eq 0 ] && echo "  ok"

echo "[4] Playwright のチェック"
if node tools/guard/phase1.spec.js; then echo "  ok"; else ng "phase1.spec.js が失敗しました"; fi

if [ $fail -eq 0 ]; then echo "OK"; exit 0; else echo "FAILED"; exit 1; fi
