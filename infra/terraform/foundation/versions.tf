terraform {
  required_version = ">= 1.13.5, < 2.0.0"

  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.7"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
