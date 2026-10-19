output "service_url" {
  description = "認証が必要なCloud RunのURL。"
  value       = google_cloud_run_v2_service.app.uri
}

output "service_name" {
  value = google_cloud_run_v2_service.app.name
}

output "deployed_image" {
  value = var.container_image
}

output "account_mode" { value = var.account_mode }
output "account_cleanup_job" { value = try(google_cloud_run_v2_job.account_cleanup[0].name, null) }
