resource "google_firebase_project" "app" {
  provider = google-beta
  project  = var.project_id
  lifecycle { prevent_destroy = true }
}
resource "google_firebase_web_app" "app" {
  provider        = google-beta
  project         = var.project_id
  display_name    = "${var.app_name} web"
  deletion_policy = "PREVENT"
  depends_on      = [google_firebase_project.app]
  lifecycle { prevent_destroy = true }
}
