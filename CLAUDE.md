# RxRwiki（リポジトリ RxRDB。リバリバ バベル攻略wiki 公開サイト）

リバースブルー×リバースエンドのバベル階層別Tier表サイト。GitHub Pages（main ブランチ / ルート）で公開。ビルド不要の静的サイト。

## 構成
- `index.html` … 公開サイト本体（HTML/CSS/JS 1ファイル）。`window.SITE` に GA4 の ID と Firebase（apiKey / projectId）を設定する。一般の閲覧では Firebase SDK は読み込まず、Firestore REST で `public/all`（公開データ一式）を1回読むだけ（読めなければ `public/*` を個別に、それも駄目なら data/*.json）。
- 公開サイトのメニュー：ホーム（入口・お知らせ・前回の続き）／使い方ガイド／Q&A（運営が管理画面の「ガイド・Q&A」で編集。`public/guide`＝`json`={guide:[{id,title,body}],faq:[{id,q,a}]}、予備は data/guide.json。本文は空行で段落・「・」で箇条書き・「1. 」で番号・**太字**）、キャラクター、スクリプト、バベル、封印戦。最初はホーム（ホームの「前回見ていたページを開く」で前回のページから）。ヘッダー背景はキャラ＝ランダムな覚醒イラスト（banners）、スクリプト＝ランダムなスクリプトイラスト（sfull）、封印戦＝その封印戦のテーマイラスト（sealfull/seals）、ほか＝hero（`tabHero`）。縦長のイラストはサムネイルの切り抜き位置（顔のあたり）がヘッダーの見える範囲に来るよう位置合わせ（`heroFocus`）。キャラ詳細には `強いところ`・`弱いところ` を表示。
- `js/admin.js` … 管理画面（`#admin` / フッターの「管理者ログイン」で読み込む ES module）。Google ログイン、データ編集、読み込み・書き出し、画像、変更履歴、ご意見、アクセス、メンバー。
- `js/fb.js` … Firebase 初期化（gstatic 10.12.2）とオーナーのメールアドレス。
- `firestore.rules` … Firestore のセキュリティルール。変えたら Firebase コンソールのルールにも貼る。
- `data/chars.json` / `data/scripts.json` / `data/babel.json` … `{headers:[...], rows:[[...]]}` 形式の表データ。列名で参照しているので列の追加・並べ替えは自由。
  - chars: `ID`（例 `カノン_DEFAULT`）がキャラの識別子。Tier配置もこのIDで保存される。
- `data/tiers.json` / `data/news.json` … 運営Tier表とお知らせの予備（管理画面の data/*.json 書き出しに含まれる）。
  - scripts: `名前` が識別子。条件2・条件3 は属性/騎士団/階級/スタイル/キャラ名/女性・男性。
  - babel: `バベル種類` + `階層` が識別子。`攻略のコツ`（旧 `ポイント`。Firestore に古い列名が残っていれば管理画面が自動で付け替える＝js/admin.js の RENAMES）。`解析データ` は1行1効果、`【味方】`などの見出し行で区切る。`おすすめキャラID` はカンマ区切りのキャラID。
  - teams（編成例）: `バベル種類`+`階層`+`編成名` が識別子。`メンバー` は1行1人「キャラID|星|スクリプト名」（最大6人）、`コメント`。管理画面のバベル編集画面か「編成例」で編集し、公開サイトは階層ページに表示。星の下限はキャラの `レアリティ`（R=★1・SR=★2・SSR=★3）。予備は data/teams.json。
- `data/images.json` … 画像の対応表。`thumbs`/`banners`（キャラID→パス）、`sthumbs`/`sfull`（スクリプト名→パス）、`icons`（属性・ロール・階級・騎士団名→パス）、`hero`。
- ホーム画面に追加：`manifest.webmanifest` と `images/app/`（icon-192/512・apple-touch-icon・favicon-32。元デザインは images/app/icon-source.html（R を斜めに配置・x は右上にずらして縁取り。別案 icon-source-b.html）を Chromium で 512px に撮って縮小）。ホームの「📲 ホーム画面に追加」で Android/PC はインストール、iPhone は手順を表示。
- `images/` … Web用に縮小した画像（元画像は RxRDBbot/images）。サムネイルは 176px 正方形 webp。

## Firebase（プロジェクト my-log-vh3o3b / 表示名 RxRbabelDB、Spark プラン）
- データの正本は Firestore。`tables/{chars|scripts|babel|teams|seals|people|styles|bosses|events}`（headers）＋ `tables/{k}/rows/{id}`（`c`=列名→値, `o`=並び順, `t`, `by`, `rev`）。
- 保存すると管理画面が自動で `public/{k}`（`json`=`{headers,rows}` の文字列, `sig`）を作り直し、さらに公開サイト用の一式 `public/all`（`json`={chars,scripts,babel,teams,seals,crops,options,news,tiers,guide} をまとめたもの, `sig`）を作り直す。公開サイトは public/all を読む（読み取り回数の節約）。サムネイル位置は `public/crops`、プルダウンの選択肢は `public/options`（`json`={騎士団:[...],階級:[...],ロール:[...],...}）、運営Tier表は `public/tiers`（`json`=`{tiers:{"バベル種類|階層":{キャラID:Tier}}, at}`。管理画面の「Tier表」タブで運営が配置し、ユーザー画面は閲覧のみ）、ユーザー向けお知らせは `public/news`（`json`=お知らせの配列。予備は data/news.json）。
- 管理画面の読み取り節約: 行データはブラウザ（localStorage `rxr-admin-rows-v1-*`）に保存し、開くたびに `ts`（サーバー時刻）が前回より新しい行だけを読む。行を書くときは必ず `ts: serverTimestamp()` を付け、削除は `tables/{k}.dels`（行ID→削除時刻）に記録する（ヘッダーの書き込みは `{merge:true}` で dels を消さない）。3日ごとに全件読み直し、「読み込み・書き出し」に手動の全件読み直しボタン。変更履歴とご意見は、そのタブを開いたときに読む（未対応件数は件数クエリ）。
- 同時編集: 行ごとに `rev` を比べて衝突を検出（トランザクション）。`editing/{uid}` で「編集中」を表示。`log` に変更履歴（元に戻せる）。
- `feedback`（誰でも作成のみ）、`stats/{YYYY-MM-DD}`（pv/uv を +1 だけ）、`roles/{email}`（編集者。読み書きはオーナーのみ、本人は自分の分だけ読める）、`names/{uid}`（表示名）。メールアドレスはオーナー以外に見せない：行・履歴・公開データなどの `by` は uid（公開データには書かない）、表示は names の名前。
- 無料枠: 読み取り 5万/日、書き込み 2万/日（日本時間16時／冬は17時にリセット）。読み取りを使い切ると保存も公開サイトの読み込みも失敗する（公開サイトは data/*.json の古い内容になる）ので、読み取りを増やす変更は避ける。画像は Firebase に置かない（Storage は有料プラン）。
- ローカル確認では Firebase に届かないので、テストは gstatic と firestore.googleapis.com をモックして行う。

## 封印戦
- `seals`（封印戦名・キャラ名・ダメージタイプ・ステージ効果・過去開催日）。予備は data/seals.json。画像は images.json の seals/sealfull。
- Tier表は public/tiers のキー `封印戦|封印戦名` に入る（バベルと同じ仕組み。管理画面の Tier表タブで「封印戦」に切り替えて編集）。公開サイトはメニュー「封印戦」。

## マスター
- `bosses`（ボス: 名前・よみ・説明。画像は images.json の bosses/bossfull）と `events`（イベント名・開始日・終了日・実装キャラID・登場ボス・説明。テーマイラストは events/eventfull）。ボスはバベルの「ボス」・イベントの「登場ボス」と名前（空白・記号を無視）でつながる。予備は data/bosses.json・data/events.json。
- 選択肢の騎士団・階級・ロール・属性のアイコンは images.json の icons（管理画面の選択肢から GitHub にアップロード）。
- `people`（騎士: 名前・ふりがな・性別・誕生日・騎士団・階級・CV・プロフィール）と `styles`（スタイル・略称・よみ）。予備は data/people.json・data/styles.json。
- 公開用のキャラ表（public/chars）を作るとき、騎士団・階級・性別は people から合流させる（js/admin.js の publicData）。
- 新しいキャラ（スタイル別）は キャラ＋スタイルを選ぶと ID（`キャラ_スタイル`）・キャラ名（キャラ＋略称）・ひらがな（ふりがな＋よみ）・No（連番）が自動で入る。これらは編集不可（SCHEMA の型 `id` / `auto`。既存の行でも元の値のまま保存される）。入力フォームの項目構成は js/admin.js の SCHEMA。

## 更新の流れ
- データ入力は公開サイトの管理画面（`/#admin`）で行う。即時に公開サイトへ反映される。
- `data/*.json` は予備（Firestore が読めないときのフォールバック）。管理画面「読み込み・書き出し」→「data/*.json を書き出す」で出して、ときどき上書き push する。
- 画像を足すときは images/ に webp で置き、data/images.json にキーとパスを追記する（管理画面「画像」で画像を入れると、変換済みの images/ と新しい data/images.json を ZIP で出せる）。スクリプト名とファイル名の表記ゆれに注意（IMAGE_REPORT.md 参照）。
- ローカル確認: `python3 -m http.server` で開く（file:// では data/*.json を読めない）。
