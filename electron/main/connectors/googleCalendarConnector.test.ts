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

import { testCalendarConnection } from "./googleCalendarConnector";

const fetchMock = vi.fn();

describe("testCalendarConnection", () => {
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

  it("returns the first calendar id as the account label on success", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: "user@gmail.com" }] }),
    });
    const result = await testCalendarConnection({ accessToken: "at-1" });
    expect(result).toEqual({ label: "user@gmail.com" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/calendarList"),
      expect.objectContaining({ headers: { Authorization: "Bearer at-1" } })
    );
  });

  it("returns an undefined label when the calendar list is empty", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    const result = await testCalendarConnection({ accessToken: "at-1" });
    expect(result).toEqual({ label: undefined });
  });

  it("throws with status on a non-ok response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    await expect(testCalendarConnection({ accessToken: "at-bad" })).rejects.toThrow(/401/);
  });

  it("uses a refreshed token when the stored credentials are expired", async () => {
    refreshAccessTokenMock.mockResolvedValue({ accessToken: "at-refreshed", expiresAt: Date.now() + 3600_000 });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: "user@gmail.com" }] }),
    });
    const expiredCredentials = { accessToken: "at-old", refreshToken: "rt-1", expiresAt: Date.now() - 1000 };

    await testCalendarConnection(expiredCredentials);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: { Authorization: "Bearer at-refreshed" } })
    );
  });
});
