# 犬からのプッシュ通知

Web Pushを使い、既存Cloud Run/Firebaseログイン/Firestoreで実装。アプリストアへの登録やOpenAIの音声・会話APIは不要。

## 利用

- ログイン後、右上メニュー → 設定 → 犬からの通知。
- 初期値は1日2回くらい。端末ごとに1〜3回の上限を変更・オン/オフ・テスト送信できる。朝7〜10時・昼12〜15時・夜18〜21時（日本時間）から異なる時間帯を選び、各時間帯内の時刻も毎日ランダムに決める。1アカウント5台まで。
- iPhone/iPadはiOS/iPadOS 16.4以降でホーム画面へ追加し、そのアイコンから開く。Safariの共有メニューの「ホーム画面に追加」を使う。通知許可はユーザーが「オンにする」を押した時だけ要求。
- AndroidはWeb Push対応ブラウザで許可する。実行時にAPI対応を検出する。
- 既存のブラウザ通知許可を設定画面から取り消すことはできないが、アプリのオフではサーバー登録を削除し、購読も解除する。再度オンにはユーザー操作が必要。
- ログアウト時はこの端末のサーバー登録を削除し購読解除。接続障害時でも購読解除できればログアウトできる。どちらも失敗した場合は通知を停止できない旨を示し、ログアウト前に再試行する。
- 選んだ時刻は5分刻みの定期実行で確認する。通信・集中モード等の遅延があり、時間帯を過ぎた未送信分はまとめて送らずスキップする。深夜（21〜翌7時）には送信しない。新規登録時に過ぎた時間帯を遡らないため、その日の回数が上限より少ない場合もある。

## 構成

- `dist/manifest.webmanifest` / `icons/`：インストール情報。start_urlは既存の `/#room`。
- `dist/push-settings.mjs`：許可/購読/回数/テスト/解除。設定は端末の購読単位。未ログインでは利用不可。
- `dist/push-sw.js`：pushを受け取り通知を表示、タップで同一originの部屋を開く。外部URLは使わない。fetchハンドラー・アプリ/APIキャッシュ・オフライン書き込みは追加しない。
- `server/account-api.mjs`：既存のFirebase ID token検証/同一origin保護を共用。GET `/api/push/config`、GET/PUT/DELETE `/api/push/subscription`、POST `/api/push/test`。本文は8KiBまで。返答に購読endpoint/秘密鍵を含めない。
- `server/push.mjs`：登録/検証/Firestoreトランザクション/日次claim。`pushSubscriptions/{sha256(endpoint)}`にUID・暗号化用公開鍵/認証値・回数・日ごとに決めたランダムな予定・nextAt・送信済みの時間帯・lastTestAtを保存する。ユーザーの記録・既存の保存形式・revisionには混ぜない。ブラウザからのFirestore直接アクセスは既存の全拒否Rulesのまま。
- endpointはHTTPSのGoogle FCM、Apple Web Push、Mozilla Pushの既知ホストだけ許可。P-256鍵を検証し、プッシュ送信を任意のURLへのリクエストに使わせない。他UIDの登録/参照/削除はできない。前アカウントの登録が残る端末は、前アカウントで通知をオフにしてから登録する。
- 通知は最新の登録された犬名＋時間帯ごとに4種類（計12種類）の温かい定型文。朝は「おはよう」「朝ごはんはもう食べた？」、昼は昼食や息抜き、夜は「今日もおつかれさま」など。会話・記憶・体重・ポイント・健康記録は載せない。テストは端末ごと1分1回まで。
- `server/push-runtime.mjs`：固定バージョンのnpm `web-push`で標準暗号化/VAPID署名。ブラウザの通知サービスに暗号化した本文を送る。TTLは最大1時間かつその時間帯の終わりまで・ネットワークtimeout10秒。404/410は購読削除。
- `server/push-dispatch.mjs`：Cloud Run Job。Cloud SchedulerからGoogle API経由でOAuth認証して5分おきに実行。公開の配信エンドポイントは作らない。OpenAIキーはJobに渡さない。
- claimをFirestoreトランザクションで送信前に確定し、同じ時間帯/重複実行の二重送信を避ける（端末ごとの設定上限と各時間帯1回までの送信試行）。回数を変更しても送信済み時間帯/回数を保持する。エラーやclaim後のクラッシュではその回の通知を再送しない。exactly-once配信保証はない。遅れた日をまとめて連続配信しない。
- 1回100件ずつ最大500件/約240秒まで処理。超えた残りは次回へ。大量ユーザー向けにはキュー/並列化/専用worker SAへの分離を検討する。

## Terraformと鍵

1. foundationの `enable_account_infrastructure = true` と `enable_push_infrastructure = true` でAPI/既存Scheduler SA/通知用Secret Manager保管先を用意。
2. `node scripts/create-push-key.mjs kotokoto-biyori` でVAPIDの初回バージョンを作る。秘密鍵はメモリからgcloudの標準入力経由でSecret Managerへ渡し、ファイル/ログ/Terraformに保存しない。既存バージョンがあれば作成を拒否する。鍵を変更すると既存購読の再登録が必要になるので通常のデプロイで再生成しない。
3. Cloud Buildで作成したイメージをappへ指定。`push_secret_version = "1"`、`enable_push_schedule = true`、`push_subject`は公開アプリのHTTPS URL。既存ACCOUNT_MODE/Firestore設定が必要。
4. appのplanで新しいSecret参照権限・Cloud Run Job・そのJobへのScheduler SAのinvoker・Scheduler本体とGoogleのScheduler service agentを確認してapply。アプリも同じ鍵の固定バージョンを参照する。
5. 実端末で登録して「テスト通知」。アプリを閉じたときの受信・タップして部屋を開く動作は実端末で確認する。エージェントの検証では本人の端末で許可操作や実通知送信をしない。

購読が0件でもScheduler/Jobの起動とFirestore queryが発生する。Lunaのトークン利用はないが、GCPの起動・実行・保存・読み取り料金は通常どおり発生する。停止するときはまずSchedulerをpauseし、Terraformにも反映する。Jobは削除保護付き。

## 検証

`node --test test/*.test.mjs` と `node scripts/check-terraform.mjs`（実GCPへ変更しない）。`PUSH_FIXTURE=1 PORT=8098 node test/preview-account.mjs` は通知サービス/実権限要求を使わない架空のUI検証用で、公開イメージには含めない。

原典：
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- https://web.dev/articles/push-notifications-subscribing-a-user
- https://web.dev/articles/push-notifications-client-codelab
- https://docs.cloud.google.com/scheduler/docs/http-target-auth
- https://github.com/web-push-libs/web-push
