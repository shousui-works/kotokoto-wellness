locals {
  database_path  = "projects/${var.project_id}/databases/${var.database_id}"
  runtime_email  = "${var.app_name}-run@${var.project_id}.iam.gserviceaccount.com"
  deletion_email = "${var.app_name}-delete@${var.project_id}.iam.gserviceaccount.com"
  db_members     = merge({ runtime = local.runtime_email }, var.enable_deletion_permissions ? { deletion = local.deletion_email } : {})
  ledger_bucket  = "${var.project_id}-${var.app_name}-deletions"
}
resource "google_firestore_database" "app" {
  project                           = var.project_id
  name                              = var.database_id
  location_id                       = var.database_location
  type                              = "FIRESTORE_NATIVE"
  database_edition                  = "STANDARD"
  concurrency_mode                  = var.concurrency_mode
  app_engine_integration_mode       = var.app_engine_integration_mode
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  deletion_policy                   = "PREVENT"
  lifecycle { prevent_destroy = true }
}
resource "google_firebaserules_ruleset" "app" {
  project = var.project_id
  source {
    files {
      name    = "firestore.rules"
      content = file("${path.module}/firestore.rules")
    }
  }
  lifecycle { create_before_destroy = true }
}
resource "google_firebaserules_release" "app" {
  project         = var.project_id
  name            = var.database_id == "(default)" ? "cloud.firestore" : "cloud.firestore/${var.database_id}"
  ruleset_name    = google_firebaserules_ruleset.app.id
  deletion_policy = "PREVENT"
  depends_on      = [google_firestore_database.app]
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = var.dedicated_database_confirmed
      error_message = "このDBがアプリ専用であることを確認してください。他用途のRulesを全拒否にできません。"
    }
  }
}
