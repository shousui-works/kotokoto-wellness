# こつこつ日和のTerraform運用

Cloud Runとその基盤を管理する。対象のGCPプロジェクトIDは必須入力とし、現在のgcloud設定を暗黙に使わない。2026年10月18日に、選択済みの `kotokoto-biyori` へbootstrap・foundation・appを適用した。

認証・Firestore追加の方針は [認証とFirestoreのTerraform設計](../../docs/auth-storage-terraform-design.md) を参照。`auth`・`data`と、既存rootの接続設定を実装済み。foundation/authとdataの主要リソースを `kotokoto-biyori` へ適用した。稼働中のアプリは引き続き端末内保存で、Googleプロバイダーの有効化と公開ホストの登録は完了し、認証API・保存API・削除workerのアプリ実装はこれから行う。

## 構成

| ディレクトリ | 作成するもの | stateのprefix |
| --- | --- | --- |
| `bootstrap/` | state用GCSバケット、追加のstate管理者への権限 | `kotokoto/bootstrap` |
| `foundation/` | API有効化、Artifact Registry、ビルド用・実行用サービスアカウント、ビルドソース用バケット、空のSecret Manager保管先 | `kotokoto/foundation` |
| `auth/` | Firebase追加、専用Web登録、任意の既存認証設定の許可ドメイン管理（適用済み、認証共通設定は管理しない） | `kotokoto/auth` |
| `data/` | 保護付きFirestore、Rules・索引・TTL、IAM、削除管理GCS（DB・Rules・IAM適用済み） | `kotokoto/data` |
| `app/` | Cloud Run、任意IAP・秘密情報参照、認証設定と任意の削除Job・Scheduler（追加分は未適用） | `kotokoto/app` |

初回は `bootstrap → foundation → ビルド → app` の順に適用する。ビルドはCloud Build、Cloud Runへの反映はTerraformが担当する。appのイメージは、foundationのリポジトリにある `image@sha256:...` だけを受け付ける。`latest`等のタグをデプロイすることはできない。

初期設定は東京、CPU 1、メモリ256MiB、第1世代の実行環境、最小0・最大1インスタンス、リクエストベース課金。256MiBで動かせる第1世代を明示している（第2世代は512MiB以上が必要）。[実行環境の要件](https://docs.cloud.google.com/run/docs/configuring/execution-environments)。削除保護は有効。公開フラグ `allow_public_access` の既定値はfalseで、現在の `kotokoto-biyori` にはユーザーの希望に合わせtrueを明示している。

## 必要な環境

- Terraform 1.13.5以降の1.x。今回のローカル検証は1.13.5を使用した。
- Node.js 24以降。配信サーバー、ビルド用スクリプト、テストに使う。
- gcloud CLIと、対象プロジェクトを操作できるGoogleアカウント。
- 作成済み・課金設定済みのGCPプロジェクト。プロジェクトの新設と課金アカウントの紐付けは、このTerraformの外で先に行う。

Google providerと、IAPサービスエージェントに必要なGoogle Beta providerはlockファイルで固定している。`.terraform.lock.hcl`はGitに含める。`.terraform/`、state、保存したplan、実際のtfvarsとbackend設定はGit対象外。

GCPに適用する段階では、gcloudのログインに加えてTerraform用のApplication Default Credentialsを設定する。長期間使うサービスアカウントキーのJSONを作る必要はない。

```sh
gcloud auth application-default login
```

操作アカウントには、API有効化、バケット・Artifact Registry・サービスアカウント・Secret Manager・Cloud Runの作成、必要なIAMメンバーの追加、ビルド実行とビルド用サービスアカウントの利用権限が必要。stateの管理者やビルド用アカウントにProject Ownerを自動付与する構成にはしていない。

## クラウド変更なしで検証する

リポジトリのルートで実行する。検証は5構成を一時フォルダへコピーし、本番tfvars・backendメタデータ・stateを除外する。initはproviderの取得だけを行い、backendを初期化しない。Terraformテストは全providerをモックに差し替え、GCPの認証情報やリソースを使わない。

```sh
node --test test/*.test.mjs
node scripts/check-terraform.mjs
```

別のTerraform実行ファイルを使う場合は、グローバルなインストールを変更せず指定できる。

```sh
KOTOKOTO_TERRAFORM_BIN=/absolute/path/to/terraform node scripts/check-terraform.mjs
```

ビルドに使う引数も、Cloud Buildを実行せず確認できる。

```sh
node scripts/build-cloud-run.mjs --project your-project-id --release review-1 --dry-run
```

## 初回の準備

以下はGCPのリソースを作る実行手順。実際のプロジェクトID、閲覧する本人のアカウント、課金先を選択した後に使う。サンプルのIDやメールアドレスをそのまま使わない。

1. 各ディレクトリの `terraform.tfvars.example` を `terraform.tfvars` にコピーし、同じプロジェクトID・リージョン・app_nameを設定する。bootstrapにはapp_nameは不要。
2. appの `invoker_members` を本人の `user:メールアドレス` にする。初回は `enable_iap = false`、`openai_secret_version = null` のままでよい。
3. 対象プロジェクトでTerraformによる初期操作に必要なService Usage APIとCloud Resource Manager APIを有効にする。すでに有効な場合は追加操作は不要。

```sh
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com --project=your-project-id
```

## stateバケットを作る

最初のbootstrapだけはローカルstateで適用する。`backend.tf.example` はこの段階ではコピーしない。

```sh
terraform -chdir=infra/terraform/bootstrap init
terraform -chdir=infra/terraform/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=infra/terraform/bootstrap apply bootstrap.tfplan
terraform -chdir=infra/terraform/bootstrap output -raw state_bucket
```

出力したバケット名を、各ディレクトリの `backend.tfbackend.example` に反映し、`backend.tfbackend` として保存する。3つのprefixは分けたままにする。

バケット作成後、bootstrapのstateも同じGCSへ移す。

```sh
cp infra/terraform/bootstrap/backend.tf.example infra/terraform/bootstrap/backend.tf
terraform -chdir=infra/terraform/bootstrap init -migrate-state -backend-config=backend.tfbackend
```

移行後に `terraform -chdir=infra/terraform/bootstrap plan` を実行し、既存のバケットをもう一度作ろうとしないことを確認する。stateやローカルのバックアップをGitに追加しない。バケットは世代管理・公開アクセス禁止・統一されたIAMを設定し、Terraformからの削除と、中身ごとの強制削除を防いでいる。

## 基盤を適用する

```sh
terraform -chdir=infra/terraform/foundation init -backend-config=backend.tfbackend
terraform -chdir=infra/terraform/foundation plan -out=foundation.tfplan
terraform -chdir=infra/terraform/foundation apply foundation.tfplan
```

foundationはCloud Runの実行用とCloud Buildのビルド用を別アカウントにする。ビルド用には、専用リポジトリへの書き込み、専用ソースバケットの読み取り、ログ出力だけを付与し、Cloud Runのデプロイ権限やAPIキーの読み取り権限は付けない。

ビルドソースのアップロードは実行者の権限で行う。ビルドを実行するアカウントには、専用ソースバケットへのアップロードとビルド用サービスアカウントの利用権限も必要になる。state用バケットへの権限をビルド用アカウントに付与しない。

## ビルドしてCloud Runへ反映する

リポジトリのルートで実行する。`--project`は必須。リージョンやapp_nameを変えた場合は、`--region`と`--app`も同じ値で指定する。

```sh
node scripts/build-cloud-run.mjs --project your-project-id
```

スクリプトはCloud Buildで既存の犬の動作と新しい配信サーバーをテストしてから、Dockerfileでイメージを作る。専用ソースバケット・専用ビルドアカウントを明示し、Cloud Runの設定は変更しない。成功時だけ、取得したダイジェストを `.gcp-build/release.auto.tfvars.json` に保存する。

タグは時刻と乱数で毎回別にする。`--release`で明示する場合も、使い回さない。リポジトリはタグの上書きを禁止している。ソースのアップロード対象は `.gcloudignore`、コンテナに含めるものは `.dockerignore` とDockerfileで限定する。

```sh
terraform -chdir=infra/terraform/app init -backend-config=backend.tfbackend
terraform -chdir=infra/terraform/app plan -var-file=../../../.gcp-build/release.auto.tfvars.json -out=release.tfplan
terraform -chdir=infra/terraform/app apply release.tfplan
terraform -chdir=infra/terraform/app output -raw service_url
```

2回目以降は、ビルドとappのplan・applyで更新する。Cloud Runのイメージ、環境設定、トラフィックを別の `gcloud run deploy` やコンソール操作で並行管理しない。切り戻す場合も、以前のダイジェストを指定して同じ手順を使う。

## ログインなしで公開する

現在の公開方法。appの `terraform.tfvars` に以下を指定し、前述のappのplan・applyを実行する。アプリのイメージを変えない場合、再ビルドは不要。

```hcl
allow_public_access = true
enable_iap          = false
invoker_members     = []
iap_members         = []
```

Cloud RunのInvoker IAMチェックを無効にして公開する。`allUsers` のIAMバインディングは作らない。公開とIAP・専用閲覧者を同時に指定すると、planはエラーになる。端末の記録は引き続きlocalStorageに保存される。[公開設定の公式手順](https://docs.cloud.google.com/run/docs/authenticating/public)

## 非公開で動作確認する場合

`allow_public_access = false`、`enable_iap = false` にし、`invoker_members` に本人を指定するとIAM認証の非公開サービスになる。PCでは、本人のgcloud認証を使ったローカルプロキシで開く。

```sh
gcloud run services proxy kotokoto-biyori --project=your-project-id --region=asia-northeast1 --port=8081
```

ブラウザで `http://127.0.0.1:8081` を開く。このURLで使ったlocalStorageとCloud RunのURLのlocalStorageも別になるので、プロキシ上の記録を移行完了のデータとして扱わない。

スマホでCloud RunのURLを直接開いてGoogleログインする段階では、IAPの初回設定を済ませてからappの設定を変更する。

```hcl
allow_public_access = false
enable_iap      = true
invoker_members = []
iap_members     = ["user:you@example.com"]
```

IAPモードではCloud Runの呼び出しをIAPサービスエージェントに許可し、指定した本人にはIAP経由の閲覧権限を付与する。初回OAuth設定は、組織に属さないプロジェクトなどでコンソール操作が必要になることがある。手動の初期設定でサービスの設定も変えた場合は、上記の変数をそろえてplanを確認し、Terraformの管理へ戻す。[IAPの公式手順](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run)

## APIキー登録とLuna接続

foundationは空のSecret Managerの保管先だけを作る。キー本体の入力欄、`secret_data`、秘密情報のバージョンを作るリソースはTerraformに含めていない。

キーはOpenAI Developersの専用フローで、ユーザーが選んだ組織・プロジェクトに作成し、承認済みのGit対象外envファイルへ保存する。キー本体は通常のツール出力やチャットへ出さず、Secret Managerに登録する。appの `openai_secret_version` にバージョン番号だけを指定すると、実行用アカウントへの保管先限定の読み取り権限と、Cloud Runへの `OPENAI_API_KEY` の参照を作る。`latest`は指定できない。2026年10月18日にバージョン1を登録し、固定モデル `gpt-6-luna` との会話を公開した。

## 初回デプロイ後に残る設定

対象は `kotokoto-biyori`。課金有効状態、本人のOwner権限とTerraform用ADCを確認済み。ユーザーの方針変更で、現在はIAPを使わないログイン不要の公開アプリとして稼働している。予算通知と、既存記録の読み込み機能が残っている。

初期確認時にGoogle Auth Platformの同意画面（外部・テスト）を作成したが、カスタムOAuthクライアントは作成していない。今後Googleログインを採用する場合は、個人アカウント用OAuthクライアントの初期設定から再開する。認証情報の値をTerraformへ入力しない。

既存のSitesの公開、project_id、`dist/` 内のアプリ、保存データの形式は維持している。GCPへ普段使うURLを切り替えるときは、[移行計画](../../docs/gcp-deployment-plan.md)に従い記録の引き継ぎを確認する。

## ローカル検証の結果

2026年10月18日にTerraform 1.13.5、GoogleとGoogle Beta provider 8.7.0で検証した。既存のTerraformインストールは変更せず、公式チェックサムを確認した別の実行ファイルを使った。

- 3構成のfmt・validateと、bootstrapのモック2件・foundationの1件が成功。公開モード追加後のappのモック11件も成功。
- 既存のこむぎの動作と、新しい配信サーバー・ビルド処理のNodeテスト25件が成功。
- linux/amd64向けDockerイメージのビルドと起動が成功。実際の画面・静的ファイル16件・ヘルスチェックを確認した。
- コンテナは非rootで実行し、アプリのディレクトリにはdistとserverだけが存在すること、APIキーが入っていないことを確認した。
- プロジェクトのソース・設定ファイルがHTTP経由で公開されないことと、GCPへのソースアップロード対象を確認した。
- providerのlockファイルにはMac ARM64とLinux AMD64の公式チェックサムを記録した。

## 実際のGCPへの適用結果

2026年10月18日に以下を実施した。

- `kotokoto-biyori` の課金有効状態と本人のOwner権限、既存ADCの利用を確認。Cloud Resource Manager APIを初期有効化した。
- bootstrapは2リソース、foundationは15リソース、appは2リソースを適用。bootstrap stateをGCSに移行し、3構成とも別prefixで保存した。
- Cloud Buildの初回投入は権限エラーで作成されず、Google側サービスエージェントの作成とIAMを確認して再実行。ビルド `6edafc8f-a475-41b3-8204-9d1e033e1064` が成功した。
- デプロイしたイメージは `asia-northeast1-docker.pkg.dev/kotokoto-biyori/kotokoto-biyori/app@sha256:d955afe81b7e8d5b4d99bad872a1dacb44d342467f213ed459fa93d2103e0d10`。
- Cloud Runは `https://kotokoto-biyori-oidgpmqhiq-an.a.run.app`。リビジョン `kotokoto-biyori-00001-ng7` はReadyで、トラフィック100%。現在はログイン不要の公開モード。
- 公開後、認証情報・CookieなしのHTTPSで `/` と静的16ファイルがローカルの `dist/` と一致。ブラウザでこむぎの部屋が表示され、プロジェクトのソース・Terraform設定のURLは404だった。
- `/healthz` は起動・livenessプローブ用。Cloud Runの外部URLでは404を確認したため、外部配信の確認には `/` と静的ファイルを使用した。
- 基盤の適用後に3構成のplanを実行し、すべて差分なし。公開モードへの変更後もappのplanは差分なし。
- 公開への切り替えはサービス設定1件を更新し、IAP権限2件とサービスIDのTerraform管理を削除。IAP APIとGoogle Auth Platformの同意画面は残っているが、現在の配信では使わない。
- 初回Luna会話のCloud Build `3868df5d-ea3c-4b60-9ab8-3df608367cb0` が成功。その時点のイメージは `asia-northeast1-docker.pkg.dev/kotokoto-biyori/kotokoto-biyori/app@sha256:6e1420a54e4f9e2922f5d07655d45ebdcc70628769f9df8dd96eebb4a2c515ed`。専用シークレットの参照権限を実行用アカウントに限定し、会話API・ブラウザの実際の応答と、静的18ファイルの一致を確認した。Nodeテストは36件。

- 常設チャット・報告の構造化・Lunaのカロリー推定・ポイント・クエスト・日報/グラフを追加したCloud Build `e0ea74b6-e411-4182-8f28-75a7fd1aeeb9` が成功。その時点のイメージは `asia-northeast1-docker.pkg.dev/kotokoto-biyori/kotokoto-biyori/app@sha256:5ded0fa91373430e4da3eb30b676017ff97f05dbfb41a590ba1efbaffcbebb98`。Terraformでサービスのイメージ1件だけを更新し、適用後のplanは差分なし。公開HTTPSの静的20ファイルが一致し、API準備状態・Secure/HttpOnly cookie・非公開ファイルの404と、実際のLunaの雑談応答を確認した。Nodeテスト52件、Terraformモック14件が成功。ユーザーが個別に許可した架空の「ストレッチしたよ」を1回だけ実際のLunaに送り、返事・候補抽出・クエスト達成と10ポイントの保存までローカルで確認した。公開ブラウザの記録にはテストの行動を追加していない。カロリー推定値の保存・根拠表示・訂正・集計は外部通信のない固定応答と単体テストで検証した。

実際のスマホでの操作確認、既存記録の読み込み、予算通知は未完了。ブラウザのスマホ幅と、小さい高さで会話画面を検証した。Lunaとの会話を実装し、Secret Managerのバージョン1をCloud Runから参照している。会話の回数制限はサーバープロセス内で、再起動をまたぐ厳密な課金上限ではない。仕様と制限はルートのREADME「こむぎへの報告とえらいポイント」を参照する。

2026-10-18の吹き出し表示への変更: Cloud Build `31edc6e7-b90a-49e8-a679-25179d70b90d` が成功。現在のイメージは `asia-northeast1-docker.pkg.dev/kotokoto-biyori/kotokoto-biyori/app@sha256:70926404d26f6846704197c1ee8c7c35386f43f35bb33517fadee5ebf2a2445c`。Terraformでイメージ1件だけを更新し、静的20ファイルの一致と会話APIの準備状態を確認。Nodeテスト54件が成功。下は入力欄と達成表示、返事は頭のそばの吹き出しへ変更した。長文のページ送り・履歴の開閉・読み終わるまで犬が待つことをオフラインのUIでも確認した。
公開版で「こむぎ、ただいま」への実際のLunaの返事が頭のそばに表示され、下の会話ログは閉じたままであることを確認。適用後のapp planは差分なし。

2026-10-18: 入力欄の「こむぎにひとこと」見出しを削除。Cloud Build `88a0bb8a-706d-4b0f-801a-07938fa67a23`、現在のイメージは `asia-northeast1-docker.pkg.dev/kotokoto-biyori/kotokoto-biyori/app@sha256:1cab0847c688f9db3f490601717b4c576e1f394bf30065e84ea9d8b4b025ebcf`。サービスのイメージ1件だけをTerraformで更新し、公開HTML一致とブラウザ表示を確認した。

2026-10-18: 履歴の入口を右上の時計アイコンへ移動し、専用の履歴画面を用意。Cloud Build `6fa87788-4b22-433b-a012-fd1d7884cb22`、現在のイメージは `asia-northeast1-docker.pkg.dev/kotokoto-biyori/kotokoto-biyori/app@sha256:3c76f0a00669c35527fc1ca44ea7886fe30d470cd900095a7bd65005d32288d4`。Cloud Runのイメージ1件だけを更新し、変更4ファイルの一致、公開版の履歴開閉、適用後のapp plan差分なしを確認した。

2026-10-18: 送信するとこむぎが手前へ寄ってアップで返事する機能を公開。Cloud Build `e807cce0-f163-460a-8413-ec3994567169`、現在のイメージは `asia-northeast1-docker.pkg.dev/kotokoto-biyori/kotokoto-biyori/app@sha256:197cc9381f02bf65fbf4110b2d951bf872e7e19d1b7c79ec4e4ecff393362a65`。Cloud Runのイメージ1件だけを更新した。Node 57件が成功し、変更6ファイルの公開一致・適用後のapp plan差分なしを確認した。
公開版で通常の雑談を1回送り、実際のLunaの返事が手前の大きなこむぎの吹き出しに表示されることを確認した。検証用ローカルサーバーは停止済み。

2026-10-18: 記録画面と共通の最新体重・記録日・参照元をLunaへ渡し、記録済みの値を聞き直さないように変更。Cloud Build `2e55c184-0315-4692-9a4a-807174519c45`、現在のイメージは `asia-northeast1-docker.pkg.dev/kotokoto-biyori/kotokoto-biyori/app@sha256:6472493126cc7a788f1e3d5e96b3f1875a2f915144fb172996f88779cbe33202`。Cloud Runのイメージ1件だけを更新し、Node 60件成功・変更4ファイルの公開一致・適用後のapp plan差分なしを確認。オフラインの固定応答で架空の体重記録から運動報告までの連携を検証し、公開版では記録画面の説明の反映を確認した。この変更の検証で本番の健康データをOpenAIへ送信したり、本番の記録を変更したりしていない。

2026-10-18: ユーザー指定によりLunaの `reasoning.effort` を `none` から `low` へ変更して公開。Cloud Build `3eacbfef-0fcb-44f3-b233-6b5c4b0d70a6`、イメージ `sha256:de8ec2ff3555a2da849f4e9dfcd153a83a47a90e5756ea657ad45d5e14449fb3`。イメージ1件だけをTerraformで更新し、適用後のplanは差分なし。Node 60件が成功。公開APIに健康情報・保存履歴を含まない挨拶だけを送り、HTTP 200とLunaの実返信、行動候補0件を確認した。ブラウザの記録は変更していない。

2026-10-18: 「相づちと質問だけで褒めてもらえない」というユーザーの指摘を受け、Lunaのプロンプトを変更。体を大切にする行動や日常の工夫を報告したときは、具体的な褒め言葉を最初に添える。数値・時間が不足していても実行した行動は先に褒め、その後で必要な質問を一つだけ行う。相づち・お礼は褒め言葉の代用にしない。体重測定・散歩・ストレッチの返答例を追加し、雑談や単なる補足への不自然な称賛、未確認の成果の捏造は避ける。Cloud Build `79ebe374-3f01-41a2-a6f4-05ee6830ccb0`、イメージ `sha256:5a17fef1a49f668bf25710289e9a08054f71f382cb4900db8bf48912bfdb7707`。Node 60件成功、Terraformはイメージ1件のみ更新・適用後plan差分なし。健康情報や保存履歴を含まない架空の片づけ報告を公開APIで試し、「机の上を片づけたんだね、えらいねー。身のまわりを整えられて、ぼくもうれしいな。」という実際の返答を確認した。本番ブラウザの記録は変更していない。reasoning effortはlowを維持。

2026-10-19: スマホのキーボード表示で配置が崩れる問題を修正して公開。`dist/room-viewport.mjs` がVisual Viewportの高さ・offsetTop・下端をCSS変数へ反映し、部屋・入力欄・吹き出しの基準を統一する。キーボード中はメニュー等を一時的に隠し、blurだけでは解除しない。Androidの二重オフセット、iOSのスクロール、ピンチズームを区別。狭い縦画面では犬と吹き出しを横に並べ、表示中の長文も未読部分を60文字単位へ分割する。Cloud Build `101582ca-6211-46a8-9818-163bcf5fff75`、イメージ `sha256:bcb27066abc360072c5ecbdf5b6b915d07363abaafcf5dea3c239041fd0ca09a`。Node 67件成功。Terraformはイメージ1件のみ更新し、適用後plan差分なし。変更7ファイルの公開一致を確認。外部通信のないローカル画面で390×460・390×360・844×210の縮小表示と通常サイズへの復帰を検証。実機のソフトキーボード操作自体は未確認で、Visual Viewportの開閉・blur・回転・ズームはモックテストで補完した。検証サーバーは停止、ブラウザの一時的な画面サイズも解除済み。保存形式・Luna設定は変更していない。

2026-10-19: ユーザーの「ロゴやその他の表示はいらない」に合わせ、部屋の常設表示をこむぎ・吹き出し・入力欄・右上の「…」だけに整理。ロゴ・日付・たね・プロフィール・下のドック・吹き出しの補助見出しを非表示にし、記録・なでる・もようがえ・育成・遊び・動きの停止・履歴・設定をdetailsメニューへまとめた。指定されたOpenAI送信等の説明文はUIから削除し、textareaの参照先も修正した。Cloud Build `bf4bc5f4-8fa7-44e5-bec7-acb2eb1265e9`、イメージ `sha256:8157445ee005ef7ee47400dbf7a62ddb431aca4375a0fa74899260e597440c93`。Node 67件成功。Terraformはイメージ1件だけ更新、適用後plan差分なし。変更3ファイルの公開一致と指定文の削除を確認。ローカルのオフライン画面でメニューの記録・設定・履歴の開閉、吹き出し返信を確認し、検証サーバーを停止・画面サイズを復元した。保存形式・Lunaの設定や判定は変更していない。

2026-10-19: ユーザーが自分の「呼ばれたい名前」を登録できるよう追加。右上「…」→設定の先頭に20文字までの登録欄を設け、空欄で保存すると「きみ」へ戻す。`dist/profile.mjs` が別キー `kotokoto-profile-v1` の読み書き・検証を担当し、既存の記録形式は変更しない。次の新しい会話のcontext.nicknameとしてLunaへ渡し、サーバーでも文字数・制御文字を検証。呼び名は命令ではない参考データとして扱い、過去の呼び方より最新登録を優先する。定型の声かけも登録名へ置き換え、バックアップにprofileを含める。Cloud Build `10fb37f6-b528-4215-a92f-470529d7b0af`、イメージ `sha256:9a44a7853ffd6c45c12965c1dfb66d7f50953d824e4c6e3429ac7df136fb0a03`。Node 70件成功、変更3静的ファイル一致、Terraformはイメージ1件のみ更新・適用後plan差分なし。オフライン画面で保存と再読み込み、定型の呼び名を確認。公開APIでは健康記録・履歴なしの架空名「そら」と挨拶だけを送り、「そら、こんにちは！」とLunaが呼ぶことを確認。本番のブラウザへ架空名は登録していない。ローカルサーバー停止・一時画面サイズ解除済み。

2026-10-19: 名前が未登録で部屋を開くと、こむぎが近づいて「ぼくはこむぎ。きみのこと、なんて呼んだらいい？」と質問する導線を追加。`dist/name-intro.mjs` が下の名前入力欄・登録・「あとで」を扱う。保存成功後だけ名前でお礼を返し、通常の会話欄へ戻す。登録済みなら質問せず、スキップ後は同じページ内で再質問しない。設定や別タブで登録された場合も導線を閉じる。名前入力もVisual Viewportのキーボード対象へ追加。保存先は既存の `kotokoto-profile-v1` のままで、名前質問のためのLuna呼び出しやポイント加算はない。Cloud Build `9854c842-91ac-4c3e-aeaf-ade72c0951c4`、イメージ `sha256:757679595f704fcf62973cf05cc5cf219ddb0a00d80acb82042d728ca377c661`。Node 74件成功、変更5ファイルの公開一致、Terraformはイメージ1件のみ更新・適用後plan差分なし。オフラインUIで未登録の質問・スキップ・入力からの登録・再読み込み後の質問非表示を確認。本番の名前や記録は変更せず、検証サーバー停止・一時画面サイズ解除済み。

2026-10-19: スマホの改行キーで送信したいという指定を受け、`bindChatEnter` を会話欄へ追加。Enterで送信・Shift+Enterで改行、enterkeyhint=send。IME変換中・keyCode229・compositionend直後50msは送信せず、キー長押しの連投を防ぐ。keydownのないモバイルキーボードはbeforeinputの改行入力で補完する。Cloud Build `9a0e9420-de81-47d4-ba43-0fa39bb00a46`、イメージ `sha256:8e92caeab0123da46bb8bf2cc1985e59b738085ab35de768b6df2a0573708e11`。Node 77件成功、変更3ファイルの公開一致、Terraformはイメージ1件のみ更新・適用後plan差分なし。オフラインUIで送信ボタンを押さずにEnterだけで返信が出ること、Shift+Enterで入力が改行されることを確認。IME・モバイルbeforeinputは単体テストで検証し、実機のソフトキーボードは未確認。検証サーバー停止・一時画面サイズ解除済み。Luna設定と保存形式は変更していない。

2026-10-19: アップ時に絵が静止して見えるという指摘を受け、`data-conversation=near` の犬の絵へ呼吸（3.2秒）と緩やかな傾き（11.4秒）のCSSアニメーションを追加。足元を支点に内側のdog-artだけを変形し、歩行座標・カメラ拡大・吹き出しのアンカーは動かさない。`syncVisualMotion` が手動停止・端末の動きを減らす設定・非表示状態をdata-motion-pausedへ反映し、アップ中にも尊重する。Cloud Build `e9f328a3-81f4-46c4-afc7-13aaee54326f`、イメージ `sha256:7c7f22ace54d920cea27e220d54178dbaa71b8f53feaa9b72ee0abed58804e98`。Node 78件成功、変更4ファイルの公開一致、Terraformはイメージ1件のみ更新・適用後plan差分なし。オフラインUIでアップ中の2つのanimationName・running状態・時間経過によるtransformの変化と、手動停止時のpausedを確認。検証サーバー停止・一時画面サイズ解除済み。既存画像・Luna設定・保存形式は変更していない。


2026-10-19: アップ時にまばたき・口の開閉を追加して公開。内蔵image_genで承認済みポメラニアンから3成長段階×4表情（口閉じ・小さく開く・開く・まばたき）の透過画像 `dist/assets/komugi-pomeranian-talk-v1.png` を作成。生成指示は `design/komugi-talk-v1.prompt.txt`。`dist/companion-face.mjs` が返事・ページ切替時に文字数に応じて1.8〜7秒だけ口を動かし、アップ中は不定期に110msのまばたきを入れる。返信待ちでは口を閉じ、体は基準コマを固定して顔の上60%だけ切り替える。手動停止・非表示・動きを減らす設定中はタイマーと表情を止める。画像の読み込み失敗時は従来画像へ戻る。Cloud Build `d35e20f2-22c9-47b0-9306-68fa0d684621`、イメージ `sha256:5889258f88ffa95a7eae0d5baca1bab4b29ba007663380aae51188a27b9803dc`。Node 82件成功、変更5静的ファイルの公開一致、Terraformはイメージ1件のみ更新・適用後plan差分なし。外部通信のないオフラインUIで口のコマ切替・表示・手動停止時の表情0と呼吸pausedを確認。まばたきの時間と口の終了・再開は決定的なタイマーテストで検証。検証サーバー停止・一時画面サイズ解除済み。本番の会話送信や記録変更は行わず、Luna設定・保存形式は変更していない。


## 認証とFirestoreを準備する

追加基盤は2026年10月19日に実GCPへ準備を進めた。実施結果は末尾の運用記録を参照。以下は新規環境・既存取り込み時の手順。認証・クラウド保存は実装済み。`server/account-maintenance.mjs` の削除workerは未実装なので、削除maintenanceのフラグは無効のままにする。Terraformのフラグは対応コードの代わりにはならない。

1. 対象プロジェクトを `kotokoto-biyori` と明示し、Firebase追加状態・専用Web登録・DB名/location/type・既存Rulesを読み取りで確認する。他用途のDBへこの構成を適用しない。
2. foundationの実際のtfvarsに `enable_account_infrastructure = true` を設定し、plan確認後に適用する。必要APIと専用の削除/Scheduler SAだけが追加対象となる。既定falseのままなら従来の基盤構成を維持する。
3. auth/dataの `backend.tfbackend.example` をGit対象外の `backend.tfbackend` に、`terraform.tfvars.example` をGit対象外の `terraform.tfvars` にコピーして値を設定する。既存のstateバケットを使い、prefixは必ず `kotokoto/auth` / `kotokoto/data` に分ける。
4. 新rootをそれぞれ `terraform init -backend-config=backend.tfbackend` で初期化する。実リソースがある場合は以下の形式で先にimportし、同じ物をcreateしない。DBの現状のlocation・concurrency_mode・App Engine連携を設定へ反映する。既定DBは `database_id = "(default)"` とし、別用途と共用なら採用しない。
5. authのplanを確認する。Google Beta provider 8.7.0でFirebaseとWeb登録を管理する。`manage_auth_config` は既定false。既存の認証形態と料金への影響を確認してconfigをimportできる場合だけtrueにし、`existing_auth_config_confirmed = true` と既存許可ドメイン全体を指定する。GoogleのIDP・OAuth秘密値はこのrootで管理しない。
6. アプリ専用DBであることを確認して `dedicated_database_confirmed = true` とし、dataのplanを確認する。Native/Standard DB・削除保護・PITR・対象DBの全拒否Rules・限定IAM・削除管理GCSが対象。既存の置換や削除が出る場合は適用せず設定を合わせる。PITRや名前付きDB等の費用も確認する。
7. auth/dataを適用し、再planで差分なしを確認する。Googleログインの有効化・同意画面・リダイレクト設定は、秘密値をstateへ入れないコンソール手順で行う。
8. 認証・保存のアプリ実装とテストが完成したら、auth/dataの公開outputと確認済みFirebase Web公開用APIキーでappの `account_config` を埋め、認証対応イメージのダイジェストと `account_mode = "required"` / `account_backend_ready = true` を同じリリースで指定する。
9. 後続の削除Jobコードを検証し、dataの削除権限も揃った状態でだけ `account_maintenance_ready = true` と `enable_account_maintenance = true` にする。Jobは専用SA・512MiB・並列1、Schedulerは10分ごとにOAuthでJobを起動する。workerへOpenAIキーを渡さない。退会UIの公開は削除の実検証後に行う。

importは対象rootの中で、確認した実IDに置き換えて行う。以下は形式の例であり、そのまま実行しない。

```sh
# auth/ 内
terraform import google_firebase_project.app projects/PROJECT_ID
terraform import google_firebase_web_app.app projects/PROJECT_ID/webApps/WEB_APP_ID
# 任意の既存認証共通設定を管理する場合だけ
terraform import 'google_identity_platform_config.app[0]' projects/PROJECT_ID/config

# data/ 内。既存DBとRules releaseがある場合だけ
terraform import google_firestore_database.app projects/PROJECT_ID/databases/DATABASE_ID
terraform import google_firebaserules_release.app projects/PROJECT_ID/releases/cloud.firestore/DATABASE_ID
# 既定DBのRules releaseの場合は末尾を /releases/cloud.firestore にする。
```

既存RulesのruleSetは取得したソースを別途退避し、全拒否化は専用DBの変更として確認する。dataのRuleSetは新しいソースとして作り、releaseは既存があればimportして更新する。IDPプロバイダーやOAuthクライアント秘密値をimportしない。

初期設定は `account_mode = "legacy"`、`account_config = null`、`account_backend_ready = false`、`enable_account_maintenance = false`。この組み合わせでは既存サービスへ認証環境変数やJobを追加しない。requiredへの切替時にはAPIの本人確認をアプリ側で実装し、旧無認証版へ戻すロールバックを避ける。

削除管理用GCSは30日lifecycle・versioning無効・soft delete無効。本文を含まない削除印だけを置く。復旧の際はDBとは別に保持した印を再適用してから利用を再開する。TTLは `importChunks.expireAt` と `usage.expireAt` だけに設定し、既存履歴や処理済み操作IDをTTLで消さない。アプリ実装側も同じフィールド名・collection IDを使う。

ローカルにproviderが取得済みなら、ネットワークを使わず検証に再利用できる。

```sh
KOTOKOTO_TERRAFORM_BIN=/absolute/path/to/terraform \
KOTOKOTO_TERRAFORM_PLUGIN_DIR=/absolute/path/to/provider-mirror \
node scripts/check-terraform.mjs
```

2026-10-19: 認証・保存基盤のTerraformを実装。5rootのfmt・validate・モック35件（bootstrap 2、foundation 3、auth 5、data 7、app 18）、既存Nodeテスト82件が成功。検証用は本番tfvars/backend/stateを除外した一時構成と全providerのモックを使用。GCPのplan/import/apply、ログイン設定、記録の移行、デプロイは実施していない。


Firebase管理APIは、ADCだけではクォータ先未設定の403になる場合がある。auth/dataのproviderは `billing_project = var.project_id` と `user_project_override = true` を明示し、APIのクォータ先をこのプロジェクトに限定する。別プロジェクトを指すgcloudの既定設定やグローバルADC設定は変更しない。


2026-10-19: ユーザーの操作依頼によりkotokoto-biyoriへ認証・保存の基盤を適用。事前確認でFirebase管理APIは404、Firestore DB一覧は空だったため、新規専用リソースを作成した。foundationはAPI6件・専用SA2件、authは既存GCPへのFirebase追加とWeb登録2件、dataはNative/Standardの東京DB `kotokoto-wellness`・PITR・削除保護・Rules・索引/TTL・限定IAM・削除管理GCSの16件を作成。全て追加のみで、既存の置換・削除はない。Web app IDは `1:111998805939:web:8641d7d0fee71c88e34dc6`。auth/dataのproviderへbilling_projectとuser_project_overrideを明示し、Firebase APIのクォータ先未設定403を解消した。3rootの適用後planは差分なし。モック35件も再成功。実DBの削除保護/PITR/東京リージョンを読み戻し、架空パスへの認証なしアクセスはHTTP403を確認した。

同日、Firebase Authenticationの初期設定をコンソールで実施。Googleログインの保存は認証変更のため直前に本人の承認を取得し、「有効にして進めて」の回答後に有効化した。Googleだけが有効で、アプリの `kotokoto-biyori-oidgpmqhiq-an.a.run.app` を承認済みドメインへ追加。既存のlocalhost/firebaseapp.com/web.appは残した。Identity Platformへのアップグレードは行わず、manage_auth_configはfalseのまま。IDPのOAuth秘密値は読み取らずTerraformへ入れていない。Cloud Runのイメージは `sha256:5889258f88ffa95a7eae0d5baca1bab4b29ba007663380aae51188a27b9803dc` のまま、アプリのaccount_modeは未切替で端末内保存を継続。端末の記録・会話は未移行。削除権限/Job/Schedulerも未有効。次はFirebase SDK・本人確認API・保存API・認証ヘルパーの同一オリジン配信を実装してアプリに接続する。カスタムauthDomainを使う際のGoogle OAuthリダイレクトURI確認と、旧同意画面の外部/テスト状態の確認も残る。Googleプロバイダー有効化だけでスマホのログイン動作まで確認済みとは扱わない。

2026-10-19: 認証とFirestore保存のアプリ接続を実装。通常の認証API用の `account_backend_ready` と、未実装の削除worker用の `account_maintenance_ready` を分離。削除maintenanceは無効のまま維持する。詳細と初回実装の制限は `docs/account-and-cloud-storage-design.md` の初回実装節を参照。

2026-10-19 ログイン/保存リリース: Cloud Build `ca95b92d-7dac-4f15-b13e-7e5f51c76408`、イメージ `sha256:a3ed91be696b3c13282e53ef62309a6f7e5971c69e0ec8482b8e65a20b338113`。ACCOUNT_MODE=required、Firestore=kotokoto-wellness、authDomain=既存Cloud Runホスト。Google OAuthのJavaScript originと /__/auth/handler の追加は本人の「保存して進めて」承認後に保存。Google基本プロフィール/メール/openidのみで、テスト状態の例外範囲を使用。実ブラウザのGoogleログインと、runtime SAによる本人確認/空アカウントの読取に成功し、初回取り込み選択画面を確認。本人の記録は取り込まず、新規開始も押していない。架空UIDの実Firestore検証で初期化・記録更新・会話保存/削除・取り込み再送を確認し検証データを削除。Node 95件、Terraformモック35件成功。Cloud Runは1件の更新のみ、削除Job等は未有効。公開HTML/API設定/認証ヘルパーの200、未認証個人APIとAI APIの401、変更した静的7ファイルの一致を確認。内部の /healthz はstartup/liveness probeで使い、公開GFE経由の404をアプリ障害と混同しない。Lunaへの実際の健康文テストは行っていない。最終版は通信復帰時に同じrevisionでも閲覧専用状態を解除し、同じユーザーの再ログイン後も復帰する。

最終反映後のapp planは差分なし。公開7ファイルの一致と未認証APIの401も再確認済み。ローカルのオフライン検証サーバーを停止し、検証タブを閉じ、画面サイズを復元した。

2026-10-19 名前設定リリース: Cloud Build 0bdb312b-dab8-4472-905f-f54639e9d87e、イメージ sha256:3717f17ef19a0793bde1c39e1afa6736089b000c057de1503ed565452bd83bae。TerraformでCloud Runのイメージ1件だけ更新、適用後plan差分なし。Node 98件成功。架空アカウントで初回の2名登録・後からの変更・再読み込みを確認。公開8ファイルの一致と未認証APIの401を確認。本番のログイン済みアカウントで名前設定画面の表示のみ確認し、本人の名前や記録は変更していない。実際のLunaへの送信は行わず、サーバー保存済み犬名が文脈に渡ることを固定応答のテストで確認。検証サーバー/タブを終了、表示サイズも復元。

2026-10-19: 初期設定の呼び名欄のプレースホルダーを、個人名の例から「呼ばれたい名前を入力」へ変更。Cloud Build 15190d4f-2a3b-4853-be9d-a6a21372ed84、イメージ sha256:c9c195ca797a464aa0328bccfb98854f90f63b2807f47287ec0f6527b5201866。Cloud Runのイメージ1件のみ更新。公開HTML一致と個人名の例の削除を確認。ブラウザの入力や保存データを変更せず新規確認タブだけで表示を検証し、検証タブを終了、表示サイズを復元。

2026-10-19 日次記憶リリース: Cloud Build 61e112c6-f093-4216-8200-b502fb7b9e8a、イメージ sha256:d52e6e7ded9cd70da7964a201d550f06998f23c62c7d12301fcfbb37ea0548c2。Cloud Runのイメージ1件を更新。dataへmemory.summaryの索引除外1件を追加。Node 105件、Terraformモック35件成功。架空UIDの実Firestoreで記憶の保存・再読込・処理済み対話の除外を確認し、検証データを削除。実際のLunaは架空の色/遊びの話を1回だけ要約し、completedとoutput_tokens上限を確認。実ユーザーの名前/会話/健康情報はテスト送信していない。app適用後planは差分なし、公開8ファイル一致/未認証API401を確認。本番UIの設定から記憶欄を確認したが、実ユーザーの対話の送信やリセットは操作していない。検証タブ/サーバーを終了、画面サイズも復元した。
Firestoreのmemory.summary索引除外は5分52秒で作成完了。dataは1件追加のみで、既存の記録・DB設定・権限の変更はない。


2026-10-19 キャッシュ最適化版を公開。Cloud Build `d48999d8-3aa0-403c-99b5-c56e6726c8cf`、イメージ `sha256:489e864668375990c234c67dfcef98e22b3e14a25990b5c136c8d35324ca0681`。確認済みplanを適用しCloud Runイメージ1件のみ更新。Node106件/モック35件、公開応答/認証必須/静的8ファイルの一致に成功。架空の非健康会話を同じ生成コードから実APIへ送り、2回目の入力3470中3409トークン再利用を確認。最終の差分なしplanは自動承認審査タイムアウトのため未確認（適用と公開確認は成功）。

2026-10-19 こむぎの実務的な発言を抑える口調修正を公開。計算・保存の説明を促していた指示を削除し、喜びと具体的な褒め言葉を優先。推定値/根拠の構造化と不足情報の自然な質問は維持。PR #2へafd85ecで反映し、後続PR #3へ通常merge済み。Node103件とCloud Build内テスト成功。Cloud Build 624ae3bc-0a7d-403b-9b39-9e9e5870f6fc / sha256:bd1c1cb369a7f24fc67c9a9deaefcc0725961893bdbe1efc62dfdf842190b7d0 をTerraformでイメージ1件のみ適用。公開応答・認証ヘルパー・未認証API401・静的8ファイル一致、適用後app plan差分なしを確認。実ユーザーの健康情報をAPIテスト送信していない。
