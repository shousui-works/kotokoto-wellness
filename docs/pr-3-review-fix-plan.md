# PR #3 レビュー指摘への修正計画

2026-10-21。対象は [PR #3](https://github.com/shousui-works/kotokoto-wellness/pull/3)、精査した先端は `2ec0f8e32872c98f0ea92b17b180942b2feaec2e`。

CodeRabbitの主指摘6件と軽微な提案1件を、現行コード、固定provider 8.7.0の実装、ローカルのgcloud実装と照合した。以下の計画に沿って修正・検証を完了した。結果は末尾に記載する。GCPへの適用、デプロイ、外部への再レビュー依頼、マージは対象外とする。

## 修正する内容

### 1. 認証と保存先の説明を現在の実装へそろえる

- 指摘：[Googleログイン](https://github.com/shousui-works/kotokoto-wellness/pull/3#discussion_r4331756799)、[保存先](https://github.com/shousui-works/kotokoto-wellness/pull/3#discussion_r4331756823)。ともに妥当。
- `docs/gcp-deployment-plan.md` は2026年10月18日の初期計画と現在の構成を区別する。現在の公開先、Firebase Googleログイン、UID別Firestore保存、実装済み機能と残作業を更新する。Cloud Runの公開設定とアプリAPIの認証を混同しない。
- `README.md` の保存先、プロフィール、同期の説明をそろえる。ログイン後のクラウド正本と、旧ローカル記録・legacyモードの端末内保存を区別する。未ログインの公開アプリで現在も新規記録できるような説明はしない。
- 既存記録は自動移行されないこと、本人の選択による取り込みと新規開始を記載する。移行済みかどうかという個人の利用状況を推測しない。
- 検証：`server/account-api.mjs`、`server/account-store.mjs`、`dist/account-client.mjs` と文書を照合する。文書のみの変更に新しい単体テストは追加しない。

### 2. 認証導入後の切り戻し条件を明記する

- [指摘](https://github.com/shousui-works/kotokoto-wellness/pull/3#discussion_r4331756818)。妥当で優先度が高い。
- `infra/terraform/README.md` の「以前のダイジェスト」だけでは不十分。認証を維持する互換版、または個人APIと実AIを停止した版に限定する。
- 認証導入前のイメージへ単純に戻さないことを明記する。`ACCOUNT_MODE=required` を設定しても、それを実装していない旧コードの認証を保証できない。
- 切り戻し時もTerraform経由とし、認証設定と保存形式の互換性を確認する。適用後の確認項目は、未認証の個人API・会話APIの401と、認証済みの本人データへのアクセスとする。
- 検証：アカウント設計書の切り戻し方針と照合する。今回は切り戻しや実データへのアクセスを実行しない。

### 3. Firestore Rulesの保護と更新の制約を明記する

- [指摘](https://github.com/shousui-works/kotokoto-wellness/pull/3#discussion_r4331756809)。妥当。
- 固定providerではRulesetの内容変更とReleaseの参照先変更が置換になる。現行の `prevent_destroy` によって通常のplan/applyはReleaseの置換を拒否する。
- 今回は `infra/terraform/data/main.tf` の保護設定を維持する。`infra/terraform/README.md` に、通常のリリース手順では `firestore.rules` の更新を扱わないことを明記する。
- 全拒否Rulesを変更する必要が生じた場合は、対象DB・変更内容・更新手段・失敗時の復旧を別途設計する。保護を一律解除するコマンドは追加しない。
- 検証：provider 8.7.0のForceNewと現行lifecycleを照合する。Rules、DB、stateに変更を加えない。

### 4. 通常返信と要約で送信する会話範囲を正しく記載する

- [指摘](https://github.com/shousui-works/kotokoto-wellness/pull/3#discussion_r4331756826)。説明不足は妥当だが、「通常時の最大8往復を維持」という修正案は現行のアカウント経路に合わない。
- `README.md` のOpenAI送信範囲を、ログイン後の通常返信では保存済みサマリー・日本時間の当日全対話・今回の入力・必要な記録とする。
- 日をまたいだ後の会話では、未要約の過去日の全対話と既存サマリーを要約処理へ渡す。翌日の最初の会話で実行され、未要約分が複数日ならまとめて扱うことも反映する。
- 旧経路の最大8往復の制限を現在の認証済み経路に適用したように書かない。会話削除・記憶リセット後は対象から除外されることも既存実装に合わせる。
- 検証：`test/owner-memory.test.mjs` で8往復を超える当日文脈、翌日の全対話要約、複数日の追いつき、削除・リセットの既存テストを実行する。実際のOpenAI APIへ送信しない。

### 5. ビルド結果のJSON出力を明示的に保護する

- [指摘](https://github.com/shousui-works/kotokoto-wellness/pull/3#discussion_r4331756832)。現行構成の重大障害とは評価しないが、小さな予防的改善として採用する。
- 現在は `CLOUD_LOGGING_ONLY` と標準gcloudの組み合わせでログをストリームしない。現構成で必ずJSON解析が失敗するという前提は成立しない。
- `scripts/build-cloud-run.mjs` の引数へ `--suppress-logs` を追加し、将来のログ設定やCLIの変化に対してもstdoutを結果の取得専用にする。結果の成功確認とダイジェスト照合は維持する。
- 検証：既存のビルド計画テストでフラグとJSON形式の指定を確認し、成功結果からのダイジェスト取得、不正結果の拒否を再検証する。Cloud Buildの実行は不要。

### 6. コンテナのアプリコードを実行ユーザーの所有から外す

- レビュー本文内のDockerfileの軽微な提案。妥当な権限強化として採用する。
- `Dockerfile` の `server/` と `dist/` のCOPYから `--chown=node:node` を削除する。非rootの `USER node` は維持する。現行コードはこれらのディレクトリへの書き込みを必要としない。
- 検証：Nodeの全オフラインテストを実行する。ローカルのDockerを利用できる場合はイメージ内のnodeユーザーで両ディレクトリと代表ファイルが読取可能・書込不可であること、サーバーの起動を確認する。Docker検証ができなければ未確認と記録し、検証のためだけに本番へデプロイしない。

## スレッドの扱いと完了条件

- 今回、修正不要としてresolveする指摘はない。重要度や推奨文言への異論だけを理由に、採用する改善のスレッドを先に閉じない。
- 実装後に各スレッドへ実際の対応内容と検証結果を返信し、対応済みのものをresolveする。主指摘6件に対応する変更とDockerfileの提案を区別して記録する。
- 無関係な整形や機能追加を避け、関連テスト、Node全テスト、差分チェック、自分自身による再レビューを行う。Terraformの動作は変更せず、文書整合のために実インフラへアクセスしない。

## 計画作成時の確認

- 記憶処理とビルドスクリプトの既存オフラインテスト10件が成功した。
- この計画の作成時点ではコード修正、レビューへの返信、resolve、再レビュー依頼は行っていない。

## 実装と検証の結果

- 認証・保存先・プロフィール・旧記録の移行と、初回移設時点の記録を現在の構成から区別した。会話の送信範囲に加え、隣接する旧経路の履歴上限・プロセス内キャッシュの説明も現在のFirestore経路と分けた。
- 切り戻し先を認証対応の互換版か個人API・実AI停止版に限定した。Rulesの既存保護は変更せず、通常のリリースではRulesを更新しない旨と、既存releaseのimport後に置換planを適用しない旨を記載した。
- ビルド引数へ `--suppress-logs` を追加し、既存テストにJSON形式とログ抑制の確認を加えた。DockerfileのCOPYをroot所有へ変更し、実行ユーザーnodeを維持した。
- `TZ=UTC node --test test/*.test.mjs` は115件成功。差分チェックと自分自身による再レビューを完了した。TerraformのHCL・Rulesは変更していないため、既に成功したモック37件の再実行は行っていない。
- ローカルDockerビルドに成功。外部ネットワークを無効にしたコンテナでUID 1000、server/distと代表ファイルのroot所有・読取可・書込不可、test/scripts/infra/.env.localの不在、healthzとトップ画面の200を確認した。legacyモードではAI経路自体が無効のためPOSTは405となることを確認した。認証必須経路の401はNode全テストで検証した。
- Cloud Buildの実行、GCPへのplan/apply、デプロイ、個人データの読取・外部送信は行っていない。
