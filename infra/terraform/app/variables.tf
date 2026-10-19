variable "project_id" {
  description = "foundationと同じGCPプロジェクトID。"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "実際のGCPプロジェクトIDを指定してください。"
  }
}

variable "region" {
  type        = string
  description = "foundationと同じリージョン。"
  default     = "asia-northeast1"
}

variable "app_name" {
  description = "foundationと同じリソース名。"
  type        = string
  default     = "kotokoto-biyori"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,18}[a-z0-9]$", var.app_name))
    error_message = "app_nameは3〜20文字の小文字英数字とハイフンにしてください。"
  }
}

variable "container_image" {
  description = "ビルド済みArtifact Registryイメージ。タグではなくsha256ダイジェストを指定する。"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker[.]pkg[.]dev/[a-z0-9-]+/[a-z0-9-]+/[a-z0-9/_-]+@sha256:[0-9a-f]{64}$", var.container_image))
    error_message = "Artifact Registryのimage@sha256:...を指定してください。latest等のタグは使用しません。"
  }
}

variable "allow_public_access" {
  description = "ログインなしでアプリを公開する場合だけtrueにする。IAPと専用の閲覧者設定は併用しない。"
  type        = bool
  default     = false
}

variable "invoker_members" {
  description = "IAMで呼び出せる本人・サービス。IAPまたは一般公開を利用する場合は空にする。"
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for member in var.invoker_members : can(regex("^(user|group|serviceAccount):[^ ]+@[^ ]+$", member))])
    error_message = "特定のuser:、group:、serviceAccount:だけを指定してください。一般公開のメンバーは使用できません。"
  }
}

variable "enable_iap" {
  description = "IAPで閲覧者を制限する場合のみ有効化。アプリのFirebaseログインとは別。"
  type        = bool
  default     = false
}

variable "iap_members" {
  description = "IAP経由で閲覧する本人・グループ。"
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for member in var.iap_members : can(regex("^(user|group):[^ ]+@[^ ]+$", member))])
    error_message = "特定のuser:またはgroup:を指定してください。"
  }
}

variable "openai_secret_version" {
  description = "Secret Managerに別途登録したキーのバージョン番号。nullなら参照も読み取り権限も作らない。"
  type        = string
  default     = null

  validation {
    condition     = var.openai_secret_version == null || can(regex("^[1-9][0-9]*$", var.openai_secret_version))
    error_message = "nullまたは登録済みのバージョン番号を指定してください。キー本体やlatestは指定しません。"
  }
}

variable "max_instances" {
  description = "Cloud Runサービス全体の最大インスタンス数。料金の上限ではない。"
  type        = number
  default     = 1

  validation {
    condition     = var.max_instances >= 1 && var.max_instances <= 10 && floor(var.max_instances) == var.max_instances
    error_message = "max_instancesは1〜10の整数にしてください。"
  }
}

variable "deletion_protection" {
  description = "Cloud Runサービスの削除保護。"
  type        = bool
  default     = true
}

variable "account_mode" {
  type        = string
  default     = "legacy"
  description = "認証対応アプリの切替時だけrequiredへ変更。基盤準備中はlegacyを維持。"
  validation {
    condition     = contains(["legacy", "required"], var.account_mode)
    error_message = "account_modeはlegacyまたはrequiredです。"
  }
}
variable "account_config" {
  type = object({
    project_id     = string
    database_id    = string
    web_app_id     = string
    auth_domain    = string
    public_api_key = string
  })
  default     = null
  description = "Auth/dataの確認済み公開設定だけ。OAuth secretやOpenAIキーを入れない。"
  validation {
    condition = var.account_config == null ? true : (
      var.account_config.project_id == var.project_id &&
      (var.account_config.database_id == "(default)" || (can(regex("^[a-z][a-z0-9-]{2,61}[a-z0-9]$", var.account_config.database_id)) && !can(regex("^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$", var.account_config.database_id)))) &&
      can(regex("^1:[0-9]+:web:[a-zA-Z0-9]+$", var.account_config.web_app_id)) &&
      can(regex("^[a-z0-9][a-z0-9.-]+[.][a-z]{2,}$", var.account_config.auth_domain)) &&
      can(regex("^AIza[a-zA-Z0-9_-]{35}$", var.account_config.public_api_key))
    )
    error_message = "同じプロジェクトの有効なDB ID、Firebase Web app ID、ホスト、公開APIキーを指定してください。秘密値は扱いません。"
  }
}
variable "account_backend_ready" {
  type        = bool
  default     = false
  description = "認証必須API・永続保存がイメージに実装済みと確認した場合だけtrue。変数だけでは機能は実装されない。"
}
variable "enable_account_maintenance" {
  type        = bool
  default     = false
  description = "対応イメージ・foundationのSA・dataの権限が揃った時だけ削除JobとSchedulerを有効にする。"
}

variable "account_maintenance_ready" {
  type        = bool
  default     = false
  description = "削除workerを実装し検証した場合だけtrue。通常のログイン・保存とは別に確認する。"
}
