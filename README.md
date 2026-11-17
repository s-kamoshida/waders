# Waders

フィギュアなどのホビーの予約購入を、発売月ごとに管理するセルフホスト型の Web アプリです。

> 現在は設計中です。要件は [docs/requirements.md](docs/requirements.md)、画面のモックは [docs/mock/index.html](docs/mock/index.html) にあります。

## 名前の由来

Waders（ウェーダー）は、釣り人などが沼や川に入るときに履く、胸まである胴長靴のことです。

ホビーは「沼」と形容される趣味です。フィギュアの本体だけでなく、関連するグッズや限定版、再販、別売りのパーツと、気付けば買うものが次々に増えていきます。そして予約の受付は発売のずっと前に締め切られるため、何を予約し何を見送るか、常に取捨選択を迫られます。

Waders は、その沼に入っても溺れないための装備を目指しています。

- いつ、何を、いくらで抱えているかを、月ごとの一覧と合計金額の見込みで見渡せる
- 受注期限が迫っている検討中の商品を目立たせ、予約するか見送るかの判断を後押しする
- 発売月を過ぎた商品は自動でアーカイブし、延期された商品には気付けるようにする

沼に入ること自体は止めません。足元を確かめながら進むための道具です。

## 主な機能（予定）

- 商品を発売月ごとに並べて表示する。年（暦年・年度）と月で折りたたみ、見出しに個数と合計金額の見込みを出す
- 商品のステータス（検討中・予約済・購入済・未購入）を色で区別し、発売月や受注期限に応じて自動で切り替える
- 発売月を過ぎた商品を「アーカイブ」のタブに移す。発売が延期された商品は、新しい発売月を指定してリストに戻せる
- 予約した商品が自動で購入済になったら、次に開いたときに「届いた」「延期された」「買わなかった」を確かめる
- 購入先のページの URL から商品画像を取得する。画像のアップロードもできる
- ドラッグアンドドロップで発売月を移動する
- カテゴリーで絞り込む。カテゴリーは自分の環境に合わせて定義できる
- PC・スマートフォン・タブレットのブラウザから使える
- ID とパスワードによる認証。家庭内の LAN だけで使う場合は無効にできる

## 動作環境（予定）

- Raspberry Pi 3B / 3B+ に [Homebridge の Raspbian イメージ](https://github.com/homebridge/homebridge-raspbian-image)（64-bit 版）を入れた環境を想定しています（3B で動作を確認済み）
- Node.js 24 以上

## Raspberry Pi へのインストール

画面のビルドは PC で行い、ビルドしたものを Raspberry Pi に転送します。Raspberry Pi では、動かすのに必要なパッケージだけを入れます。Node.js は Homebridge が使うもの（`/opt/homebridge/bin/node`）を共用します。

### 前提

- Raspberry Pi に [Homebridge の Raspbian イメージ](https://github.com/homebridge/homebridge-raspbian-image)の **64-bit 版**が入っていること（Node.js 24 は 32-bit 版では動きません）
- Homebridge の Node.js が 24 以上であること（Raspberry Pi で `/opt/homebridge/bin/node -v` を実行して確かめる）
- PC から Raspberry Pi に SSH で接続できること（以下では `pi@raspberrypi.local`）
- PC に Node.js 24 以上と rsync があること

ユーザー名や置き場所を変える場合は、以下のコマンドと [deploy/waders.service](deploy/waders.service) の `User`・`WorkingDirectory`・`ReadWritePaths` を合わせて変えてください。

### 初回のインストール

PC で、ビルドして Raspberry Pi に転送します。

```sh
git clone https://github.com/s-kamoshida/waders.git
cd waders
npm ci
npm run build
rsync -az --delete --exclude '/data/' --exclude '/node_modules/' -R \
  package.json package-lock.json config deploy src/server src/shared dist/client \
  pi@raspberrypi.local:/home/pi/waders/
```

Raspberry Pi で、パッケージを入れてサービスとして登録します。

```sh
cd ~/waders
PATH=/opt/homebridge/bin:$PATH npm ci --omit=dev
sudo install -m 0644 deploy/waders.service /etc/systemd/system/waders.service
sudo systemctl daemon-reload
sudo systemctl enable --now waders
```

同じ LAN の PC やスマートフォンのブラウザで `http://raspberrypi.local:8080` を開きます（開けない場合は Raspberry Pi の IP アドレスで `http://<IP アドレス>:8080`）。Raspberry Pi を再起動しても自動で起動します。

### 更新

PC で最新のコードを取得してビルドし、初回と同じ `rsync` で転送します（`data` フォルダは転送の対象から外しているので、データは消えません）。

```sh
git pull
npm ci
npm run build
rsync -az --delete --exclude '/data/' --exclude '/node_modules/' -R \
  package.json package-lock.json config deploy src/server src/shared dist/client \
  pi@raspberrypi.local:/home/pi/waders/
```

Raspberry Pi で、パッケージを入れ直して再起動します。

```sh
cd ~/waders
PATH=/opt/homebridge/bin:$PATH npm ci --omit=dev
sudo systemctl restart waders
```

DB（`data/waders.sqlite`）の形式が変わる更新では、起動時に自動で新しい形式に移します。移した後の DB は古い版のアプリでは開けない（起動を止めます）ため、更新前の版に戻せるよう、再起動の前に DB をコピーしておくと安全です（例: `cp -p ~/waders/data/waders.sqlite ~/waders/data/waders.sqlite.bak`）。

### 運用

| やりたいこと | コマンド（Raspberry Pi） |
| --- | --- |
| 状態を見る | `systemctl status waders` |
| ログを見る | `journalctl -u waders -f` |
| 設定を変える | `~/waders/data/settings.json` を編集して `sudo systemctl restart waders` |
| 止める・自動起動をやめる | `sudo systemctl disable --now waders` |

設定に誤りがあると起動に失敗し、60秒間に3回失敗すると再起動をあきらめます。ログで理由を確かめて直してから、`sudo systemctl restart waders` で起動してください。

### 参考: Raspberry Pi 3B での実績

| 項目 | 結果 |
| --- | --- |
| `npm ci --omit=dev` | 約12秒（69パッケージ、21MB） |
| 再起動から応答するまで | 約40秒 |
| Waders のメモリ使用量 | 約80〜90MB |

## 設定

設定は、データのフォルダにある `settings.json` に書きます。初めて起動したときに、ひな形（[config/settings.example.json](config/settings.example.json)）から自動で作られます。

```json
{
  "version": 1,
  "port": 8080
}
```

| 項目 | 内容 | 既定値 |
| --- | --- | --- |
| `port` | 待ち受けるポート番号（1〜65535） | `8080` |

次の環境変数を指定すると、設定ファイルより優先されます。

| 環境変数 | 内容 | 既定値 |
| --- | --- | --- |
| `WADERS_PORT` | 待ち受けるポート番号 | 設定ファイルの `port` |
| `WADERS_DATA_DIRECTORY` | データのフォルダ（設定ファイルなどを置く場所） | 起動したフォルダの `data` |

データのフォルダには、次のファイルが作られます。バックアップする場合は、Waders を止めてからフォルダごとコピーしてください（バックアップのコマンドは今後追加します）。

| ファイル | 内容 |
| --- | --- |
| `settings.json` | 設定 |
| `waders.sqlite` | 商品と変更履歴の DB |

設定に誤りがある場合は、理由をログに出して起動を止めます。

## 開発

Node.js 24 以上が必要です。

```sh
npm install
npm run dev          # 開発用に起動（画面 http://localhost:5173 、API は設定のポート）
npm run check        # 型チェック・ESLint・全テスト
npm run build        # 画面をビルド（dist/client）
npm start            # ビルドした画面とサーバーを起動（http://localhost:8080）
```

開発の決まりは [CLAUDE.md](CLAUDE.md) にあります。

## ライセンス

[MIT License](LICENSE)
