#!/bin/bash
# Live目覚まし を PC（Mac）で使うための起動スクリプト
# このフォルダを http://localhost:8000 で公開し、ブラウザで開きます。
# このウィンドウを閉じるとアプリも止まります（使う間は開いたままに）。
cd "$(dirname "$0")"
PORT=8000
URL="http://localhost:$PORT/"
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 が見つかりません。表示された案内に従って「コマンドライン・デベロッパ・ツール」をインストールしてから、もう一度ダブルクリックしてください。"
  xcode-select --install 2>/dev/null
  read -p "Enterキーで閉じます"; exit 1
fi
if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "すでに起動しています。ブラウザで開きます: $URL"; open "$URL"; exit 0
fi
echo "Live目覚まし を起動しました: $URL"
echo "※ このウィンドウは閉じずに最小化しておいてください。"
( sleep 1; open "$URL" ) &
exec python3 -m http.server $PORT --bind 127.0.0.1
