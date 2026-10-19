mock_provider "google" {
  override_during = plan
}

variables {
  project_id = "example-project"
}

run "private_versioned_state" {
  command = plan

  assert {
    condition     = google_storage_bucket.state.uniform_bucket_level_access && google_storage_bucket.state.public_access_prevention == "enforced"
    error_message = "stateバケットを一般公開してはいけません。"
  }

  assert {
    condition     = google_storage_bucket.state.versioning[0].enabled && !google_storage_bucket.state.force_destroy
    error_message = "stateの世代管理と削除時のデータ保護が必要です。"
  }

  assert {
    condition     = !google_project_service.storage.disable_on_destroy
    error_message = "stateの変更で共有APIを無効にしてはいけません。"
  }
}

run "reject_public_state_member" {
  command = plan
  variables {
    state_admin_members = ["allUsers"]
  }
  expect_failures = [var.state_admin_members]
}
