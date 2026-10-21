# 管理コンソールと利用量

`/admin.html` をGoogleログインで開く。部屋のメニューには、管理者に登録されたUIDだけ「管理コンソール」を表示する。

権限の正本は名前付きFirestore `kotokoto-wellness` の `adminRoles/{uid}.enabled`。全admin APIでFirebase ID tokenを失効確認付きで検証した後に台帳を読み直す。一般利用者は403、未ログインは401。ブラウザからのFirestoreアクセスは引き続き全拒否。設定画面やプロフィール更新から管理者になれるAPIは作らない。本人のUIDは公開ソースに固定しない。

運用者が `node scripts/set-admin.mjs --project kotokoto-biyori --email <本人のGoogleメール> --grant` で、Firebase上の有効/メール確認済みGoogleアカウントを検証して登録する。quota projectはこのプロセスだけ明示する。IAM・OAuth・OpenAIの組織権限は増やさない。権限削除は運用者が同じ台帳のenabledをfalseにする。

## 集計

Responsesのusageを会話/記憶の各実API呼び出しから保存する。再送結果の再表示では新しく加算しない。response IDのSHA256を `aiUsageEvents/{hash}` のキーにし、イベント作成と `aiUsageDays/{JST日付}` の全体/用途別集計を同じFirestore transactionで行う。二つの書き込みが一部だけ成功する状態や、同じresponse IDの二重加算を防ぐ。本文・名前・UID・体重・行動記録・APIキーはイベントへ保存しない。失敗した返事や記憶更新でも、usageが返った有料呼び出しは集計する。保存結果は最大2秒だけ待ち、失敗・待ち時間超過は会話を失敗扱いにせず、内容を含まないエラーログへ残す。タイムアウト後も開始済みtransactionが完了する場合があり、response IDで重複を防ぐ。保存できなかった利用量の自動復元は保証しない。

7/30/90日を選び、日別の料金/トークングラフ、入力/出力/キャッシュ読取/書込、用途別内訳を表示。最新データを取得できなければ前の表示であることを伝え、権限失効・ログアウト・別UIDへの切り替えでは古いデータを消す。レスポンスはno-store、ID tokenはAuthorizationヘッダーだけで送りURLへ載せない。

## 料金

2026-10-19確認の公式モデルページ https://developers.openai.com/api/docs/models/gpt-6-luna を単価の根拠とする。Standard短コンテクストの100万トークン当たりUSDは、通常入力0.10、キャッシュ読取0.01、書込0.125、出力0.50。272Kを超える入力は0.20/0.02/0.25/0.75を用いる。料金はUSDの10億分の1の整数でイベントごとに保存し、将来の単価変更で過去を再計算しない。

通常入力 = input_tokens - cached_tokens - cache_write_tokens。出力は推論込みで、別途二重計上しない。usage欠落・未対応モデル/処理tier・矛盾する値は料金0と断定せず未算出件数を表示。請求調整・税・GCP料金を含む確定請求ではない。各公式請求画面へのリンクを併設する。

以前の `openai_prompt_cache` の数値だけを持つCloud Runログは `node scripts/backfill-ai-usage.mjs --project=kotokoto-biyori` で再実行安全な取り込みができる。新台帳方式のログを除外し、旧ログのinsertIdを一意キーとする。旧ログにはmodel/tierがないため、当時の固定モデルgpt-6-luna/Standard単価を仮定した概算。ログ上限に達した場合は黙って欠落させず停止。usageログ導入以前や、通信失敗でusageを受け取れなかった呼び出しは復元しない。

全APIは集計データだけを返し、他ユーザーの会話/健康情報を見る機能は追加しない。管理者設定・AI台帳はアプリデータとして管理し、秘密情報や本人UIDをTerraformへ渡さない。既存のnamed DB IAMと全拒否Rulesを使い、追加のGCP権限は不要。

検証: admin-usage.test.mjsは料金分解/JST集計/重複/匿名・一般ユーザー拒否/権限失効を、admin-auth.test.mjsはtoken refreshと別アカウントの遅延レスポンス拒否を確認。scripts/check-admin-storage.mjsは隔離した架空コレクションで実Firestoreの並行重複排除/クエリを確認して削除する。test/preview-admin.mjsは外部接続なしの架空UIデータ専用で公開物に含めない。
