# Manage domains only after importing the existing auth config. Never manage IDP secrets.
resource "google_identity_platform_config" "app" {
  count              = var.manage_auth_config ? 1 : 0
  project            = var.project_id
  authorized_domains = sort(tolist(var.authorized_domains))
  depends_on         = [google_firebase_project.app]
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [sign_in, client, mfa, multi_tenant, blocking_functions, quota, sms_region_config, monitoring, autodelete_anonymous_users]
    precondition {
      condition     = var.existing_auth_config_confirmed
      error_message = "既存の認証形態を確認して設定をimportしてから管理してください。Identity Platformを自動初期化しません。"
    }
  }
}
