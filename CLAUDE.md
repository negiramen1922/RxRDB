# RxRwiki（リポジトリ RxRDB。リバリバ バベル攻略wiki 公開サイト）

リバースブルー×リバースエンドのバベル階層別Tier表サイト。GitHub Pages（main ブランチ / ルート）で公開。ビルド不要の静的サイト。

## 構成
- `index.html` … 公開サイト本体（HTML/CSS/JS 1ファイル）。`window.SITE` に GA4 の ID と Firebase（apiKey / projectId）を設定する。一般の閲覧では Firebase SDK は読み込まず、Firestore REST で `public/*` を読むだけ（失敗時は data/*.json）。
- `js/admin.js` … 管理画面（`#admin` / フッターの「管理者ログイン」で読み込む ES module）。Google ログイン、データ編集、読み込み・書き出し、画像、変更履歴、ご意見、アクセス、メンバー。
- `js/fb.js` … Firebase 初期化（gstatic 10.12.2）とオーナーのメールアドレス。
- `firestore.rules` … Firestore のセキュリティルール。変えたら Firebase コンソールのルールにも貼る。
- `data/chars.json` / `data/scripts.json` / `data/babel.json` … `{headers:[...], rows:[[...]]}` 形式の表データ。列名で参照しているので列の追加・並べ替えは自由。
  - chars: `ID`（例 `カノン_DEFAULT`）がキャラの識別子。Tier配置もこのIDで保存される。
- `data/tiers.json` / `data/news.json` … 公式Tier表とお知らせの予備（管理画面の data/*.json 書き出しに含まれる）。
  - scripts: `名前` が識別子。条件2・条件3 は属性/騎士団/階級/スタイル/キャラ名/女性・男性。
  - babel: `バベル種類` + `階層` が識別子。`解析データ` は1行1効果、`【味方】`などの見出し行で区切る。`おすすめキャラID` はカンマ区切りのキャラID。
- `data/images.json` … 画像の対応表。`thumbs`/`banners`（キャラID→パス）、`sthumbs`/`sfull`（スクリプト名→パス）、`icons`（属性・ロール・階級・騎士団名→パス）、`hero`。
- `images/` … Web用に縮小した画像（元画像は RxRDBbot/images）。サムネイルは 176px 正方形 webp。

## Firebase（プロジェクト my-log-vh3o3b / 表示名 RxRbabelDB、Spark プラン）
- データの正本は Firestore。`tables/{chars|scripts|babel|people|styles}`（headers）＋ `tables/{k}/rows/{id}`（`c`=列名→値, `o`=並び順, `t`, `by`, `rev`）。
- 保存すると管理画面が自動で `public/{k}`（`json`=`{headers,rows}` の文字列, `sig`）を作り直し、公開サイトはそれを読む。サムネイル位置は `public/crops`、プルダウンの選択肢は `public/options`（`json`={騎士団:[...],階級:[...],ロール:[...],...}）、公式Tier表は `public/tiers`（`json`=`{tiers:{"バベル種類|階層":{キャラID:Tier}}, at}`。管理画面の「Tier表」タブで運営が配置し、ユーザー画面は閲覧のみ）、ユーザー向けお知らせは `public/news`（`json`=お知らせの配列。予備は data/news.json）。
- 同時編集: 行ごとに `rev` を比べて衝突を検出（トランザクション）。`editing/{uid}` で「編集中」を表示。`log` に変更履歴（元に戻せる）。
- `feedback`（誰でも作成のみ）、`stats/{YYYY-MM-DD}`（pv/uv を +1 だけ）、`roles/{email}`（編集者。読み書きはオーナーのみ、本人は自分の分だけ読める）、`names/{uid}`（表示名）。メールアドレスはオーナー以外に見せない：行・履歴・公開データなどの `by` は uid（公開データには書かない）、表示は names の名前。
- 無料枠: 読み取り 5万/日、書き込み 2万/日。画像は Firebase に置かない（Storage は有料プラン）。
- ローカル確認では Firebase に届かないので、テストは gstatic と firestore.googleapis.com をモックして行う。

## マスター
- `people`（キャラクター: 名前・ふりがな・性別・誕生日・騎士団・階級・CV・プロフィール）と `styles`（スタイル・略称・よみ）。予備は data/people.json・data/styles.json。
- 公開用のキャラ表（public/chars）を作るとき、騎士団・階級・性別は people から合流させる（js/admin.js の publicData）。
- 新しいキャラ（スタイル別）は キャラ＋スタイルを選ぶと ID（`キャラ_スタイル`）・キャラ名（キャラ＋略称）・ひらがな（ふりがな＋よみ）・No が自動で入る。入力フォームの項目構成は js/admin.js の SCHEMA。

## 更新の流れ
- データ入力は公開サイトの管理画面（`/#admin`）で行う。即時に公開サイトへ反映される。
- `data/*.json` は予備（Firestore が読めないときのフォールバック）。管理画面「読み込み・書き出し」→「data/*.json を書き出す」で出して、ときどき上書き push する。
- 画像を足すときは images/ に webp で置き、data/images.json にキーとパスを追記する（管理画面「画像」で画像を入れると、変換済みの images/ と新しい data/images.json を ZIP で出せる）。スクリプト名とファイル名の表記ゆれに注意（IMAGE_REPORT.md 参照）。
- ローカル確認: `python3 -m http.server` で開く（file:// では data/*.json を読めない）。
