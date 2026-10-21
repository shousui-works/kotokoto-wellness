# Each staging chunk needs its own expireAt; deleting a parent never cleans its descendants.
resource "google_firestore_field" "expiry" {
  for_each   = toset(["importChunks", "usage"])
  project    = var.project_id
  database   = google_firestore_database.app.name
  collection = each.value
  field      = "expireAt"
  ttl_config {}
  index_config {}
}
