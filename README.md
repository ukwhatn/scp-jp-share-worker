# scp-jp-share-worker

**このリポジトリは使われていません。** 2026-10-11 に `share.scpwiki.jp` を SCP-JP/panopticon の `apps/share`（Worker `panopticon-share`）へ移し、この Worker と R2 バケット `scp-jp-share-worker-ogp` は削除しました。

- シェア用のカードの見た目（背景・文字の色）は、panopticon の管理画面「シェア画像」で変えます
- `wrangler.jsonc` に `share.scpwiki.jp` の custom domain が残っています。このリポジトリから `wrangler deploy` すると、ドメインがこの Worker に戻るので実行しないでください
- `r2/` のフォントと背景は、移行先のバケット `panopticon-ogp` に同じ内容で置いてあります
