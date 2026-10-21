# 認証とFirestoreのTerraform設計

2026年10月19日。[ログインとクラウド保存の設計](account-and-cloud-storage-design.md)を、既存Terraformへ追加するための実装設計。設計に基づくTerraformの実装とモック検証まで完了した。Firebase追加・Web登録と新規FirestoreのDB/Rules/IAMをGCPへ適用した。既存個人データの取得・移行は行っていない。既存Firestoreのプロジェクト・DB名・リージョンは未確認だが、確認前でもリソースの責任分担と実装仕様は決められる。

対象プロジェクトの既定方針は既存アプリと同じ `kotokoto-biyori`。ユーザーがFirestoreを使ったことがあることと、このプロジェクトに対象DBがあることは区別する。他プロジェクトのDBを自動で取り込んだり、アプリの保存先に採用したりしない。

実装状況：2026年10月19日にauth/dataのHCLと既存rootの接続を追加し、ローカル検証を完了した。2026年10月19日にFirebase追加・Web登録とFirestoreのDB/Rules/IAMを適用した。アプリの認証・保存接続は未実施。実行手順は [Terraform運用手順](../infra/terraform/README.md#認証とfirestoreを準備する) を参照。Firebase登録は実際の8.7.0スキーマに合わせGoogle Beta providerを使用する。

## stateと管理範囲

既存のbootstrap・foundation・appを保ち、authとdataの2つのroot構成を追加する。アプリの画像更新とデータベースの変更を別planにできるようにする。stateバケットは既存のものを使い、新しいバケットを作り直さない。

| root | state prefix | 管理するもの |
| --- | --- | --- |
| bootstrap | `kotokoto/bootstrap` | 既存のstate用GCSとstateアクセス権 |
| foundation | `kotokoto/foundation` | 既存基盤、追加APIの有効化、通常用・削除処理用・Scheduler用SAの作成 |
| auth | `kotokoto/auth` | 既存GCPへのFirebase追加、アプリ専用Web登録、条件を満たす場合の認証共通設定 |
| data | `kotokoto/data` | Firestore、索引、TTL、Rules、DB用IAM、復旧後の削除再適用に使うGCS |
| app | `kotokoto/app` | 既存Cloud Runと環境変数、削除用Cloud Run Job、Scheduler、Job呼出権限 |

削除Jobは実行イメージの更新に追従するためappに置く。前の全体設計でdataに含めていた削除Jobの配置は、本設計でappへ具体化する。dataはコードやイメージに依存せず先に用意できる。

root間で同じリソースを二重管理しない。APIはfoundationだけ、SA作成もfoundationだけ、DB権限はdataだけが持つ。IAMは原則 `*_iam_member` で追加し、プロジェクト全体の `iam_policy` や既存メンバーを消し得る一括bindingは使わない。

他rootのstate全体を読む `terraform_remote_state` は導入しない。rootの公開outputから必要な非秘密値だけを変数として渡し、同じproject_id・DB名・SAであることを入力検証する。値の受け渡しはリリース手順または小さなマニフェスト生成スクリプトが担当する。

## 実装時のファイル

```text
infra/terraform/
  foundation/                    追加APIとSA定義を変更
  auth/
    versions.tf                  TerraformとproviderとGCS backend
    variables.tf
    main.tf                      FirebaseとWebアプリ
    auth-config.tf               認証共通設定の任意管理
    outputs.tf
    terraform.tfvars.example
    backend.tfbackend.example
    tests/auth.tftest.hcl
  data/
    versions.tf
    variables.tf
    main.tf                      DBと保護
    iam.tf
    rules.tf
    firestore.rules
    indexes.tf
    ttl.tf
    deletion-ledger.tf            復旧対象外の削除管理記録
    outputs.tf
    terraform.tfvars.example
    backend.tfbackend.example
    tests/data.tftest.hcl
  app/                           環境変数と任意Jobを追加
```

Terraformは現行と同じ `>= 1.13.5, < 2.0.0`。Google providerは既存制約 `~> 8.7` と整合させ、初回実装では現在lockされている8.7.0で検証・lockする。不要なproviderアップグレードや既存lock変更を同時に行わない。以下のresource名・引数はGoogle provider 8.7.0の公式資料を基準にしている。

## foundationの追加

追加APIは `firebase.googleapis.com`、`identitytoolkit.googleapis.com`、`securetoken.googleapis.com`、`firestore.googleapis.com`、`firebaserules.googleapis.com`、`cloudscheduler.googleapis.com`。既存のrun・iam・storage等と合わせて依存関係を確認する。全て `google_project_service` で管理し、既存と同じ `disable_on_destroy = false` を守る。既存プロジェクト・課金アカウント・App Engineを新規作成しない。

通常用の `${app_name}-run` とビルド用SAは再作成しない。削除Job用 `${app_name}-delete` とScheduler呼出用 `${app_name}-schedule` を追加する。SAキーは発行しない。利用者のGoogleアカウントをTerraformのSAと混同しない。

## authの管理と手動設定

| 対象 | 方針 |
| --- | --- |
| Firebase追加 | `google_firebase_project`。追加済みならimport、未追加なら既存GCPへ追加。GCPプロジェクト自体は作らない |
| Webアプリ | `google_firebase_web_app`。既存のこつこつ日和専用登録があればimport。無関係なWeb登録を再利用しない |
| 許可ドメイン等 | `google_identity_platform_config` は任意管理。対応する既存設定を確認・importできる場合に限定し、既定では管理しない |
| Googleログインの有効化 | Firebase/Googleコンソール側。クライアント秘密値をTerraformへ取り込まない |
| Googleの同意画面・公開状態・リダイレクトURI | 初期設定手順として管理。既存の外部・テスト設定をそのまま一般公開済みとは扱わない |
| Google OAuthクライアント秘密値 | Terraformの入力・data source・output・stateへ入れない |

`google_identity_platform_default_supported_idp_config` は8.7.0で `client_secret` が必須なので、この案では使わない。`sensitive = true` やSecret Managerのdata sourceを使うだけではstateへの秘密値保存を防げない。認証プロバイダー全体のimportも秘密値を取得し得るため対象外にする。[Googleプロバイダー設定の公式定義](https://raw.githubusercontent.com/hashicorp/terraform-provider-google/v8.7.0/website/docs/r/identity_platform_default_supported_idp_config.html.markdown)

`manage_auth_config = false` を初期値にし、Firebase AuthenticationからIdentity PlatformへのアップグレードをTerraformの都合で自動実行しない。認証共通設定をコード管理する場合は、既存のサービス形態と料金への影響を確認してimport専用手順を用意する。未確認のプロジェクトでこのフラグをtrueにして新規初期化しない。管理対象にした場合も、既存許可ドメインを調べずに狭い固定リストで消さない。[認証共通設定の公式定義](https://raw.githubusercontent.com/hashicorp/terraform-provider-google/v8.7.0/website/docs/r/identity_platform_config.html.markdown)

必要な許可ホストは既存Cloud RunホストとFirebaseの認証ホスト。既存の正当なホストを確認して保持する。`localhost` は本番で自動追加せず、開発はエミュレーターを基本とする。公開authDomainはCloud Runホストにし、アプリ実装が `/__/auth/` の公式ヘルパーを同一オリジンで透過プロキシする。認証ヘルパーをTerraformで静的ファイル化しない。

Web SDK設定のprojectId・appId・authDomain・公開用APIキーはサーバーが配る公開設定として扱う。公開用APIキーはOpenAIキーやOAuth秘密値とは別であり、本人確認・DB認可の代わりにはならない。値を一括したstateダンプでアプリへ渡さず、確認した公開項目だけを設定する。

## dataのDB定義

対象DBの新規候補は `kotokoto-wellness`、リージョンは `asia-northeast1`。既存専用DBを採用する場合は、その実名・リージョンを入力してimportする。既存DBを東京へ合わせるための再作成は行わない。

```hcl
# 実装時の定義イメージ。まだ適用するファイルではない。
resource "google_firestore_database" "app" {
  project                          = var.project_id
  name                             = var.database_id
  location_id                      = var.database_location
  type                             = "FIRESTORE_NATIVE"
  database_edition                 = "STANDARD"
  concurrency_mode                 = "PESSIMISTIC"
  app_engine_integration_mode       = "DISABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
  delete_protection_state          = "DELETE_PROTECTION_ENABLED"
  deletion_policy                  = "PREVENT"

  lifecycle {
    prevent_destroy = true
  }
}
```

`delete_protection_state` はGCP側の保護、`deletion_policy` はprovider側の削除動作、`prevent_destroy` はTerraformの置換防止として重ねる。運用者の全ての操作を永久に防げるものではない。名前・リージョンの変更をplanで検出したら止める。復旧時は別名DBへ復元して照合し、アプリの参照先を明示して切り替える。[DB定義と削除ポリシー](https://raw.githubusercontent.com/hashicorp/terraform-provider-google/v8.7.0/website/docs/r/firestore_database.html.markdown)

既存DBのimport直後は、Native/Datastoreモード・edition・同時実行制御・App Engine連携などの現状を正確に表す。上の新規DB向け設定をそのまま押し付けない。別用途と共用するDBへ、全拒否Rulesや索引変更を適用しない。

Rulesは `google_firebaserules_ruleset` と `google_firebaserules_release` で管理し、読み書きを全拒否にする。release名は名前付きDBなら `cloud.firestore/${database_id}`、既定DBなら `cloud.firestore`。作っただけのrulesetを未反映のままにしない。既存releaseは取り込み、別DBのreleaseを上書きしない。[名前付きDBへのRulesリリース](https://raw.githubusercontent.com/hashicorp/terraform-provider-google/v8.7.0/website/docs/r/firebaserules_release.html.markdown)

アプリAPIで本人を分離するため、ブラウザ向けRulesをUID許可にする必要はない。Firestore Admin SDKのアクセスはIAMで管理し、全拒否Rulesがサーバー側のユーザー分離を代行するとは扱わない。

## 索引とTTL

`google_firestore_index` で複合索引、`google_firestore_field` で単一項目索引の除外とTTLを管理する。索引の最終形は実際のAPIクエリを確定してから固定する。

初期クエリはデータセット配下のactivitiesを実施日・作成時刻で取得、dailyReportsを日付順、messagesを時刻順、削除Jobを状態・次回実行時刻で取得する。単一項目索引で足りるものは複合索引を作らず、フィルターと順序を併用するクエリだけ追加する。不要なcollection group全体検索は使わない。

会話本文・行動のevidence/detail・推定根拠・訂正履歴・操作応答の大きい項目は索引から除外する。collection group単位の設定が他用途に及ばない専用DBで行う。

TTL対象は未確定の移行ステージング（初期案7日）と古い利用枠（初期案30日）。処理済みrequestId、通常の体重・行動・会話にはTTLを設定しない。TTL削除は即時ではなく、親のTTLでサブコレクションが全削除されるわけでもない。移行データの各チャンクにexpireAtを持たせる。利用枠の期限判定や削除期限の確定は、TTLの実行時刻に依存させない。

## IAMの分担

| 実行主体 | 付ける権限と範囲 |
| --- | --- |
| 通常のCloud Run SA | `roles/datastore.user` を対象DBに限定するIAM条件で付与。失効確認に必要なFirebase Authの読取権限を別途付与 |
| 削除Job SA | 対象DBのデータ操作、認証ユーザーの削除・トークン失効、削除管理GCSの限定操作 |
| Scheduler SA | 対象の削除Jobを実行する権限だけ。DB・Auth・OpenAIキーは参照不可 |
| ビルドSA | 既存のビルド権限だけ。個人記録の読取権限を付けない |

DB限定の条件は `resource.name == "projects/${project_id}/databases/${database_id}"` を基本にし、別DBへのアクセス拒否を実APIで検証する。既存の無条件の広い権限や継承権限があれば、条件を付け足すだけで限定できたとは主張しない。ユーザー同士の分離はAPIのUID検証で行う。[公式のDB単位の条件付きIAM](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions)

通常SAの失効確認は `firebaseauth.users.get` を含む読取用の最小権限を使う。削除SAは `firebaseauth.users.get/update/delete` を必要に応じたカスタムロールで定義し、Admin SDKで必要な呼出しができることを検証する。通常SAへFirebase AdminやProject Ownerを付けない。

## 削除Jobと復旧用の削除管理記録

dataに専用GCS `${project_id}-${app_name}-deletions` を作る案とする。uniform bucket-level accessとpublic access preventionを有効にし、force_destroyはfalse、prevent_destroyを付ける。個人の記録本文は置かず、UID照合用の印と削除時刻だけを保持する。データベースの復元で巻き戻さず、復元完了前にこの印を再適用する。

削除JobはDB消去の前に印を書き、削除を途中から再開できる状態にする。印の保持は初期案30日で、GCSのlifecycle削除を設定する。versioningとsoft deleteにより意図せず保持が延びないよう、初期案ではいずれも無効にする。期限満了後の物理削除の時刻を厳密に保証するとは表示しない。通常SAへ削除権限を渡さず、復旧作業者の読取権限は別に管理する。

appに `google_cloud_run_v2_job` と `google_cloud_scheduler_job` を追加する。削除Jobは対応コードを含むダイジェスト固定イメージ、削除SA、並列度1、期限付きDBリース、1回あたりの件数・実行時間上限を持つ。Schedulerは初期案10分ごと、タイムゾーンAsia/Tokyo。Cloud Run JobsのGoogle APIへOAuthアクセストークンで実行要求を送り、公開HTTPやIAPの設定は付けない。[Jobの定期実行](https://cloud.google.com/run/docs/execute/jobs-on-schedule)

`enable_account_maintenance = false` を既定とし、削除コードが入ったイメージと権限が整うまでJob/Schedulerを作らない。退会UIは削除基盤が揃ってから公開する。リトライや重複起動でも既に削除済みのデータを再生成しないことはアプリ側で検証する。

## rootの入力と出力

| root | 主な入力 | 秘密を含まない出力 |
| --- | --- | --- |
| foundation | project_id、region、app_name | 既存SA、追加の削除SA・Scheduler SA |
| auth | project_id、app_name、auth_domain、既存Web登録の採用方針、manage_auth_config=false | Firebase project ID、Web app ID、公開authDomain |
| data | project_id、database_id、database_location、runtime/delete SA、削除管理バケット名 | DB ID・フルパス・リージョン、削除管理バケット名 |
| app | 既存入力、Firestore DB ID、公開Web設定、auth enforcement、maintenance flag | 既存URL、Job名、同期構成の識別情報 |

regionはCloud Runの東京と、既存Firestoreのlocationを区別する。database_idは既定DBも扱えるよう検証し、project_idやSAが他プロジェクトを指していれば拒否する。既存stateのtfvarsやbackend設定を例示ファイルへコピーしない。

アプリへ渡す環境変数案は `GOOGLE_CLOUD_PROJECT`、`FIRESTORE_DATABASE_ID`、`FIREBASE_WEB_APP_ID`、`FIREBASE_AUTH_DOMAIN`、公開SDK用設定、`ACCOUNT_MODE`。`ACCOUNT_MODE` は `legacy` / `required` の明示選択とし、新旧アプリの既定値や環境変数欠落で認証要件が勝手に変わらないようにする。requiredでは設定不足時に起動を失敗させ、無認証へのフォールバックをしない。

基盤準備中は現行イメージ・公開URL・Luna接続を維持する。認証対応イメージが完成したリリースで、個人データAPIと実AI APIの認証必須化を同時に切り替える。切替後は旧無認証イメージへ単純にロールバックしない。問題時は認証を維持した前版か、個人APIと実AIを停止した版へ戻す。

## 既存リソースの採用手順

1. `kotokoto-biyori` のFirebase追加状態、Web登録、Auth設定の有無、DB一覧と各location/type、現在のRules、IAMを読み取りで確認する。リソースの設定だけを調べ、個人の記録本文は読まない。
2. DBがない場合は名前付きの新規DB。こつこつ日和専用DBがある場合はそのDBを採用。他用途のDBだけなら専用DBを追加する。他プロジェクトのDBは別途判断まで対象外。
3. 既存リソースに合わせた設定を書き、import blockで既存IDを指定する。FirebaseとWeb登録、DB、既存Rules releaseをそれぞれ対応するstateだけへ取り込む。
4. importを含むplanを確認し、既存リソースの置換・削除・意図しない認証変更がない状態にする。取り込みと新機能変更は別planで確認する。
5. 既存設定の採用後に削除保護・PITR・専用Rules・最小権限を差分として追加する。管理外のリソースを「差分を消すため」に削除しない。

DBのimport例は `projects/kotokoto-biyori/databases/確認したDB名`、Firebaseは `projects/kotokoto-biyori`。Web登録は確認したapp IDを使う。既存があるかをresourceのcreate失敗で判定する方式は使わない。

## 適用順序と検証

ローカルでの設計・実装・fmt・validate・モックテストは、Firestoreへのログイン前でも進められる。本物の初回plan/import/apply時にだけ、対象プロジェクトとADC権限を確認する。

適用順序は `既存確認 → foundation → auth → data → OAuth等の初期設定確認 → 認証対応アプリのビルド → app`。appの認証必須化は基盤完成後に行う。削除Jobの有効化は対応イメージができた時点で追加する。既存のCloud Build→ダイジェスト→Terraform手順を継続し、gcloudとの二重管理をしない。

`scripts/check-terraform.mjs` の検証対象へauth/dataを追加し、各rootにproviderモックテストを用意する。既存rootのinit先やbackendを書き換えて検証しない。モックで確認するのは、明示project・DB名、削除保護3種、PITR、Rules releaseのDB対応、SAとIAM条件、秘密値を受け付けない入力、maintenance既定off、IAMの越境拒否、認証設定の既定非管理、誤った組み合わせの失敗。

モックはGCP上の権限の実効性、OAuthのログイン、Rulesの実反映、PITR復旧を保証しない。クラウド準備後に、別UIDのアクセス拒否・別DBへのSAアクセス拒否・認証設定とスマホのログイン・再送と同時訂正・削除と復旧を、架空データだけで検証する。完了後はplan差分なしを確認する。

この段階でユーザーから必要になるのは、実際のDBを採用する時のプロジェクトID・DB名・リージョンの確認だけ。パスワード・APIキー・OAuth秘密値をチャットへ貼る必要はない。
