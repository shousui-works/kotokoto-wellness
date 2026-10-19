mock_provider "google" {
  override_during = plan
  mock_resource "google_firebaserules_ruleset" {
    defaults = { id = "projects/example-project/rulesets/mock-ruleset" }
  }
}
variables {
  project_id                   = "example-project"
  dedicated_database_confirmed = true
}
run "protected_dedicated_database" {
  command = plan
  assert {
    condition     = google_firestore_database.app.project == "example-project" && google_firestore_database.app.name == "kotokoto-wellness" && google_firestore_database.app.location_id == "asia-northeast1" && google_firestore_database.app.type == "FIRESTORE_NATIVE"
    error_message = "Native DBのproject/locationを明示してください。"
  }
  assert {
    condition     = google_firestore_database.app.delete_protection_state == "DELETE_PROTECTION_ENABLED" && google_firestore_database.app.deletion_policy == "PREVENT" && google_firestore_database.app.point_in_time_recovery_enablement == "POINT_IN_TIME_RECOVERY_ENABLED"
    error_message = "DB削除保護と復旧機能が必要です。"
  }
  assert {
    condition     = google_firebaserules_release.app.name == "cloud.firestore/kotokoto-wellness" && google_firebaserules_release.app.ruleset_name == "projects/example-project/rulesets/mock-ruleset" && strcontains(one(one(google_firebaserules_ruleset.app.source).files).content, "allow read, write: if false;")
    error_message = "対象DBへ全拒否Rulesを反映し、rulesetパスを二重化しないでください。"
  }
  assert {
    condition     = google_project_iam_member.database["runtime"].condition[0].expression == "resource.name == 'projects/example-project/databases/kotokoto-wellness'" && length(google_project_iam_member.database) == 1 && toset(google_project_iam_custom_role.auth_read.permissions) == toset(["firebaseauth.users.get"])
    error_message = "通常SAのDBを限定し、Auth削除権限を与えてはいけません。"
  }
  assert {
    condition     = google_storage_bucket.deletion_ledger.public_access_prevention == "enforced" && google_storage_bucket.deletion_ledger.uniform_bucket_level_access && !google_storage_bucket.deletion_ledger.force_destroy && !google_storage_bucket.deletion_ledger.versioning[0].enabled && google_storage_bucket.deletion_ledger.soft_delete_policy[0].retention_duration_seconds == 0
    error_message = "削除管理記録の公開や保持延長を避けてください。"
  }
  assert {
    condition     = length(google_firestore_field.expiry) == 2 && contains(keys(google_firestore_field.expiry), "usage") && !contains(keys(google_firestore_field.expiry), "operations") && length(google_project_iam_member.auth_delete) == 0
    error_message = "TTLで操作IDを消したり未有効の削除workerへ権限を渡してはいけません。"
  }
}
run "default_database_release_is_distinct" {
  command = plan
  variables { database_id = "(default)" }
  assert {
    condition     = google_firebaserules_release.app.name == "cloud.firestore"
    error_message = "既定DBのRules release名が違います。"
  }
}
run "existing_location_is_preserved" {
  command = plan
  variables { database_location = "nam5" }
  assert {
    condition     = google_firestore_database.app.location_id == "nam5" && lower(google_storage_bucket.deletion_ledger.location) == "asia-northeast1"
    error_message = "FirestoreのlocationとGCSのregionを区別してください。"
  }
}
run "optional_deletion_permissions" {
  command = plan
  variables { enable_deletion_permissions = true }
  assert {
    condition     = length(google_project_iam_member.database) == 2 && contains(google_project_iam_custom_role.auth_delete[0].permissions, "firebaseauth.users.delete") && google_project_iam_member.auth_delete[0].member == "serviceAccount:kotokoto-biyori-delete@example-project.iam.gserviceaccount.com" && length(google_storage_bucket_iam_member.deletion_ledger) == 2
    error_message = "削除権限は専用workerだけに付けてください。"
  }
}
run "reject_unconfirmed_database" {
  command = plan
  variables { dedicated_database_confirmed = false }
  expect_failures = [google_firebaserules_release.app]
}
run "reject_path_in_database_id" {
  command = plan
  variables { database_id = "projects/other-project/databases/private" }
  expect_failures = [var.database_id]
}
run "reject_invalid_project" {
  command = plan
  variables { project_id = "" }
  expect_failures = [var.project_id]
}
