mock_provider "google" { override_during = plan }
mock_provider "google-beta" { override_during = plan }
variables {
  project_id  = "example-project"
  auth_domain = "example-app.a.run.app"
}
run "firebase_only_by_default" {
  command = plan
  assert {
    condition     = google_firebase_project.app.project == "example-project" && google_firebase_web_app.app.deletion_policy == "PREVENT" && length(google_identity_platform_config.app) == 0
    error_message = "認証共通設定を自動初期化せず、専用Web登録を保護してください。"
  }
}
run "reject_unconfirmed_auth_config" {
  command = plan
  variables {
    manage_auth_config = true
    authorized_domains = ["example-app.a.run.app", "example-project.firebaseapp.com"]
  }
  expect_failures = [google_identity_platform_config.app[0]]
}
run "confirmed_config_manages_explicit_domains" {
  command = plan
  variables {
    manage_auth_config             = true
    existing_auth_config_confirmed = true
    authorized_domains             = ["example-app.a.run.app", "example-project.firebaseapp.com", "existing.example.com"]
  }
  assert {
    condition     = contains(google_identity_platform_config.app[0].authorized_domains, "existing.example.com") && contains(google_identity_platform_config.app[0].authorized_domains, var.auth_domain)
    error_message = "既存ホストとアプリホストを保持してください。"
  }
}
run "reject_domain_with_scheme" {
  command = plan
  variables { auth_domain = "https://example.com" }
  expect_failures = [var.auth_domain]
}
run "reject_missing_app_domain" {
  command = plan
  variables {
    manage_auth_config             = true
    existing_auth_config_confirmed = true
    authorized_domains             = ["other.example.com"]
  }
  expect_failures = [var.authorized_domains]
}
