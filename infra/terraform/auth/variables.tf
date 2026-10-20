variable "project_id" {
  description = "デプロイ対象のGCPプロジェクトID。現在のgcloud設定からは取得しない。"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "実際のGCPプロジェクトIDを指定してください。"
  }
}

variable "region" {
  description = "認証基盤の補助リージョン。"
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

variable "auth_domain" {
  type        = string
  description = "認証ヘルパーを配信するアプリのホスト。httpsやパスを含めない。"
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+[.][a-z]{2,}$", var.auth_domain))
    error_message = "auth_domainにはHTTPSアプリのホスト名だけを指定してください。"
  }
}
variable "manage_auth_config" {
  type        = bool
  default     = false
  description = "確認・import済みの認証共通設定の許可ドメインだけを管理する。"
}
variable "existing_auth_config_confirmed" {
  type        = bool
  default     = false
  description = "既存の認証形態と課金への影響を確認し、configをimportする場合だけtrue。"
}
variable "authorized_domains" {
  type        = set(string)
  default     = []
  description = "管理する場合は既存の正当なドメインを全て含める。既存のlocalhostは明示した場合だけ維持する。"
  validation {
    condition     = alltrue([for host in var.authorized_domains : host == "localhost" || can(regex("^[a-z0-9][a-z0-9.-]+[.][a-z]{2,}$", host))]) && (!var.manage_auth_config || contains(var.authorized_domains, var.auth_domain))
    error_message = "許可ドメインはホスト名で指定し、管理時はauth_domainと維持する既存ドメインを含めてください。"
  }
}
