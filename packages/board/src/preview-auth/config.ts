const BOOTSTRAP_TOKEN_RE = /^comt_[0-9a-f]{64}$/;

export function isBootstrapTokenFormat(token: string): boolean {
  return BOOTSTRAP_TOKEN_RE.test(token);
}

export function readPreviewAuthConfig() {
  const bootstrapToken = process.env.COMITIA_BOOTSTRAP_TOKEN?.trim();
  const enabled = Boolean(
    bootstrapToken && isBootstrapTokenFormat(bootstrapToken),
  );

  return {
    enabled,
    bootstrapToken: enabled ? bootstrapToken! : undefined,
    ownerDisplayName:
      process.env.COMITIA_BOOTSTRAP_OWNER_NAME?.trim() || "Preview",
    projectName:
      process.env.COMITIA_BOOTSTRAP_PROJECT_NAME?.trim() || "preview",
  };
}
