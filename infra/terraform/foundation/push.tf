variable "enable_push_infrastructure" {
  type    = bool
  default = false
}
resource "google_secret_manager_secret" "web_push" {
  count     = var.enable_push_infrastructure ? 1 : 0
  project   = var.project_id
  secret_id = "${var.app_name}-web-push-vapid"
  replication {
    auto {}
  }
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.enable_account_infrastructure
      error_message = "通知には認証基盤とSchedulerサービスアカウントを先に有効化してください。"
    }
  }
  depends_on = [google_project_service.required]
}
