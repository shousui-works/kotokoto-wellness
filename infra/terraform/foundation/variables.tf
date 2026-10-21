variable "project_id" {
  description = "デプロイ対象のGCPプロジェクトID。現在のgcloud設定からは取得しない。"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "実際のGCPプロジェクトIDを指定してください。"
  }
}

variable "region" {
  description = "Cloud RunとArtifact Registryのリージョン。"
  type        = string
  default     = "asia-northeast1"
}

variable "app_name" {
  description = "この構成のリソース名。app側と一致させる。"
  type        = string
  default     = "kotokoto-biyori"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,18}[a-z0-9]$", var.app_name))
    error_message = "app_nameは3〜20文字の小文字英数字とハイフンにしてください。"
  }
}

variable "enable_account_infrastructure" {
  type        = bool
  default     = false
  description = "Auth/Firestore用APIと削除・Scheduler用SAを追加する。現行アプリへの変更はない。"
}
