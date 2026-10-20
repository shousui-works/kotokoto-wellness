mock_provider "google" {
  override_during = plan
}

mock_provider "google-beta" {
  override_during = plan
  mock_resource "google_project_service_identity" {
    defaults = {
      email = "service-123456789@gcp-sa-iap.iam.gserviceaccount.com"
    }
  }
}

variables {
  project_id            = "example-project"
  container_image       = "asia-northeast1-docker.pkg.dev/example-project/kotokoto-biyori/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  invoker_members       = ["user:owner@example.com"]
  allow_public_access   = false
  enable_iap            = false
  iap_members           = []
  openai_secret_version = null
}

run "private_small_service_without_api_key" {
  command = plan

  assert {
    condition     = !google_cloud_run_v2_service.app.invoker_iam_disabled && !google_cloud_run_v2_service.app.iap_enabled
    error_message = "初期状態ではIAM認証を有効にしてください。"
  }

  assert {
    condition     = google_cloud_run_v2_service.app.scaling[0].min_instance_count == 0 && google_cloud_run_v2_service.app.scaling[0].max_instance_count == 1
    error_message = "初期のスケールは0〜1インスタンスです。"
  }

  assert {
    condition     = google_cloud_run_v2_service.app.template[0].containers[0].resources[0].cpu_idle
    error_message = "リクエストベースの実行設定にしてください。"
  }

  assert {
    condition     = length(google_secret_manager_secret_iam_member.runtime_openai) == 0 && length(google_cloud_run_v2_service.app.template[0].containers[0].env) == 0
    error_message = "キー登録前に秘密情報の参照や読み取り権限を作ってはいけません。"
  }

  assert {
    condition     = google_cloud_run_v2_service.app.deletion_protection && google_cloud_run_v2_service.app.traffic[0].percent == 100
    error_message = "削除保護と明示したトラフィック設定が必要です。"
  }
}

run "public_app_without_login_or_iap" {
  command = plan
  variables {
    allow_public_access = true
    invoker_members     = []
  }

  assert {
    condition     = google_cloud_run_v2_service.app.invoker_iam_disabled && !google_cloud_run_v2_service.app.iap_enabled
    error_message = "公開モードではログインなしで開ける設定にしてください。"
  }

  assert {
    condition     = length(google_cloud_run_v2_service_iam_member.invoker) == 0 && length(google_cloud_run_v2_service_iam_member.iap_invoker) == 0 && length(google_iap_web_cloud_run_service_iam_member.viewer) == 0
    error_message = "公開モードではIAPや専用閲覧者の権限を追加しないでください。"
  }
}

run "reject_public_app_with_iap" {
  command = plan
  variables {
    allow_public_access = true
    enable_iap          = true
    invoker_members     = []
    iap_members         = ["user:owner@example.com"]
  }
  expect_failures = [google_cloud_run_v2_service.app]
}

run "reject_public_app_with_named_invokers" {
  command = plan
  variables {
    allow_public_access = true
  }
  expect_failures = [google_cloud_run_v2_service.app]
}

run "pinned_secret_reference_only" {
  command = plan
  variables {
    openai_secret_version = "3"
  }

  assert {
    condition     = google_secret_manager_secret_iam_member.runtime_openai[0].secret_id == "kotokoto-biyori-openai-api-key" && google_secret_manager_secret_iam_member.runtime_openai[0].role == "roles/secretmanager.secretAccessor"
    error_message = "秘密情報の読み取り権限をアプリ専用の保管先に限定してください。"
  }

  assert {
    condition     = one(google_cloud_run_v2_service.app.template[0].containers[0].env).value_source[0].secret_key_ref[0].version == "3"
    error_message = "明示したバージョンの秘密情報を参照してください。"
  }
}

run "iap_has_named_viewers_and_no_direct_invokers" {
  command = plan
  variables {
    enable_iap      = true
    invoker_members = []
    iap_members     = ["user:owner@example.com"]
  }

  override_resource {
    target          = google_project_service_identity.iap[0]
    override_during = plan
    values = {
      email = "service-123456789@gcp-sa-iap.iam.gserviceaccount.com"
    }
  }

  assert {
    condition     = google_cloud_run_v2_service.app.iap_enabled && length(google_cloud_run_v2_service_iam_member.invoker) == 0
    error_message = "IAPを有効にし、直接呼び出すユーザー権限を追加しないでください。"
  }

  assert {
    condition     = google_cloud_run_v2_service_iam_member.iap_invoker[0].member == "serviceAccount:service-123456789@gcp-sa-iap.iam.gserviceaccount.com"
    error_message = "IAPのサービスエージェントだけに呼び出し権限を付けてください。"
  }

  assert {
    condition     = google_iap_web_cloud_run_service_iam_member.viewer["user:owner@example.com"].role == "roles/iap.httpsResourceAccessor"
    error_message = "指定した閲覧者にIAP経由のアクセス権限が必要です。"
  }
}

run "reject_mutable_image_tag" {
  command = plan
  variables {
    container_image = "asia-northeast1-docker.pkg.dev/example-project/kotokoto-biyori/app:latest"
  }
  expect_failures = [var.container_image]
}

run "reject_image_from_another_project" {
  command = plan
  variables {
    container_image = "asia-northeast1-docker.pkg.dev/other-project/kotokoto-biyori/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  expect_failures = [google_cloud_run_v2_service.app]
}

run "reject_public_invoker" {
  command = plan
  variables {
    invoker_members = ["allUsers"]
  }
  expect_failures = [var.invoker_members]
}

run "reject_unpinned_secret_version" {
  command = plan
  variables {
    openai_secret_version = "latest"
  }
  expect_failures = [var.openai_secret_version]
}

run "reject_iap_without_viewers" {
  command = plan
  variables {
    enable_iap      = true
    invoker_members = []
    iap_members     = []
  }
  expect_failures = [google_cloud_run_v2_service.app]
}

run "account_features_off_by_default" {
  command = plan
  assert {
    condition     = length(google_cloud_run_v2_job.account_cleanup) == 0 && length(google_cloud_scheduler_job.account_cleanup) == 0 && length(google_project_iam_member.scheduler_agent) == 0
    error_message = "対応コードのないイメージで削除Jobを作ってはいけません。"
  }
}
run "reject_required_without_backend" {
  command = plan
  variables { account_mode = "required" }
  expect_failures = [google_cloud_run_v2_service.app]
}
run "reject_worker_in_legacy_mode" {
  command = plan
  variables { enable_account_maintenance = true }
  expect_failures = [google_cloud_run_v2_service.app]
}
run "required_backend_and_worker" {
  command = plan
  variables {
    account_mode               = "required"
    account_backend_ready      = true
    account_maintenance_ready  = true
    enable_account_maintenance = true
    account_config = {
      project_id     = "example-project"
      database_id    = "kotokoto-wellness"
      web_app_id     = "1:123456789:web:abc123"
      auth_domain    = "example-app.a.run.app"
      public_api_key = "AIzaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }
  assert {
    condition     = length([for env in google_cloud_run_v2_service.app.template[0].containers[0].env : env if env.name == "ACCOUNT_MODE" && env.value == "required"]) == 1 && length([for env in google_cloud_run_v2_service.app.template[0].containers[0].env : env if env.name == "FIRESTORE_DATABASE_ID" && env.value == "kotokoto-wellness"]) == 1
    error_message = "認証必須と保存先を明示してイメージへ渡してください。"
  }
  assert {
    condition     = google_cloud_run_v2_job.account_cleanup[0].template[0].template[0].service_account == "kotokoto-biyori-delete@example-project.iam.gserviceaccount.com" && google_cloud_run_v2_job.account_cleanup[0].template[0].parallelism == 1 && google_cloud_run_v2_job.account_cleanup[0].template[0].template[0].containers[0].image == var.container_image
    error_message = "削除workerは専用SAと固定イメージで実行してください。"
  }
  assert {
    condition     = google_cloud_scheduler_job.account_cleanup[0].http_target[0].oauth_token[0].service_account_email == "kotokoto-biyori-schedule@example-project.iam.gserviceaccount.com" && google_cloud_run_v2_job_iam_member.scheduler[0].role == "roles/run.invoker" && length([for env in google_cloud_run_v2_job.account_cleanup[0].template[0].template[0].containers[0].env : env if env.name == "OPENAI_API_KEY"]) == 0
    error_message = "Job実行にはOAuthと対象Jobの権限だけを使い、OpenAIキーをworkerへ渡さないでください。"
  }
}
run "reject_account_config_from_another_project" {
  command = plan
  variables {
    account_config = {
      project_id     = "other-project"
      database_id    = "kotokoto-wellness"
      web_app_id     = "1:123456789:web:abc123"
      auth_domain    = "example-app.a.run.app"
      public_api_key = "AIzaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }
  expect_failures = [var.account_config]
}

run "reject_unknown_account_mode" {
  command = plan
  variables { account_mode = "optional" }
  expect_failures = [var.account_mode]
}
run "reject_incomplete_required_config" {
  command = plan
  variables {
    account_mode          = "required"
    account_backend_ready = true
  }
  expect_failures = [google_cloud_run_v2_service.app]
}

run "push_off_by_default" {
  command = plan
  assert {
    condition     = length(google_cloud_run_v2_job.push) == 0 && length(google_cloud_scheduler_job.push) == 0 && length(google_secret_manager_secret_iam_member.runtime_push) == 0
    error_message = "通知は既定で無効です。"
  }
}
run "reject_push_without_account_or_key" {
  command = plan
  variables { enable_push_schedule = true }
  expect_failures = [google_cloud_run_v2_job.push]
}
run "push_job_has_only_push_key_and_authenticated_scheduler" {
  command = plan
  variables {
    account_mode          = "required"
    account_backend_ready = true
    account_config = {
      project_id     = "example-project"
      database_id    = "kotokoto-wellness"
      web_app_id     = "1:123456789:web:abc123"
      auth_domain    = "example-project.firebaseapp.com"
      public_api_key = "AIzaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
    push_secret_version  = "1"
    enable_push_schedule = true
  }
  assert {
    condition     = google_cloud_run_v2_job.push[0].template[0].template[0].containers[0].args[0] == "server/push-dispatch.mjs" && length([for env in google_cloud_run_v2_job.push[0].template[0].template[0].containers[0].env : env if env.name == "OPENAI_API_KEY"]) == 0 && google_cloud_scheduler_job.push[0].http_target[0].oauth_token[0].service_account_email == "kotokoto-biyori-schedule@example-project.iam.gserviceaccount.com"
    error_message = "通知JobはOpenAIキーなし、Schedulerは既存専用SAで認証します。"
  }
}
