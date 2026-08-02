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
});

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
});
