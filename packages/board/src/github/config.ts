export function readGitHubConfig() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const appSlug = process.env.GITHUB_APP_SLUG;
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const publicUrl = process.env.BOARD_PUBLIC_URL;

  const installationReady = Boolean(
    appId && privateKey && appSlug && webhookSecret,
  );
  const oauthEnabled = Boolean(clientId && clientSecret);

  return {
    appId,
    privateKey,
    appSlug,
    clientId,
    clientSecret,
    webhookSecret,
    publicUrl,
    installationReady,
    oauthEnabled,
    isConfigured: installationReady && oauthEnabled,
  };
}
