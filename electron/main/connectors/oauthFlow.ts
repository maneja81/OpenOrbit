import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { shell } from "electron";
import { devLog } from "../devLog";

export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: string;
  /** Absent for a PKCE-only "Desktop app" style OAuth client (Google issues these without
   * requiring a client secret at all — see connectorsStore/registry comments). */
  clientSecret?: string;
}

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // give the user 5 minutes to complete the consent screen

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Generic OAuth2 + PKCE authorization-code flow over a loopback HTTP server, reusable by
 * any connector (not Gmail-specific). Deliberately does NOT use the `grant`/`express`
 * libraries suggested in the 0-cowork reference material — those add three dependencies
 * this app doesn't otherwise need. Everything here is built on primitives already used
 * elsewhere in the codebase: node:http, node:crypto, fetch, and electron.shell.
 *
 * The app's existing `setWindowOpenHandler` (electron/main/index.ts) already routes any
 * `shell.openExternal` call to the user's real system browser and denies an in-app popup
 * — so opening the provider's consent screen this way needs no new window/lockdown work.
 */
export function runOAuthFlow(config: OAuthConfig): Promise<OAuthTokenResponse> {
  const { verifier, challenge } = generatePkce();
  const state = base64Url(randomBytes(16));

  return new Promise((resolve, reject) => {
    let settled = false;
    // Captured once the server starts listening, then reused everywhere — server.address()
    // returns null once the server has been closed, and the callback handler below closes
    // it before it needs the redirect_uri for the token exchange.
    let redirectUri = "";
    const server = createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }

      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const errorParam = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>You can close this window and return to the app.</body></html>");

      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();

      if (errorParam) {
        reject(new Error(`OAuth authorization was denied or failed: ${errorParam}`));
        return;
      }
      if (returnedState !== state || !code) {
        reject(new Error("OAuth callback failed a security check (state mismatch or missing code)."));
        return;
      }

      exchangeCodeForTokens(config, code, verifier, redirectUri)
        .then(resolve)
        .catch(reject);
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      reject(new Error("OAuth flow timed out waiting for the browser consent step."));
    }, CALLBACK_TIMEOUT_MS);

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const authorizeUrl = new URL(config.authorizeUrl);
      authorizeUrl.searchParams.set("client_id", config.clientId);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", config.scopes.join(" "));
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("code_challenge", challenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      authorizeUrl.searchParams.set("access_type", "offline");
      authorizeUrl.searchParams.set("prompt", "consent");

      devLog(`[oauthFlow] opening system browser for authorization (redirect_uri=${redirectUri})`);
      shell.openExternal(authorizeUrl.toString());
    });
  });
}

async function exchangeCodeForTokens(
  config: OAuthConfig,
  code: string,
  verifier: string,
  redirectUri: string
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scope: data.scope,
  };
}

/** Exchanges a stored refresh token for a fresh access token. Used by a connector's tools
 * right before making an API call whenever the stored access token has expired — see
 * gmailConnector.ts's ensureFreshCredentials. */
export async function refreshAccessToken(config: OAuthConfig, refreshToken: string): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Token refresh failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { access_token: string; expires_in?: number; scope?: string };
  return {
    accessToken: data.access_token,
    refreshToken, // refresh_token grant doesn't usually return a new one — keep the existing one
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scope: data.scope,
  };
}
