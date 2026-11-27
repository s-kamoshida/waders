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
- イベントの電子チケットなども管理できる（場所・手数料・交通費・その他費用・開催日時と終了日時）。入力する項目はカテゴリーごとに選べる
- ポイントやクーポンで値引きされる額（総額）を「値引き」に入れられる。一覧の金額は値引き後の金額で示し、見出しの合計からも引く（値引きは金額と送料などの合計まで。金額を入れていない商品には入れられない）
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

同じ LAN の PC やスマートフォンのブラウザで `http://raspberrypi.local:8080/waders/` を開きます（開けない場合は Raspberry Pi の IP アドレスで `http://<IP アドレス>:8080/waders/`）。`http://raspberrypi.local:8080` を開いても `/waders/` へ移ります。Raspberry Pi を再起動しても自動で起動します。

初めて起動したときに作られる設定では、**認証は無効**です。Waders に接続できる人は誰でも、ログインなしで商品を見たり変えたりできるため、信頼できる人だけがつながる家庭の LAN の中で使ってください。ログインを必須にする場合は「[認証](#認証)」を参照して有効にしてください。

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

`basePath` のない版から更新すると、開く URL が `http://raspberrypi.local:8080/waders/` になります。今までの `http://raspberrypi.local:8080` のブックマークやホーム画面のアイコンから開いても `/waders/` へ移るので、そのまま使えます。今までどおり `/` で開きたい場合は、`settings.json` に `"basePath": ""` を書いてください。

認証のない版から更新すると、設定に認証の項目がないため（安全のため）認証が有効になり、次に開いたときに「アカウントの作成」の画面が表示されます。すぐにアカウントを作ってください。認証を使わない場合は「[認証](#認証)」を参照して、`settings.json` に `"authenticationEnabled": false` を書いてください。

DB（`data/waders.sqlite`）の形式が変わる更新では、起動時に自動で新しい形式に移します。移した後の DB は古い版のアプリでは開けない（起動を止めます）ため、更新前の版に戻せるよう、再起動の前に DB をコピーしておくと安全です（例: `cp -p ~/waders/data/waders.sqlite ~/waders/data/waders.sqlite.bak`）。

### 運用

| やりたいこと | コマンド（Raspberry Pi） |
| --- | --- |
| 状態を見る | `systemctl status waders` |
| ログを見る | `journalctl -u waders -f` |
| 設定を変える | `~/waders/data/settings.json` を編集して `sudo systemctl restart waders` |
| パスワードを忘れた（アカウントを消す） | `cd ~/waders && PATH=/opt/homebridge/bin:$PATH npm run reset-account` |
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
  "port": 8080,
  "authenticationEnabled": false,
  "allowedHosts": [],
  "hostValidationEnabled": true,
  "basePath": "/waders"
}
```

| 項目 | 内容 | 既定値 |
| --- | --- | --- |
| `port` | 待ち受けるポート番号（1〜65535） | `8080` |
| `authenticationEnabled` | ID とパスワードによる認証を使うか（`true` か `false`）。ひな形では `false`。項目がなければ安全のため `true` として扱います | `false`（ひな形） |
| `allowedHosts` | 開くときに使う名前のうち、IP アドレス・`localhost`・`.local` で終わる名前（`raspberrypi.local` など）以外のもの（例: `["waders.home.example"]`）。ポートや `http://` は付けません。詳しくは「[接続を受け付ける名前](#接続を受け付ける名前)」 | `[]` |
| `hostValidationEnabled` | 接続を受け付ける名前を確かめるか（`true` か `false`）。項目がなければ `true` として扱います | `true` |
| `basePath` | 画面を開く URL のパス（`http://raspberrypi.local:8080/waders/` の `/waders`）。`/` で始め、末尾に `/` は付けません。英数字と `-`・`_`・`.`・`~` を `/` で区切って書けます（例: `"/apps/waders"`）。`""` にすると `http://raspberrypi.local:8080/` で開きます。`/` を開くと、このパスへ移ります。項目がなければ `/waders` として扱います。環境変数では変えられません | `/waders` |

次の環境変数を指定すると、設定ファイルより優先されます。

| 環境変数 | 内容 | 既定値 |
| --- | --- | --- |
| `WADERS_PORT` | 待ち受けるポート番号 | 設定ファイルの `port` |
| `WADERS_DATA_DIRECTORY` | データのフォルダ（設定ファイルなどを置く場所） | 起動したフォルダの `data` |
| `WADERS_AUTHENTICATION_ENABLED` | 認証を使うか（`true` か `false`） | 設定ファイルの `authenticationEnabled` |

データのフォルダには、次のファイルが作られます。バックアップする場合は、Waders を止めてからフォルダごとコピーしてください（バックアップのコマンドは今後追加します）。

| ファイル | 内容 |
| --- | --- |
| `settings.json` | 設定 |
| `waders.sqlite` | 商品と変更履歴、認証のアカウントの DB |
| `categories.json` | カテゴリーの定義 |
| `images/` | 商品の画像（最初に画像を付けたときに作られます） |

商品の画像は、追加・編集の画面の「画像」で選びます。コピーした画像やスクリーンショットは、画面を開いたまま Ctrl/⌘+V で貼り付けられます（iPhone では、画像の貼り付け欄をタップしてから長押しし、「ペースト」を選びます）。画面で長い辺 800px 以内に縮めて JPEG にしてから送るため、写真の位置情報などは保存されません。

画像を選ばなくても、購入先の URL を入れて保存すると、Waders がそのページの画像（SNS で共有したときに出る画像）を取りに行き、数秒で表示します。Amazon など、自動で取りに行くのを断るサイトでは取れないため、画像を選んでください。家庭の中の機器を守るため、LAN の中のアドレスへは取りに行きません。

設定に誤りがある場合は、理由をログに出して起動を止めます。

### 認証

初めて起動したときに作られる設定では、認証は**無効**です（ログインなしで使えます）。認証を有効にすると、ログインしないと Waders を使えなくなります。

**認証を有効にする**場合は、`settings.json` の `authenticationEnabled` を `true` にして再起動します（または環境変数 `WADERS_AUTHENTICATION_ENABLED=true`）。有効にした後に初めて画面を開くと「アカウントの作成」の画面になります。**最初に画面を開いた人がアカウントを作れるため、有効にしたらすぐに作ってください。**

認証が有効なときの動きは次のとおりです。

- **アカウントは1つだけ**です。家族などで使う場合も、同じ ID とパスワードを共有してください
- アカウントがないときに画面を開くと、「アカウントの作成」の画面になります。ID（1〜50文字）とパスワード（8〜128文字）を決めて作ると、そのままログインした状態になります
- ログインした状態は、最後に使ってから30日間続きます。ヘッダーの「ログアウト」で終えられます
- 同じ端末（IP アドレス）からログインに5回続けて失敗すると、その端末からは15分間ログインできなくなります（正しいパスワードでも）。失敗は端末ごとに数えるため、ほかの端末からの失敗で、あなたの端末のログインが止められることはありません。サーバーを再起動すると解除されます
- パスワードは、ソルトを付けたハッシュ値（scrypt）にして保存します。平文では保存しません
- **パスワードを忘れた場合**は、Raspberry Pi でアカウントを消してから、画面を開いて作り直してください。商品やカテゴリーは消えません。サーバーは止めなくてかまいません

  ```sh
  cd ~/waders
  PATH=/opt/homebridge/bin:$PATH npm run reset-account
  ```

  データのフォルダを環境変数 `WADERS_DATA_DIRECTORY` で変えている場合は、同じ値を付けて実行してください。
- 画面からパスワードを変えることはできません。変えたい場合も、上の手順でアカウントを作り直してください

> [!WARNING]
> Waders は HTTPS に対応していません。ログインのときのパスワードやログインした状態の情報は、**暗号化されずにネットワークを流れます**。家庭の LAN の外（インターネット）には公開しないでください。外から使いたい場合は、VPN などで家庭の LAN に入ってから使ってください。

**認証を無効にする**場合（既定）は、`settings.json` の `authenticationEnabled` を `false` にして再起動します（または環境変数 `WADERS_AUTHENTICATION_ENABLED=false`）。無効にすると、Waders に接続できる人は誰でも、ログインなしで商品を見たり変えたりできます。**無効で使うのは、信頼できる人だけがつながる家庭の LAN の中に限ってください。**

### 接続を受け付ける名前

Waders は、開くときに使う名前（URL のホスト名）が次のどれかの場合だけ応答します。悪意あるサイトを家庭の LAN の中の端末で開いたときに、そのサイトから Waders を操作されないようにするためです（DNS リバインディング対策。認証が無効なときも守ります）。

- IP アドレス（例: `http://192.168.1.10:8080/waders/`）
- `localhost`
- `.local` で終わる名前（例: `http://raspberrypi.local:8080/waders/`）
- `settings.json` の `allowedHosts` に書いた名前

自宅の DNS や VPN（Tailscale など）の名前で開く場合は、その名前を `allowedHosts` に書いて再起動してください。書いていない名前で開くと、「この名前では接続できません」と表示されます。

```json
{
  "version": 1,
  "port": 8080,
  "authenticationEnabled": false,
  "allowedHosts": ["waders.home.example"],
  "hostValidationEnabled": true,
  "basePath": "/waders"
}
```

リバースプロキシなどでインターネットに公開し、名前を前もって決められない場合は、`hostValidationEnabled` を `false` にすると確かめなくなります。**その場合は認証を有効にしてください**（認証が無効のまま確かめないと、悪意あるサイトから操作されるおそれがあります）。

### カテゴリーの定義

カテゴリーは、画面のヘッダーの右端にある「カテゴリーの管理」（タグの絵のボタン）から追加・名前の変更・削除ができます。変更はすぐに `categories.json` に保存されます。

- **名前を変える**と、そのカテゴリーの商品も新しい名前になります
- 商品が使っているカテゴリーを**削除する**ときは、商品をほかのカテゴリーに移すか、カテゴリー未設定にするかを選びます（アーカイブの商品も含みます）
- `categories.json` を手で編集してカテゴリーを消した場合などに、定義にないカテゴリーの商品があると、管理の画面の「定義にないカテゴリー」に表示されます。「定義に追加する」「別のカテゴリーに移す」「カテゴリー未設定にする」から選んでください
- 並び順は画面からは変えられません。下の方法でファイルを編集してください
- **入力する項目**を押すと、そのカテゴリーの商品の追加・編集で入力する項目を選べます（送料・メーカー・受注期限・キャンセル可・場所・開催日時と終了日時・手数料・交通費（見込）・その他費用）。チェックはすぐに保存されます。チェックを外しても、値が保存されている商品では表示します（値は消えません）
- 同じ画面で「その他費用」の名前を変えられます（例: ドリンク代。20 文字以内）。空にして変更すると「その他費用」に戻ります。その他に当たる費用が複数ある場合は、名前を工夫して（例: ドリンク代・グッズ代）合計を入力してください
- カテゴリー未設定の商品と、定義にないカテゴリーの商品では、送料・メーカー・受注期限・キャンセル可を入力でき、場所・開催日時・費用は値が保存されている場合だけ表示します

カテゴリーの一覧は、データのフォルダにある `categories.json` に書きます。初めて起動したときに、ひな形（[config/categories.example.json](config/categories.example.json)）から自動で作られ、「スケールフィギュア」「可動フィギュア」が入っています。ファイルの並び順が、絞り込みやプルダウンでの表示順になります。

```json
{
  "version": 1,
  "categories": [
    { "id": "k3f9x2ab", "name": "スケールフィギュア" },
    { "id": "p7m2q9cd", "name": "可動フィギュア" },
    { "name": "プラモデル" },
    {
      "name": "電子チケット",
      "fields": ["location", "eventPeriod", "handlingFee", "travelExpense", "otherExpense"],
      "otherExpenseLabel": "ドリンク代"
    }
  ]
}
```

- **追加する**: `{ "name": "カテゴリー名" }` を書き足します。`id` は書かなくてかまいません。次に読み込んだときに、Waders が `id` を付けてファイルに書き戻します
- **名前を変える**: `name` だけを書き換えます。`id` を変えなければ、そのカテゴリーの商品も新しい名前で表示されます
- **並べ替える**: 項目の順番を入れ替えます
- **消す**: 項目を消すと、そのカテゴリーの商品は「名前（定義にない）」と表示されます
- 名前は 50 文字以内で、同じ名前・同じ `id` を 2 つ書くことはできません
- **入力する項目を選ぶ**: `fields` に、入力する項目の名前を並べます（順番は問いません）。書かなかった場合は、送料・メーカー・受注期限・キャンセル可を入力します（今までと同じ）。`[]` にすると、選べる項目をすべて出しません

  | 名前 | 項目 |
  | --- | --- |
  | `shippingFee` | 送料 |
  | `maker` | メーカー |
  | `orderDeadline` | 受注期限 |
  | `cancelable` | キャンセル可 |
  | `location` | 場所 |
  | `eventPeriod` | 開催日時と終了日時（2 つで 1 組） |
  | `handlingFee` | 手数料 |
  | `travelExpense` | 交通費（見込） |
  | `otherExpense` | その他費用 |

  商品名・発売月・ステータス・カテゴリー・金額・値引き・URL・備考は、どのカテゴリーでも入力します
- **「その他費用」の名前を変える**: `otherExpenseLabel` に名前（20 文字以内）を書きます。書かなかった場合は「その他費用」です

ファイルは画面を開くたびに読み込むため、編集した後に Waders を再起動する必要はありません。ファイルに誤りがある（JSON として読めないなど）と、画面に理由が表示され、直すまでカテゴリーの設定と絞り込みは使えなくなります。商品の一覧や編集はそのまま使えます。

## 開発

Node.js 24 以上が必要です。

```sh
npm install
npm run dev          # 開発用に起動（画面 http://localhost:5173/ 、API は設定のポートの basePath の下へ転送）
npm run check        # 型チェック・ESLint・全テスト
npm run build        # 画面をビルド（dist/client）
npm start            # ビルドした画面とサーバーを起動（http://localhost:8080/waders/）
npm run reset-account  # アカウントを消す（パスワードを忘れた場合）
```

開発の決まりは [CLAUDE.md](CLAUDE.md) にあります。

## ライセンス

[MIT License](LICENSE)
