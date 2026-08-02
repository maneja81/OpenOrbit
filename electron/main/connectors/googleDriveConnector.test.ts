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

import { testDriveConnection } from "./googleDriveConnector";

const fetchMock = vi.fn();

describe("testDriveConnection", () => {
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

  it("returns the account email as the label on success", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ user: { emailAddress: "user@gmail.com" } }),
    });
    const result = await testDriveConnection({ accessToken: "at-1" });
    expect(result).toEqual({ label: "user@gmail.com" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/about"),
      expect.objectContaining({ headers: { Authorization: "Bearer at-1" } })
    );
  });

  it("throws with status on a non-ok response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });
    await expect(testDriveConnection({ accessToken: "at-bad" })).rejects.toThrow(/403/);
  });

  it("uses a refreshed token when the stored credentials are expired", async () => {
    refreshAccessTokenMock.mockResolvedValue({ accessToken: "at-refreshed", expiresAt: Date.now() + 3600_000 });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ user: { emailAddress: "user@gmail.com" } }),
    });
    const expiredCredentials = { accessToken: "at-old", refreshToken: "rt-1", expiresAt: Date.now() - 1000 };

    await testDriveConnection(expiredCredentials);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: { Authorization: "Bearer at-refreshed" } })
    );
  });
});
