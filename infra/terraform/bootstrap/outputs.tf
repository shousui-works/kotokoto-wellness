output "state_bucket" {
  description = "bootstrap、foundation、appのstateを別prefixで保存するバケット。"
  value       = google_storage_bucket.state.name
}
