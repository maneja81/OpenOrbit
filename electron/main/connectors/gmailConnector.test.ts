import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveConnectorCredentialsMock = vi.fn();
const getDecryptedSettingsMock = vi.fn();
vi.mock("../db/connectorsStore", () => ({
  saveConnectorCredentials: (...args: unknown[]) => saveConnectorCredentialsMock(...args),
  getDecryptedSettings: (...args: unknown[]) => getDecryptedSettingsMock(...args),
}));

const refreshAccessTokenMock = vi.fn();
vi.mock("./oauthFlow", () => ({
  refreshAccessToken: (...args: unknown[]) => refreshAccessTokenMock(...args),
}));

import { buildGmailOAuthConfig, ensureFreshCredentials, testGmailConnection, GMAIL_CONNECTOR_ID } from "./gmailConnector";
import { GOOGLE_ACCOUNT_CONNECTOR_ID } from "./googleAccountConnector";

describe("buildGmailOAuthConfig", () => {
  it("throws a clear error when no Google OAuth client id has been configured", () => {
    expect(() => buildGmailOAuthConfig(null)).toThrow(/Google OAuth client ID isn't set/);
  });

  it("builds a PKCE-only config (no clientSecret) when only a client id is set", () => {
    const config = buildGmailOAuthConfig({ clientId: "client-123" });
    expect(config.clientId).toBe("client-123");
    expect(config.clientSecret).toBeUndefined();
    expect(config.scopes).toContain("https://www.googleapis.com/auth/gmail.send");
  });

  it("uses a configured client secret as-is (already decrypted by the caller)", () => {
    expect(buildGmailOAuthConfig({ clientId: "client-123", clientSecret: "shh" }).clientSecret).toBe("shh");
  });
});

describe("ensureFreshCredentials", () => {
  beforeEach(() => {
    getDecryptedSettingsMock.mockReset();
    getDecryptedSettingsMock.mockReturnValue({ clientId: "client-123" });
    saveConnectorCredentialsMock.mockReset();
    refreshAccessTokenMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the credentials unchanged when there's no expiry recorded", async () => {
    const credentials = { accessToken: "at-1" };
    expect(await ensureFreshCredentials(credentials)).toBe(credentials);
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("returns the credentials unchanged when the access token is still valid", async () => {
    const credentials = { accessToken: "at-1", expiresAt: Date.now() + 60 * 60 * 1000 };
    expect(await ensureFreshCredentials(credentials)).toBe(credentials);
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("refreshes and persists new credentials once the access token has expired", async () => {
    refreshAccessTokenMock.mockResolvedValue({ accessToken: "at-2", expiresAt: Date.now() + 3600_000, scope: "s" });
    const credentials = { accessToken: "at-1", refreshToken: "rt-1", expiresAt: Date.now() - 1000 };

    const fresh = await ensureFreshCredentials(credentials);

    expect(fresh.accessToken).toBe("at-2");
    expect(fresh.refreshToken).toBe("rt-1"); // preserved when the refresh response omits one
    expect(saveConnectorCredentialsMock).toHaveBeenCalledWith(GMAIL_CONNECTOR_ID, "gmail", fresh);
    expect(getDecryptedSettingsMock).toHaveBeenCalledWith(GOOGLE_ACCOUNT_CONNECTOR_ID);
  });

  it("throws instead of refreshing when the access token expired and there's no refresh token", async () => {
    const credentials = { accessToken: "at-1", expiresAt: Date.now() - 1000 };
    await expect(ensureFreshCredentials(credentials)).rejects.toThrow(/reconnect Gmail/);
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("treats a token expiring within the safety margin as already expired", async () => {
    refreshAccessTokenMock.mockResolvedValue({ accessToken: "at-2" });
    const credentials = { accessToken: "at-1", refreshToken: "rt-1", expiresAt: Date.now() + 30_000 };

    await ensureFreshCredentials(credentials);

    expect(refreshAccessTokenMock).toHaveBeenCalled();
  });
});

const fetchMock = vi.fn();

describe("testGmailConnection", () => {
  beforeEach(() => {
    getDecryptedSettingsMock.mockReset();
    getDecryptedSettingsMock.mockReturnValue({ clientId: "client-123" });
    saveConnectorCredentialsMock.mockReset();
    refreshAccessTokenMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the Gmail address as the account label on a successful profile fetch", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ emailAddress: "user@gmail.com" }),
    });
    const result = await testGmailConnection({ accessToken: "at-1" });
    expect(result).toEqual({ label: "user@gmail.com" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/profile"),
      expect.objectContaining({ headers: { Authorization: "Bearer at-1" } })
    );
  });

  it("throws when the profile endpoint returns a non-ok status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    await expect(testGmailConnection({ accessToken: "at-bad" })).rejects.toThrow(/401/);
  });

  it("uses a refreshed token when the stored credentials are expired", async () => {
    refreshAccessTokenMock.mockResolvedValue({ accessToken: "at-refreshed", expiresAt: Date.now() + 3600_000 });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ emailAddress: "user@gmail.com" }),
    });
    const expiredCredentials = { accessToken: "at-old", refreshToken: "rt-1", expiresAt: Date.now() - 1000 };

    await testGmailConnection(expiredCredentials);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: { Authorization: "Bearer at-refreshed" } })
    );
  });
});
