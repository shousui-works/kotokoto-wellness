variable "push_secret_version" {
  type        = string
  default     = null
  description = "VAPID鍵JSONのSecret Managerバージョン番号。秘密値は渡さない。"
  validation {
    condition     = var.push_secret_version == null || can(regex("^[1-9][0-9]*$", var.push_secret_version))
    error_message = "通知鍵は固定バージョン番号で参照してください。"
  }
}
variable "enable_push_schedule" {
  type    = bool
  default = false
}
variable "push_subject" {
  type    = string
  default = "https://kotokoto-biyori-oidgpmqhiq-an.a.run.app"
  validation {
    condition     = can(regex("^https://[^ ]+$", var.push_subject))
    error_message = "通知の連絡先にはHTTPSのアプリURLを指定してください。"
  }
}
resource "google_secret_manager_secret_iam_member" "runtime_push" {
  count     = var.push_secret_version == null ? 0 : 1
  project   = var.project_id
  secret_id = "${var.app_name}-web-push-vapid"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_email}"
}
resource "google_cloud_run_v2_job" "push" {
  count               = var.enable_push_schedule ? 1 : 0
  project             = var.project_id
  name                = "${var.app_name}-push"
  location            = var.region
  deletion_protection = true
  template {
    parallelism = 1
    task_count  = 1
    template {
      service_account = local.runtime_email
      timeout         = "300s"
      max_retries     = 0
      containers {
        image   = var.container_image
        command = ["node"]
        args    = ["server/push-dispatch.mjs"]
        resources { limits = { cpu = "1", memory = "512Mi" } }
        dynamic "env" {
          for_each = {
            GOOGLE_CLOUD_PROJECT  = var.project_id
            FIRESTORE_DATABASE_ID = try(var.account_config.database_id, "")
            WEB_PUSH_SUBJECT      = var.push_subject
          }
          content {
            name  = env.key
            value = env.value
          }
        }
        env {
          name = "WEB_PUSH_VAPID"
          value_source {
            secret_key_ref {
              secret  = "${var.app_name}-web-push-vapid"
              version = var.push_secret_version
            }
          }
        }
      }
    }
  }
  lifecycle {
    precondition {
      condition     = var.account_mode == "required" && var.account_config != null && var.push_secret_version != null
      error_message = "通知Jobには認証済み保存基盤と通知鍵が必要です。"
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.runtime_push]
}
resource "google_cloud_run_v2_job_iam_member" "push_scheduler" {
  count    = var.enable_push_schedule ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.push[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${local.scheduler_email}"
}
resource "google_cloud_scheduler_job" "push" {
  count            = var.enable_push_schedule ? 1 : 0
  project          = var.project_id
  region           = var.region
  name             = "${var.app_name}-push"
  schedule         = "*/5 * * * *"
  time_zone        = "Asia/Tokyo"
  attempt_deadline = "30s"
  http_target {
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.push[0].name}:run"
    http_method = "POST"
    body        = base64encode("{}")
    headers     = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = local.scheduler_email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }
  # API default: retryCount=0 and maxRetryDuration=0; omit the empty block to avoid drift.
  depends_on = [google_cloud_run_v2_job_iam_member.push_scheduler, google_project_iam_member.scheduler_agent]
}
