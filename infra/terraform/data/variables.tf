variable "project_id" {
  description = "デプロイ対象のGCPプロジェクトID。現在のgcloud設定からは取得しない。"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "実際のGCPプロジェクトIDを指定してください。"
  }
}

variable "region" {
  description = "削除管理用GCSのリージョン。Firestoreのdatabase_locationとは別。"
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

variable "database_id" {
  type        = string
  default     = "kotokoto-wellness"
  description = "専用FirestoreのDB ID。既存の場合は実名でimport。"
  validation {
    condition     = var.database_id == "(default)" || (can(regex("^[a-z][a-z0-9-]{2,61}[a-z0-9]$", var.database_id)) && !can(regex("^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$", var.database_id)))
    error_message = "有効な4〜63文字のDB IDまたは(default)を指定してください。"
  }
}
variable "database_location" {
  type        = string
  default     = "asia-northeast1"
  description = "Firestoreのlocation。Cloud Runのregionと区別し、既存DBは現状に合わせる。"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]+$", var.database_location))
    error_message = "Firestoreのlocation IDを指定してください。"
  }
}
variable "dedicated_database_confirmed" {
  type        = bool
  default     = false
  description = "新規または既存のアプリ専用DBと確認した場合のみtrue。"
}
variable "concurrency_mode" {
  type    = string
  default = "PESSIMISTIC"
  validation {
    condition     = contains(["PESSIMISTIC", "OPTIMISTIC"], var.concurrency_mode)
    error_message = "既存Native DBの同時実行制御を確認してください。"
  }
}
variable "app_engine_integration_mode" {
  type    = string
  default = "DISABLED"
  validation {
    condition     = contains(["DISABLED", "ENABLED"], var.app_engine_integration_mode)
    error_message = "App Engine連携の現状に合わせてください。"
  }
}
variable "enable_deletion_permissions" {
  type        = bool
  default     = false
  description = "foundationの削除SA作成後に削除処理の権限を準備する。"
}
