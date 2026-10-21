# Only API queries combining date filtering with stable creation ordering need a composite.
resource "google_firestore_index" "activities_by_date" {
  project     = var.project_id
  database    = google_firestore_database.app.name
  collection  = "activities"
  query_scope = "COLLECTION"
  fields {
    field_path = "date"
    order      = "ASCENDING"
  }
  fields {
    field_path = "at"
    order      = "ASCENDING"
  }
}
locals {
  unindexed_fields = {
    "memory.summary"         = { collection = "memory", field = "summary" }
    "messages.text"          = { collection = "messages", field = "text" }
    "activities.evidence"    = { collection = "activities", field = "evidence" }
    "activities.detail"      = { collection = "activities", field = "detail" }
    "activities.estimate"    = { collection = "activities", field = "estimate" }
    "activities.corrections" = { collection = "activities", field = "corrections" }
    "operations.result"      = { collection = "operations", field = "result" }
  }
}
resource "google_firestore_field" "unindexed" {
  for_each   = local.unindexed_fields
  project    = var.project_id
  database   = google_firestore_database.app.name
  collection = each.value.collection
  field      = each.value.field
  index_config {}
}
