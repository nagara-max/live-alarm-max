/* =========================================================
 * Live目覚まし 公開設定（このファイルだけ書き換えればOK）
 * ========================================================= */
window.LIVE_ALARM_CONFIG = {
  // Apps Script を「ウェブアプリ」としてデプロイした時に表示される URL
  //   例: 'https://script.google.com/macros/s/XXXXXXXX/exec'
  // ・入力すると「公開モード」：利用者は APIキー不要。匿名の利用統計を送信
  // ・空のままだと「個人モード」：各自の APIキーを使う。統計は送信しない
  backendUrl: 'https://script.google.com/macros/s/AKfycbzVQuiO5JhA2i9XskNQT9rngodI5AC_uaKvn6RwDXLRraDtO58WQzCnJnyqxUl7FUUw/exec',

  // テスト環境で使うサーバーの URL（Apps Script の「テスト用」デプロイ）。空なら本番と同じサーバーを使う
  //  テスト環境になるのは：PC の手元で開いた時（Macで起動）／公開サイトの test フォルダ／URL に ?env=test を付けた時
  testBackendUrl: 'https://script.google.com/macros/s/AKfycbxt33piZ0dNVfuspqFX7M1IajVD5QC9q4ce8O6YmRqhb1xBkLPgrXlpg9apcGplnaHc/exec',

  // プライバシーポリシーに表示する運営者名・問い合わせ先（公開する場合は必ず入力）
  operator: 'Live目覚まし運営',
  contact: 'https://forms.gle/mi1T9Pcsp4tonDyY9',
};
