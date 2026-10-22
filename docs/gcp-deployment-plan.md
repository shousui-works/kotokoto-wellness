# こつこつ日和のGCPデプロイ計画

2026年10月18日の初期計画。画面と機能をCloud Runに載せて確認し、既存の記録を引き継いでから普段使う公開先を移す。Lunaとの会話・クエスト・日報の実装は、移設後に既存の合意仕様を基準に進める。

2026年10月18日に、ユーザーが選択した専用プロジェクト `kotokoto-biyori` の課金有効状態を確認し、Terraformでbootstrap・foundation・appを適用した。初期確認後、ユーザーの「自分だけ使えるじゃなくていい」という方針変更に合わせ、ログインなしで開ける公開Cloud Runに変更した。既存の記録の引き継ぎは残っている。

Terraformのbootstrap・foundation・app構成、Cloud Run用の配信サーバー、Dockerfile、Cloud Buildのビルド手順を実装した。適用結果と今後の更新操作は[Terraformの運用手順](../infra/terraform/README.md)を参照する。

## 現在の構成（2026年10月21日・実装と過去の適用記録に基づく）

- 公開先は https://kotokoto-biyori-oidgpmqhiq-an.a.run.app 。画面配信は公開のまま、個人APIと実AIはFirebase AuthenticationのGoogleログインを必須とする（`ACCOUNT_MODE=required`）。Cloud RunのIAPは使わない。
- 記録・プロフィール・会話はUID別の名前付きFirestore `kotokoto-wellness` に保存する。端末内の旧記録は初回ログイン後に本人が取り込みか新規開始を選び、旧Sitesの別オリジンからは自動移行しない。
- Terraformはbootstrap・foundation・auth・data・appの5構成。Lunaとの会話・クエスト・日報、Googleログイン、クラウド保存は実装済み。Google OAuthの戻り先も設定済みで、実ブラウザのログイン確認は運用手順に記録している。
- 旧Sitesと `.openai/hosting.json` のIDは保持する。この文書の確認だけで新たなGCP適用や移行を実行したことにはしない。

以下は初回移設時の記録と構成案。現在の認証・保存方式は上記および[ログインとクラウド保存の設計](account-and-cloud-storage-design.md)、[運用手順](../infra/terraform/README.md)を参照する。

## 初回移設時点の記録（2026年10月18日）

| 項目 | 確認した内容 |
| --- | --- |
| コード管理 | GitHub |
| 普段使う公開先 | ChatGPT Sites。切り替え前のため稼働を継続 |
| 現在のURL | https://kotokoto-biyori.loyal-wave-1919.chatgpt.site |
| アプリ | ビルド不要の `dist/` 内のHTML・CSS・JavaScriptと画像 |
| 記録 | ブラウザのlocalStorage `kotokoto-wellness-v1` |
| バックアップ | JSON書き出しあり。読み込み画面は未実装 |
| GCP操作環境 | gcloudがインストール済み。ログイン済みアカウントでプロジェクト一覧を取得できた |
| Terraform | 1.13.5で3構成を適用し、適用後のplanはすべて差分なし |
| デプロイ先 | 専用プロジェクト `kotokoto-biyori`、東京 `asia-northeast1` |
| Cloud Run | https://kotokoto-biyori-oidgpmqhiq-an.a.run.app 、ログインなしで公開 |
| 配信の確認 | Cloud Build成功。認証・Cookieなしで画面と静的16ファイルの内容一致、ブラウザで部屋の表示を確認 |
| Googleログイン | 初回公開時は未使用。IAPと専用閲覧者の権限を削除した。その後Firebase認証を導入 |

現在のgcloud設定が参照するプロジェクトを、このアプリのデプロイ先として自動採用しない。以後の操作では選択したプロジェクトIDを明示し、他アプリの設定を切り替えない。

## 最初の構成案

| 項目 | 初期案 |
| --- | --- |
| GCPプロジェクト | こつこつ日和専用の `kotokoto-biyori` |
| リージョン | 東京 `asia-northeast1` |
| アプリ配信 | Cloud Runの1サービスで `dist/` を配信する |
| 配信サーバー | Node.jsの小さなHTTPサーバーを追加し、後から同じサービスにAPIを足せる構成 |
| デプロイ方法 | Cloud BuildでDockerfileからイメージを作り、TerraformでCloud Runに反映する |
| 初期の規模 | リクエストベース課金、第1世代・CPU 1・256MiB、最小0インスタンス、最大1インスタンス |
| 閲覧範囲 | ログインなしで誰でもアプリを開ける。個人の記録は各ブラウザ内に保存 |
| スマホでの閲覧 | Cloud RunのURLをそのまま開く |
| 現段階の保存先 | 既存のlocalStorageを維持する |

Cloud Runでは、HTTPサーバーを環境変数 `PORT` のポートで `0.0.0.0` に待ち受けさせる。公開するファイルは `dist/` に限定し、プロジェクト全体や秘密ファイルを配信しない。[コンテナ要件](https://docs.cloud.google.com/run/docs/container-contract)

Cloud BuildがDockerfileからコンテナを作り、Artifact Registryに保存する。完成したイメージのダイジェストをTerraformに渡して、Cloud Runのリビジョンを更新する。ローカルのDockerエンジンをデプロイの必須条件にしない。[コンテナのデプロイ](https://docs.cloud.google.com/run/docs/deploying)

初回公開時は `allow_public_access = true` とし、Invoker IAMチェックを無効にした。IAPと専用閲覧者の設定は空にし、当時はOAuthを使用しなかった。現在もCloud Run配信は公開だが、アプリのGoogleログインはFirebaseとOAuthを使う。公開・IAM・IAPの切り替えはTerraformで管理する。[Cloud Runの公開設定](https://docs.cloud.google.com/run/docs/authenticating/public)

## 初期計画でのTerraformの管理範囲

Cloud Runの実行構成と、どのアプリの版を動かすかをTerraformで管理する。通常の更新では `gcloud run deploy --source` やコンソールで同じ設定を並行して変更せず、次回のTerraform適用で古い設定に戻る状態を避ける。

| 管理対象 | 方針 |
| --- | --- |
| 必要なGCP APIの有効化 | Terraformで定義する。Terraform自体が利用するAPIや権限の初期準備は別に扱う |
| Artifact Registry | イメージの保管先をTerraformで定義する |
| 実行用サービスアカウントとIAM | アプリ専用の権限をTerraformで定義する |
| Cloud Run | イメージのダイジェスト、リージョン、CPU・メモリ、スケール、環境変数、秘密情報の参照、トラフィックを管理する |
| IAPと閲覧権限 | 対応するTerraformリソースで管理する。初回OAuth設定などコンソール操作が必要な部分は手順を残す |
| Secret Manager | 秘密情報の保管先と読み取り権限をTerraformで管理する。APIキー本体の投入は別の秘密情報登録手順で行う |
| Firestore | 保存機能を実装する段階で、データベース等を管理対象に追加する |

通常のリリース手順は「テスト → Cloud Buildでビルド → Artifact Registryへ保存 → イメージのダイジェストを指定してterraform plan → 差分を確認してapply → 動作確認」とする。最初は手動で実行できる手順を整え、CIからも同じ手順を使えるようにする。ビルドをTerraformの `local-exec` に埋め込まない。

Terraformのstateは、アクセスを限定したCloud Storageバケットに置く。GCSバックエンドのロック機能を使い、バケットのオブジェクトのバージョニングを有効にする。バックエンド用バケットは初期準備で先に作り、アプリ本体の構成から分ける。state、保存したplan、`.terraform/` をGitに含めない。[GCSバックエンド](https://developer.hashicorp.com/terraform/language/backend/gcs)

APIキー本体をTerraformの変数・設定・出力に渡さず、stateやplanに残さない。TerraformではSecret Managerの保管先と参照するバージョンなどの情報を扱う。[Google CloudでのTerraformのセキュリティ指針](https://docs.cloud.google.com/docs/terraform/best-practices/security)

## 実施する順番

1. 対象のGCPプロジェクトを選ぶ。専用に新設する場合は課金アカウントの紐付け先も決める。
2. 対象プロジェクトの課金状態、有効なAPI、ビルドと実行に必要な権限を読み取り確認する。
3. 配信サーバー、Dockerfile、アップロード対象を限定する設定とTerraform構成をローカルで用意する。秘密値をGitやコンテナに含めない。
4. アプリの配信と既存のテスト、Terraformの構成を検証し、デプロイする構成を具体化する。
5. state保管先とビルドの準備を行い、選択したプロジェクトにTerraformでCloud Runサービスをデプロイする。公開範囲はユーザーの選択を反映し、現在はログイン不要で公開している。既存のSitesは稼働を続ける。
6. スマホの表示、犬の動き、記録の保存、画面の再読み込みを確認する。
7. JSONバックアップの読み込みを実装・検証し、既存の記録を新しいURLへ引き継ぐ。
8. 引き継いだ内容と育成状況を確認してから、普段使うURLをGCP側へ切り替える。

## 記録の引き継ぎ

localStorageはURLのオリジンごとに分かれるため、新しいCloud RunのURLから既存のSitesの記録を直接読むことはできない。同じスマホでも記録は自動では移らない。

既存のSitesでJSONバックアップを保存し、新しいアプリでそのファイルを読み込む方法を用意する。体重・気分・習慣・所持品・成長・なつき度を引き継ぎ、元データの形式との互換性を保つ。入力値の確認と取り込み内容のプレビューを行い、新しいURL側にすでに記録がある場合は無断で上書きしない。

移行確認が終わるまで、既存のSitesと `.openai/hosting.json` のproject_idを保持する。自動リダイレクトや旧公開先の停止はこの計画の初回デプロイに含めない。

## 移設後に追加するもの

| 機能 | 追加先 |
| --- | --- |
| Lunaとの会話とクエストの読み取り | Cloud RunのサーバーAPI |
| `OPENAI_API_KEY` の保管 | Secret Manager。Cloud Runの実行権限だけに必要な読み取りを許可 |
| ユーザーごとの記録や日報を端末間で共有 | ログイン機能とFirestore等の保存先を追加する段階で設計 |

APIキーはブラウザやlocalStorageに置かない。初回の静的なアプリ配信にはOpenAI APIキーは必要ない。キーの登録とLuna接続は、サーバーAPIを実装する段階で行う。[Cloud Runでの秘密情報の利用](https://docs.cloud.google.com/run/docs/configuring/services/secrets)

アプリの仕様は[こむぎとの会話とえらいポイントの仕様](komugi-daily-quests-spec.md)を参照する。GCPへ移すだけでクラウド保存や端末間同期が有効になるわけではなく、そのための認証・保存処理を別途実装する。

## 費用の確認

Cloud Runの実行費用に加え、ビルド、コンテナの保管、通信などの費用が発生し得る。LunaやFirestoreを追加した段階では、それぞれの利用料も別に計上する。Cloud Runだけの無料枠を理由に、全体が無料とは見積もらない。[Cloud Runの料金](https://cloud.google.com/run/pricing)

まず最小インスタンス0の小さな構成で確認し、対象プロジェクトで予算通知を設定する方針とする。最大インスタンス数は台数の制限であり、請求額の上限ではない。具体的な金額は利用人数とアクセス頻度を置いて別途試算する。

## 現在の残作業

Googleログイン、UID別クラウド保存、Lunaの会話APIと利用制限は実装済み。公開の画面配信と、認証が必要な個人API・実AIを区別して運用する。初期の「OAuthを使わない」という記録は、現在のアプリ認証を表さない。

今後は実機での継続確認、旧Sitesの別オリジンからの記録移行、予算通知などを確認する。退会workerと削除Job・Schedulerは未実装のため無効のままにする。各利用者の移行状況は推測せず、本人の確認を伴う取り込みで扱う。
