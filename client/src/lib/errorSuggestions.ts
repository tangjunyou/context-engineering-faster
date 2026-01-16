export function getSuggestionForErrorCode(
  errorCode: string | null,
  t: (key: string, vars?: Record<string, unknown>) => string
): string | null {
  switch (errorCode) {
    case "resolver_missing":
      return t("preview.suggestResolverMissing");
    case "readonly_required":
      return t("preview.suggestReadonlyRequired");
    case "decrypt_failed":
      return t("preview.suggestDecryptFailed");
    case "unsupported_scheme":
      return t("preview.suggestUnsupportedScheme");
    case "feature_not_enabled":
      return t("preview.suggestFeatureNotEnabled");
    case "invalid_url":
      return t("preview.suggestInvalidUrl");
    case "connect_failed":
      return t("preview.suggestConnectFailed");
    case "sqlite_open_failed":
      return t("preview.suggestSqliteOpenFailed");
    default:
      return null;
  }
}
