locals {
  deletion_email  = "${var.app_name}-delete@${var.project_id}.iam.gserviceaccount.com"
  scheduler_email = "${var.app_name}-schedule@${var.project_id}.iam.gserviceaccount.com"
}
resource "google_cloud_run_v2_job" "account_cleanup" {
  count               = var.enable_account_maintenance ? 1 : 0
  project             = var.project_id
  name                = "${var.app_name}-account-cleanup"
  location            = var.region
  deletion_protection = true
  template {
    parallelism = 1
    task_count  = 1
    template {
      service_account = local.deletion_email
      timeout         = "300s"
      max_retries     = 1
      containers {
        image   = var.container_image
        command = ["node"]
        args    = ["server/account-maintenance.mjs"]
        resources { limits = { cpu = "1", memory = "512Mi" } }
        dynamic "env" {
          for_each = {
            GOOGLE_CLOUD_PROJECT   = var.project_id
            FIRESTORE_DATABASE_ID  = try(var.account_config.database_id, "")
            DELETION_LEDGER_BUCKET = "${var.project_id}-${var.app_name}-deletions"
            CLEANUP_BATCH_SIZE     = "100"
          }
          content {
            name  = env.key
            value = env.value
          }
        }
      }
    }
  }
}
resource "google_cloud_run_v2_job_iam_member" "scheduler" {
  count    = var.enable_account_maintenance ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.account_cleanup[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.scheduler_email}"
}
resource "google_project_service_identity" "scheduler" {
  provider = google-beta
  count    = (var.enable_account_maintenance || var.enable_push_schedule) ? 1 : 0
  project  = var.project_id
  service  = "cloudscheduler.googleapis.com"
}
resource "google_project_iam_member" "scheduler_agent" {
  count   = (var.enable_account_maintenance || var.enable_push_schedule) ? 1 : 0
  project = var.project_id
  role    = "roles/cloudscheduler.serviceAgent"
  member  = "serviceAccount:${google_project_service_identity.scheduler[0].email}"
}
resource "google_cloud_scheduler_job" "account_cleanup" {
  count            = var.enable_account_maintenance ? 1 : 0
  project          = var.project_id
  region           = var.region
  name             = "${var.app_name}-account-cleanup"
  schedule         = "*/10 * * * *"
  time_zone        = "Asia/Tokyo"
  attempt_deadline = "30s"
  http_target {
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.account_cleanup[0].name}:run"
    http_method = "POST"
    body        = base64encode("{}")
    headers     = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = local.scheduler_email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }
  retry_config { retry_count = 1 }
  depends_on = [google_cloud_run_v2_job_iam_member.scheduler, google_project_iam_member.scheduler_agent]
}
