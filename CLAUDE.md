# RxRDB（バベル Tier表メーカー 公開サイト）

リバースブルー×リバースエンドのバベル階層別Tier表サイト。GitHub Pages（main ブランチ / ルート）で公開。ビルド不要の静的サイト。

## 構成
- `index.html` … アプリ本体（HTML/CSS/JS 1ファイル）。`window.SITE` にアクセス解析のIDを設定する。
- `data/chars.json` / `data/scripts.json` / `data/babel.json` … `{headers:[...], rows:[[...]]}` 形式の表データ。列名で参照しているので列の追加・並べ替えは自由。
  - chars: `ID`（例 `カノン_DEFAULT`）がキャラの識別子。Tier配置もこのIDで保存される。
  - scripts: `名前` が識別子。条件2・条件3 は属性/騎士団/階級/スタイル/キャラ名/女性・男性。
  - babel: `バベル種類` + `階層` が識別子。`解析データ` は1行1効果、`【味方】`などの見出し行で区切る。`おすすめキャラID` はカンマ区切りのキャラID。
- `data/images.json` … 画像の対応表。`thumbs`/`banners`（キャラID→パス）、`sthumbs`/`sfull`（スクリプト名→パス）、`icons`（属性・ロール・階級・騎士団名→パス）、`hero`。
- `images/` … Web用に縮小した画像（元画像は RxRDBbot/images）。サムネイルは 176px 正方形 webp。

## 更新の流れ
- データ入力は claude.ai の管理用アーティファクトで行い、「GitHub用データを書き出す」で出した data/*.json を上書きして push。
- 画像を足すときは images/ に webp で置き、data/images.json にキーとパスを追記する。スクリプト名とファイル名の表記ゆれに注意（IMAGE_REPORT.md 参照）。
- ローカル確認: `python3 -m http.server` で開く（file:// では data/*.json を読めない）。
