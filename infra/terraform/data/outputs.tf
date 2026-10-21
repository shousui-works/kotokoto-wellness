output "project_id" { value = var.project_id }
output "database_id" { value = google_firestore_database.app.name }
output "database_path" { value = local.database_path }
output "database_location" { value = google_firestore_database.app.location_id }
output "deletion_ledger_bucket" { value = google_storage_bucket.deletion_ledger.name }
