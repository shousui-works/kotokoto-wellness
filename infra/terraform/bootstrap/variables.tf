variable "project_id" {
  description = "既に作成し、課金を設定した、このアプリ用のGCPプロジェクトID。"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "実際のGCPプロジェクトIDを指定してください。"
  }
}

variable "region" {
  description = "stateバケットを置くリージョン。"
  type        = string
  default     = "asia-northeast1"
}

variable "state_bucket_name" {
  description = "stateバケット名。未指定ならプロジェクトIDから生成する。"
  type        = string
  default     = null
}

variable "state_admin_members" {
  description = "stateの読み書きを許可する追加の管理者。プロジェクトの既存権限は変更しない。"
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for member in var.state_admin_members : can(regex("^(user|group|serviceAccount):[^ ]+@[^ ]+$", member))])
    error_message = "user:、group:、serviceAccount:で始まる特定の管理者だけを指定してください。"
  }
}
