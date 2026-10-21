resource "google_storage_bucket" "deletion_ledger" {
  project                     = var.project_id
  name                        = local.ledger_bucket
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = false }
  soft_delete_policy { retention_duration_seconds = 0 }
  lifecycle_rule {
    condition { age = 30 }
    action { type = "Delete" }
  }
  lifecycle { prevent_destroy = true }
}
resource "google_storage_bucket_iam_member" "deletion_ledger" {
  for_each = var.enable_deletion_permissions ? toset(["roles/storage.objectCreator", "roles/storage.objectViewer"]) : toset([])
  bucket   = google_storage_bucket.deletion_ledger.name
  role     = each.value
  member   = "serviceAccount:${local.deletion_email}"
}
