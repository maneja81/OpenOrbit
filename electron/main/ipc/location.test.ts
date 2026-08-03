import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function getHandlers(ipcMainHandle: ReturnType<typeof vi.fn>): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  for (const call of ipcMainHandle.mock.calls) {
    handlers[call[0] as string] = call[1] as Handler;
  }
  return handlers;
}

// Each test gets a fresh module instance (and thus a fresh, un-mutated `lastLocation`) —
// registerLocationHandlers/getCurrentLocation share module-level state, which would
// otherwise leak between tests depending on execution order.
async function freshLocationModule() {
  vi.resetModules();
  const electron = await import("electron");
  vi.mocked(electron.ipcMain.handle).mockClear();
  const location = await import("./location");
  location.registerLocationHandlers();
  return { ...location, handlers: getHandlers(electron.ipcMain.handle as ReturnType<typeof vi.fn>) };
}

describe("location IPC handlers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null before any location has been refreshed", async () => {
    const { handlers, getCurrentLocation } = await freshLocationModule();
    expect(await handlers["location:get"](null)).toBeNull();
    expect(getCurrentLocation()).toBeNull();
  });

  it("fetches and caches an IP-based location on refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          latitude: 37.7749,
          longitude: -122.4194,
          city: "San Francisco",
          country: "United States",
        }),
      })
    );
    const { handlers, getCurrentLocation } = await freshLocationModule();

    const result = (await handlers["location:refresh"](null)) as import("./location").LocationData;
    expect(result).toMatchObject({
      latitude: 37.7749,
      longitude: -122.4194,
      city: "San Francisco",
      country: "United States",
    });
    expect(typeof result.capturedAt).toBe("string");
    expect(typeof result.accuracy).toBe("number");

    const stored = await handlers["location:get"](null);
    expect(stored).toEqual(result);
    expect(getCurrentLocation()).toEqual(result);
  });

  it("keeps the previous cached location when a later lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, latitude: 1, longitude: 2, city: "Somewhere", country: "Somewhereland" }),
      })
    );
    const { handlers, getCurrentLocation } = await freshLocationModule();
    await handlers["location:refresh"](null);
    const before = getCurrentLocation();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await handlers["location:refresh"](null);

    expect(result).toEqual(before);
    expect(getCurrentLocation()).toEqual(before);
  });

  it("returns null on refresh when the API responds with success: false and nothing was cached yet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }));
    const { handlers, getCurrentLocation } = await freshLocationModule();

    const result = await handlers["location:refresh"](null);
    expect(result).toBeNull();
    expect(getCurrentLocation()).toBeNull();
  });
});
