terraform {
  required_version = ">= 1.13.5, < 2.0.0"

  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.7"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 8.7"
    }
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true
}
