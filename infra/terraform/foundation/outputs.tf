output "project_id" {
  value = var.project_id
}

output "region" {
  value = var.region
}

output "image_repository" {
  description = "Cloud Buildが保存するアプリイメージのパス。"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/app"
}

output "build_service_account" {
  value = google_service_account.build.name
}

output "build_source_bucket" {
  value = google_storage_bucket.build_source.name
}

output "runtime_service_account" {
  value = google_service_account.runtime.email
}

output "openai_secret_id" {
  description = "保管先のIDのみ。キー本体はTerraformで扱わない。"
  value       = google_secret_manager_secret.openai_api_key.secret_id
}

output "deletion_service_account" {
  value = try(google_service_account.account_worker["delete"].email, null)
}
output "scheduler_service_account" {
  value = try(google_service_account.account_worker["schedule"].email, null)
}
