locals {
  runtime_email = "${var.app_name}-run@${var.project_id}.iam.gserviceaccount.com"
  secret_id     = "${var.app_name}-openai-api-key"
  image_prefix  = "${var.region}-docker.pkg.dev/${var.project_id}/${var.app_name}/app@sha256:"
}

resource "google_project_service_identity" "iap" {
  provider = google-beta
  count    = var.enable_iap ? 1 : 0

  project = var.project_id
  service = "iap.googleapis.com"
}

resource "google_secret_manager_secret_iam_member" "runtime_openai" {
  count = var.openai_secret_version == null ? 0 : 1

  project   = var.project_id
  secret_id = local.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_email}"
}

resource "google_cloud_run_v2_service" "app" {
  project              = var.project_id
  name                 = var.app_name
  location             = var.region
  description          = "こつこつ日和"
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = var.allow_public_access
  iap_enabled          = var.enable_iap
  deletion_protection  = var.deletion_protection
  labels = {
    app        = var.app_name
    managed-by = "terraform"
  }

  scaling {
    min_instance_count = 0
    max_instance_count = var.max_instances
  }

  template {
    service_account                  = local.runtime_email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN1"
    max_instance_request_concurrency = 40
    timeout                          = "60s"

    containers {
      image = var.container_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = var.account_config == null ? {} : {
          ACCOUNT_MODE            = var.account_mode
          GOOGLE_CLOUD_PROJECT    = var.project_id
          FIRESTORE_DATABASE_ID   = var.account_config.database_id
          FIREBASE_WEB_APP_ID     = var.account_config.web_app_id
          FIREBASE_AUTH_DOMAIN    = var.account_config.auth_domain
          FIREBASE_PUBLIC_API_KEY = var.account_config.public_api_key
        }
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.openai_secret_version == null ? [] : [var.openai_secret_version]

        content {
          name = "OPENAI_API_KEY"
          value_source {
            secret_key_ref {
              secret  = local.secret_id
              version = env.value
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.push_secret_version == null ? [] : [var.push_secret_version]
        content {
          name = "WEB_PUSH_VAPID"
          value_source {
            secret_key_ref {
              secret  = "${var.app_name}-web-push-vapid"
              version = env.value
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.push_secret_version == null ? {} : { WEB_PUSH_SUBJECT = var.push_subject }
        content {
          name  = env.key
          value = env.value
        }
      }
      startup_probe {
        initial_delay_seconds = 0
        timeout_seconds       = 1
        period_seconds        = 3
        failure_threshold     = 10

        http_get {
          path = "/healthz"
          port = 8080
        }
      }

      liveness_probe {
        timeout_seconds   = 1
        period_seconds    = 10
        failure_threshold = 3

        http_get {
          path = "/healthz"
          port = 8080
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    precondition {
      condition     = var.account_mode != "required" || (var.account_config != null && var.account_backend_ready && !var.enable_iap)
      error_message = "requiredには認証対応イメージの確認と公開設定が必要です。FirebaseログインとIAPは併用しません。"
    }
    precondition {
      condition     = !var.enable_account_maintenance || (var.account_mode == "required" && var.account_backend_ready && var.account_maintenance_ready && var.account_config != null)
      error_message = "削除Jobはrequiredの認証・保存・worker対応イメージと公開設定が揃ってから有効化してください。"
    }
    precondition {
      condition     = !var.allow_public_access || (!var.enable_iap && length(var.invoker_members) == 0 && length(var.iap_members) == 0)
      error_message = "一般公開する場合はenable_iapをfalseにし、invoker_membersとiap_membersを空にしてください。"
    }

    precondition {
      condition     = startswith(var.container_image, local.image_prefix)
      error_message = "foundationと同じプロジェクト・リージョン・リポジトリでビルドしたイメージを指定してください。"
    }

    precondition {
      condition     = !var.enable_iap || (length(var.iap_members) > 0 && length(var.invoker_members) == 0)
      error_message = "IAP利用時はiap_membersに閲覧者を指定し、invoker_membersを空にしてください。"
    }

    precondition {
      condition     = var.enable_iap || length(var.iap_members) == 0
      error_message = "iap_membersを使う場合はenable_iapをtrueにしてください。"
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime_openai, google_secret_manager_secret_iam_member.runtime_push, google_project_service_identity.iap]
}

resource "google_cloud_run_v2_service_iam_member" "invoker" {
  for_each = var.enable_iap || var.allow_public_access ? toset([]) : var.invoker_members

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = each.value
}

resource "google_cloud_run_v2_service_iam_member" "iap_invoker" {
  count = var.enable_iap ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_project_service_identity.iap[0].email}"
}

resource "google_iap_web_cloud_run_service_iam_member" "viewer" {
  for_each = var.enable_iap ? var.iap_members : toset([])

  project                = var.project_id
  location               = var.region
  cloud_run_service_name = google_cloud_run_v2_service.app.name
  role                   = "roles/iap.httpsResourceAccessor"
  member                 = each.value
}
