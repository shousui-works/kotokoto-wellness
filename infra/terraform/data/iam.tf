resource "google_project_iam_member" "database" {
  for_each = local.db_members
  project  = var.project_id
  role     = "roles/datastore.user"
  member   = "serviceAccount:${each.value}"
  condition {
    title      = "${var.app_name}-${each.key}-database"
    expression = "resource.name == '${local.database_path}'"
  }
  depends_on = [google_firestore_database.app]
}
resource "google_project_iam_custom_role" "auth_read" {
  project     = var.project_id
  role_id     = "${replace(var.app_name, "-", "_")}_auth_read"
  title       = "Komugi authentication status reader"
  permissions = ["firebaseauth.users.get"]
}
resource "google_project_iam_member" "auth_read" {
  project = var.project_id
  role    = google_project_iam_custom_role.auth_read.name
  member  = "serviceAccount:${local.runtime_email}"
}
resource "google_project_iam_custom_role" "auth_delete" {
  count       = var.enable_deletion_permissions ? 1 : 0
  project     = var.project_id
  role_id     = "${replace(var.app_name, "-", "_")}_auth_delete"
  title       = "Komugi account deletion worker"
  permissions = ["firebaseauth.users.get", "firebaseauth.users.update", "firebaseauth.users.delete"]
}
resource "google_project_iam_member" "auth_delete" {
  count   = var.enable_deletion_permissions ? 1 : 0
  project = var.project_id
  role    = google_project_iam_custom_role.auth_delete[0].name
  member  = "serviceAccount:${local.deletion_email}"
}
