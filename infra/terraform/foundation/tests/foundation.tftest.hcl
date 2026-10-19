mock_provider "google" {
  override_during = plan
}

variables {
  project_id = "example-project"
}

run "dedicated_build_and_runtime" {
  command = plan

  assert {
    condition     = google_service_account.build.account_id != google_service_account.runtime.account_id
    error_message = "ビルドとアプリ実行の権限を分ける必要があります。"
  }

  assert {
    condition     = google_artifact_registry_repository_iam_member.builder.role == "roles/artifactregistry.writer" && google_artifact_registry_repository_iam_member.builder.repository == google_artifact_registry_repository.app.repository_id
    error_message = "ビルドの書き込み権限は専用リポジトリに限定してください。"
  }

  assert {
    condition     = google_storage_bucket.build_source.public_access_prevention == "enforced" && google_storage_bucket.build_source.uniform_bucket_level_access
    error_message = "ビルドソースを一般公開してはいけません。"
  }

  assert {
    condition     = google_artifact_registry_repository.app.docker_config[0].immutable_tags
    error_message = "リリースのタグを上書きできない設定にしてください。"
  }

  assert {
    condition     = google_secret_manager_secret.openai_api_key.secret_id == "kotokoto-biyori-openai-api-key"
    error_message = "秘密情報の保管先がアプリ専用になっていません。"
  }
}

run "account_resources_off_by_default" {
  command = plan
  assert {
    condition     = length(google_service_account.account_worker) == 0 && !contains(keys(google_project_service.required), "firestore.googleapis.com")
    error_message = "既存基盤は認証基盤を明示して有効にするまで変えないでください。"
  }
}
run "enable_account_apis_and_separate_workers" {
  command = plan
  variables { enable_account_infrastructure = true }
  assert {
    condition     = contains(keys(google_project_service.required), "firestore.googleapis.com") && contains(keys(google_project_service.required), "identitytoolkit.googleapis.com") && contains(keys(google_project_service.required), "cloudscheduler.googleapis.com") && length(google_service_account.account_worker) == 2 && google_service_account.account_worker["delete"].account_id != google_service_account.runtime.account_id
    error_message = "必要APIと専用SAを作り、実行SAを分離してください。"
  }
}
