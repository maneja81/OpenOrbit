import { describe, expect, it, vi, beforeEach } from "vitest";

const saveConnectorCredentialsMock = vi.hoisted(() => vi.fn());
const getDecryptedSettingsMock = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("../db/connectorsStore", () => ({
  saveConnectorCredentials: saveConnectorCredentialsMock,
  getDecryptedSettings: getDecryptedSettingsMock,
}));

const refreshAccessTokenMock = vi.hoisted(() => vi.fn());
vi.mock("./oauthFlow", () => ({ refreshAccessToken: refreshAccessTokenMock }));

vi.mock("../devLog", () => ({ devLog: vi.fn() }));

import { makeEnsureFreshCredentials } from "./googleOAuth";
import type { ConnectorCredentials } from "../db/connectorsStore";

const buildConfig = () => ({ authorizeUrl: "", tokenUrl: "", scopes: [], clientId: "x" });

beforeEach(() => {
  saveConnectorCredentialsMock.mockReset();
  getDecryptedSettingsMock.mockReset().mockReturnValue({});
  refreshAccessTokenMock.mockReset();
});

describe("makeEnsureFreshCredentials", () => {
  it("returns the credentials unchanged when not yet expired", async () => {
    const ensureFreshCredentials = makeEnsureFreshCredentials("gmail", "gmail", buildConfig, "Gmail");
    const credentials: ConnectorCredentials = {
      accessToken: "tok",
      refreshToken: "refresh",
      expiresAt: Date.now() + 10 * 60_000,
      scope: "s",
    };

    const result = await ensureFreshCredentials(credentials);

    expect(result).toEqual(credentials);
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("refreshes when the token is actually expired", async () => {
    refreshAccessTokenMock.mockResolvedValue({ accessToken: "new-tok", expiresAt: Date.now() + 3600_000 });
    const ensureFreshCredentials = makeEnsureFreshCredentials("gmail", "gmail", buildConfig, "Gmail");
    const credentials: ConnectorCredentials = {
      accessToken: "old-tok",
      refreshToken: "refresh",
      expiresAt: Date.now() - 1000,
      scope: "s",
    };

    const result = await ensureFreshCredentials(credentials);

    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(result.accessToken).toBe("new-tok");
    expect(saveConnectorCredentialsMock).toHaveBeenCalledTimes(1);
  });

  // KI-10: expiresAt === undefined used to make isExpired false, so a token response missing
  // expires_in converted into a credential that refreshes only once, ever, and then fails
  // every subsequent call with a 401 until the user manually reconnects.
  it("treats a missing expiresAt as expired rather than valid forever", async () => {
    refreshAccessTokenMock.mockResolvedValue({ accessToken: "new-tok", expiresAt: undefined });
    const ensureFreshCredentials = makeEnsureFreshCredentials("gmail", "gmail", buildConfig, "Gmail");
    const credentials: ConnectorCredentials = {
      accessToken: "old-tok",
      refreshToken: "refresh",
      expiresAt: undefined,
      scope: "s",
    };

    const result = await ensureFreshCredentials(credentials);

    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(result.accessToken).toBe("new-tok");
  });

  it("throws when expired with no refresh token available", async () => {
    const ensureFreshCredentials = makeEnsureFreshCredentials("gmail", "gmail", buildConfig, "Gmail");
    const credentials: ConnectorCredentials = {
      accessToken: "old-tok",
      refreshToken: undefined,
      expiresAt: Date.now() - 1000,
      scope: "s",
    };

    await expect(ensureFreshCredentials(credentials)).rejects.toThrow(/reconnect Gmail/);
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });
});
