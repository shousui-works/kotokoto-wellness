locals {
  services = setunion(toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "iam.googleapis.com",
    "iap.googleapis.com",
    "logging.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    ]), var.enable_account_infrastructure ? toset([
    "firebase.googleapis.com",
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    "firestore.googleapis.com",
    "firebaserules.googleapis.com",
    "cloudscheduler.googleapis.com",
  ]) : toset([]))
  labels = {
    app        = var.app_name
    managed-by = "terraform"
  }
}

resource "google_project_service" "required" {
  for_each = local.services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "app" {
  project       = var.project_id
  location      = var.region
  repository_id = var.app_name
  format        = "DOCKER"
  description   = "こつこつ日和のリリースイメージ"
  labels        = local.labels

  docker_config {
    immutable_tags = true
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "${var.app_name}-run"
  display_name = "こつこつ日和 Cloud Run"

  depends_on = [google_project_service.required]
}

resource "google_service_account" "build" {
  project      = var.project_id
  account_id   = "${var.app_name}-build"
  display_name = "こつこつ日和 Cloud Build"

  depends_on = [google_project_service.required]
}

resource "google_artifact_registry_repository_iam_member" "builder" {
  project    = var.project_id
  location   = google_artifact_registry_repository.app.location
  repository = google_artifact_registry_repository.app.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.build.email}"
}

resource "google_project_iam_member" "build_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.build.email}"
}

resource "google_storage_bucket" "build_source" {
  project                     = var.project_id
  name                        = "${var.project_id}-${var.app_name}-builds"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "build_source_reader" {
  bucket = google_storage_bucket.build_source.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.build.email}"
}

resource "google_secret_manager_secret" "openai_api_key" {
  project   = var.project_id
  secret_id = "${var.app_name}-openai-api-key"
  labels    = local.labels

  replication {
    auto {}
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "account_worker" {
  for_each     = var.enable_account_infrastructure ? toset(["delete", "schedule"]) : toset([])
  project      = var.project_id
  account_id   = "${var.app_name}-${each.value}"
  display_name = "Komugi account ${each.value}"
  depends_on   = [google_project_service.required]
}
