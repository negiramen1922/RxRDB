# RxRDB（バベル Tier表メーカー 公開サイト）

リバースブルー×リバースエンドのバベル階層別Tier表サイト。GitHub Pages（main ブランチ / ルート）で公開。ビルド不要の静的サイト。

## 構成
- `index.html` … 公開サイト本体（HTML/CSS/JS 1ファイル）。`window.SITE` に GA4 の ID と Firebase（apiKey / projectId）を設定する。一般の閲覧では Firebase SDK は読み込まず、Firestore REST で `public/*` を読むだけ（失敗時は data/*.json）。
- `js/admin.js` … 管理画面（`#admin` / フッターの「管理者ログイン」で読み込む ES module）。Google ログイン、データ編集、読み込み・書き出し、画像、変更履歴、ご意見、アクセス、メンバー。
- `js/fb.js` … Firebase 初期化（gstatic 10.12.2）とオーナーのメールアドレス。
- `firestore.rules` … Firestore のセキュリティルール。変えたら Firebase コンソールのルールにも貼る。
- `data/chars.json` / `data/scripts.json` / `data/babel.json` … `{headers:[...], rows:[[...]]}` 形式の表データ。列名で参照しているので列の追加・並べ替えは自由。
  - chars: `ID`（例 `カノン_DEFAULT`）がキャラの識別子。Tier配置もこのIDで保存される。
  - scripts: `名前` が識別子。条件2・条件3 は属性/騎士団/階級/スタイル/キャラ名/女性・男性。
  - babel: `バベル種類` + `階層` が識別子。`解析データ` は1行1効果、`【味方】`などの見出し行で区切る。`おすすめキャラID` はカンマ区切りのキャラID。
- `data/images.json` … 画像の対応表。`thumbs`/`banners`（キャラID→パス）、`sthumbs`/`sfull`（スクリプト名→パス）、`icons`（属性・ロール・階級・騎士団名→パス）、`hero`。
- `images/` … Web用に縮小した画像（元画像は RxRDBbot/images）。サムネイルは 176px 正方形 webp。

## Firebase（プロジェクト my-log-vh3o3b / 表示名 RxRbabelDB、Spark プラン）
- データの正本は Firestore。`tables/{chars|scripts|babel}`（headers）＋ `tables/{k}/rows/{id}`（`c`=列名→値, `o`=並び順, `t`, `by`, `rev`）。
- 保存すると管理画面が自動で `public/{k}`（`json`=`{headers,rows}` の文字列, `sig`）を作り直し、公開サイトはそれを読む。サムネイル位置は `public/crops`。
- 同時編集: 行ごとに `rev` を比べて衝突を検出（トランザクション）。`editing/{uid}` で「編集中」を表示。`log` に変更履歴（元に戻せる）。
- `feedback`（誰でも作成のみ）、`stats/{YYYY-MM-DD}`（pv/uv を +1 だけ）、`roles/{email}`（編集者。追加・削除はオーナーのみ）。
- 無料枠: 読み取り 5万/日、書き込み 2万/日。画像は Firebase に置かない（Storage は有料プラン）。
- ローカル確認では Firebase に届かないので、テストは gstatic と firestore.googleapis.com をモックして行う。

## 更新の流れ
- データ入力は公開サイトの管理画面（`/#admin`）で行う。即時に公開サイトへ反映される。
- `data/*.json` は予備（Firestore が読めないときのフォールバック）。管理画面「読み込み・書き出し」→「data/*.json を書き出す」で出して、ときどき上書き push する。
- 画像を足すときは images/ に webp で置き、data/images.json にキーとパスを追記する（管理画面「画像」で画像を入れると、変換済みの images/ と新しい data/images.json を ZIP で出せる）。スクリプト名とファイル名の表記ゆれに注意（IMAGE_REPORT.md 参照）。
- ローカル確認: `python3 -m http.server` で開く（file:// では data/*.json を読めない）。
