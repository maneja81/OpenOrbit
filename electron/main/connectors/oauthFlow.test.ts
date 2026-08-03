import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

const openExternalMock = vi.fn();
vi.mock("electron", () => ({
  shell: { openExternal: (url: string) => openExternalMock(url) },
}));

import { runOAuthFlow, refreshAccessToken } from "./oauthFlow";

/** A tiny fake OAuth token endpoint — accepts any POST and returns canned tokens, so tests
 * don't depend on a real provider. Started/stopped per test. */
function startFakeTokenServer(response: Record<string, unknown>): Promise<{ url: string; close: () => Promise<void>; requests: URLSearchParams[] }> {
  const requests: URLSearchParams[] = [];
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push(new URLSearchParams(body));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/token`,
        close: () => new Promise((r) => server.close(() => r())),
        requests,
      });
    });
  });
}

describe("runOAuthFlow", () => {
  let tokenServer: Awaited<ReturnType<typeof startFakeTokenServer>> | null = null;

  afterEach(async () => {
    openExternalMock.mockReset();
    if (tokenServer) await tokenServer.close();
    tokenServer = null;
  });

  it("opens the authorize URL with PKCE params via shell.openExternal, then exchanges the callback code for tokens", async () => {
    tokenServer = await startFakeTokenServer({
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_in: 3600,
      scope: "gmail.send",
    });

    openExternalMock.mockImplementation((authorizeUrl: string) => {
      const parsed = new URL(authorizeUrl);
      expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
      expect(parsed.searchParams.get("code_challenge")).toBeTruthy();
      expect(parsed.searchParams.get("client_id")).toBe("client-123");
      const redirectUri = parsed.searchParams.get("redirect_uri")!;
      const state = parsed.searchParams.get("state")!;
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", "auth-code-1");
      callbackUrl.searchParams.set("state", state);
      // Simulate the browser hitting our loopback callback after the user approves.
      fetch(callbackUrl.toString());
    });

    const before = Date.now();
    const tokens = await runOAuthFlow({
      authorizeUrl: "https://example.com/authorize",
      tokenUrl: tokenServer.url,
      scopes: ["scope-a", "scope-b"],
      clientId: "client-123",
    });

    expect(tokens.accessToken).toBe("at-1");
    expect(tokens.refreshToken).toBe("rt-1");
    expect(tokens.scope).toBe("gmail.send");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);

    expect(tokenServer.requests).toHaveLength(1);
    expect(tokenServer.requests[0].get("grant_type")).toBe("authorization_code");
    expect(tokenServer.requests[0].get("code")).toBe("auth-code-1");
    expect(tokenServer.requests[0].get("code_verifier")).toBeTruthy();
  });

  it("rejects when the callback reports an OAuth error", async () => {
    openExternalMock.mockImplementation((authorizeUrl: string) => {
      const parsed = new URL(authorizeUrl);
      const redirectUri = parsed.searchParams.get("redirect_uri")!;
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("error", "access_denied");
      fetch(callbackUrl.toString());
    });

    await expect(
      runOAuthFlow({
        authorizeUrl: "https://example.com/authorize",
        tokenUrl: "http://127.0.0.1:1/token",
        scopes: ["scope-a"],
        clientId: "client-123",
      })
    ).rejects.toThrow(/denied or failed/);
  });

  it("rejects on a state mismatch (missing/incorrect state)", async () => {
    openExternalMock.mockImplementation((authorizeUrl: string) => {
      const parsed = new URL(authorizeUrl);
      const redirectUri = parsed.searchParams.get("redirect_uri")!;
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", "auth-code-1");
      callbackUrl.searchParams.set("state", "wrong-state");
      fetch(callbackUrl.toString());
    });

    await expect(
      runOAuthFlow({
        authorizeUrl: "https://example.com/authorize",
        tokenUrl: "http://127.0.0.1:1/token",
        scopes: ["scope-a"],
        clientId: "client-123",
      })
    ).rejects.toThrow(/security check/);
  });

  // KI-20: the callback used to write the 200/success HTML before validating state/code, so
  // a failed check rejected the flow in the app while the browser still showed success.
  // Also asserts the security headers on the response the browser actually receives, since
  // its URL carries the authorization code.
  it("tells the browser the callback failed, not succeeded, on a security-check failure", async () => {
    let callbackFetch: Promise<Response> | undefined;
    openExternalMock.mockImplementation((authorizeUrl: string) => {
      const parsed = new URL(authorizeUrl);
      const redirectUri = parsed.searchParams.get("redirect_uri")!;
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", "auth-code-1");
      callbackUrl.searchParams.set("state", "wrong-state");
      callbackFetch = fetch(callbackUrl.toString());
    });

    await expect(
      runOAuthFlow({
        authorizeUrl: "https://example.com/authorize",
        tokenUrl: "http://127.0.0.1:1/token",
        scopes: ["scope-a"],
        clientId: "client-123",
      })
    ).rejects.toThrow(/security check/);

    const callbackResponse = await callbackFetch!;
    const body = await callbackResponse.text();
    expect(body).toContain("went wrong");
    expect(callbackResponse.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(callbackResponse.headers.get("Cache-Control")).toBe("no-store");
  });

  it("tells the browser the callback succeeded, with the same security headers, on a valid callback", async () => {
    let callbackFetch: Promise<Response> | undefined;
    tokenServer = await startFakeTokenServer({ access_token: "at-1", expires_in: 3600 });
    openExternalMock.mockImplementation((authorizeUrl: string) => {
      const parsed = new URL(authorizeUrl);
      const redirectUri = parsed.searchParams.get("redirect_uri")!;
      const state = parsed.searchParams.get("state")!;
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", "auth-code-1");
      callbackUrl.searchParams.set("state", state);
      callbackFetch = fetch(callbackUrl.toString());
    });

    await runOAuthFlow({
      authorizeUrl: "https://example.com/authorize",
      tokenUrl: tokenServer.url,
      scopes: ["scope-a"],
      clientId: "client-123",
    });

    const callbackResponse = await callbackFetch!;
    const body = await callbackResponse.text();
    expect(body).toContain("close this window");
    expect(body).not.toContain("went wrong");
    expect(callbackResponse.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(callbackResponse.headers.get("Cache-Control")).toBe("no-store");
  });

  // KI-21: same reasoning as refreshAccessToken's equivalent test — the token endpoint's raw
  // error body must not reach the thrown Error, since this path is agent-reachable.
  it("throws only the status, not the raw response body, on a failed code exchange", async () => {
    const errorServer = await startFakeErrorTokenServer(400, "client_secret=super-secret-value&leaked=true");
    openExternalMock.mockImplementation((authorizeUrl: string) => {
      const parsed = new URL(authorizeUrl);
      const redirectUri = parsed.searchParams.get("redirect_uri")!;
      const state = parsed.searchParams.get("state")!;
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", "auth-code-1");
      callbackUrl.searchParams.set("state", state);
      fetch(callbackUrl.toString());
    });

    try {
      const error = await runOAuthFlow({
        authorizeUrl: "https://example.com/authorize",
        tokenUrl: errorServer.url,
        scopes: ["scope-a"],
        clientId: "client-123",
      }).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Token exchange failed (400).");
      expect((error as Error).message).not.toContain("super-secret-value");
    } finally {
      await errorServer.close();
    }
  });
});

/** A fake token endpoint that always answers with `status` and `body` — for exercising the
 * error path, where the real endpoint's raw response must not reach the thrown Error. */
function startFakeErrorTokenServer(status: number, body: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(status, { "Content-Type": "text/plain" });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}/token`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe("refreshAccessToken", () => {
  it("exchanges a refresh token for a fresh access token", async () => {
    const tokenServer = await startFakeTokenServer({ access_token: "at-2", expires_in: 1800, scope: "gmail.send" });
    try {
      const tokens = await refreshAccessToken(
        { authorizeUrl: "https://example.com/authorize", tokenUrl: tokenServer.url, scopes: [], clientId: "client-123" },
        "rt-1"
      );
      expect(tokens.accessToken).toBe("at-2");
      expect(tokenServer.requests[0].get("grant_type")).toBe("refresh_token");
      expect(tokenServer.requests[0].get("refresh_token")).toBe("rt-1");
    } finally {
      await tokenServer.close();
    }
  });

  // KI-21: the raw response body used to be embedded in the thrown message. connect_connector
  // (ai/agents.ts) is agent-callable, so that message reaches the model's context — a
  // provider's error body can echo request parameters, which isn't something that needs to
  // reach an LLM.
  it("throws only the status, not the raw response body, on a failed refresh", async () => {
    const errorServer = await startFakeErrorTokenServer(400, "client_secret=super-secret-value&leaked=true");
    try {
      const error = await refreshAccessToken(
        { authorizeUrl: "https://example.com/authorize", tokenUrl: errorServer.url, scopes: [], clientId: "client-123" },
        "rt-1"
      ).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Token refresh failed (400).");
      expect((error as Error).message).not.toContain("super-secret-value");
    } finally {
      await errorServer.close();
    }
  });
});
