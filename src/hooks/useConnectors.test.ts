import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useConnectors } from "./useConnectors";

/** Minimal stand-in for the preload bridge. Only the connectors calls this hook makes. */
function installBridge(overrides: Record<string, unknown> = {}) {
  const api = {
    connectors: {
      list: vi.fn().mockResolvedValue([]),
      connect: vi.fn().mockResolvedValue([]),
      disconnect: vi.fn().mockResolvedValue([]),
      test: vi.fn().mockResolvedValue({ ok: true }),
      getSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue([]),
      onUpdate: vi.fn().mockReturnValue(() => {}),
      ...overrides,
    },
  };
  (globalThis as unknown as { window: { agentsAPI: unknown } }).window.agentsAPI = api;
  return api;
}

describe("useConnectors error clearing", () => {
  beforeEach(() => {
    installBridge();
  });

  afterEach(() => {
    delete (window as unknown as { agentsAPI?: unknown }).agentsAPI;
    vi.restoreAllMocks();
  });

  it("starts with no error", async () => {
    const { result } = renderHook(() => useConnectors());
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  // U-shape bug: test/getSettings used to leave a stale error from an earlier failed call
  // showing forever, since neither cleared it on entry.
  it("clears a stale error once a later test call succeeds", async () => {
    installBridge({ test: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const { result } = renderHook(() => useConnectors());

    await act(async () => {
      await result.current.test("id");
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    installBridge({ test: vi.fn().mockResolvedValue({ ok: true }) });
    await act(async () => {
      await result.current.test("id");
    });
    expect(result.current.error).toBeNull();
  });

  it("clears a stale error once a later getSettings call succeeds", async () => {
    installBridge({ getSettings: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const { result } = renderHook(() => useConnectors());

    await act(async () => {
      await result.current.getSettings("id");
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    installBridge({ getSettings: vi.fn().mockResolvedValue({}) });
    await act(async () => {
      await result.current.getSettings("id");
    });
    expect(result.current.error).toBeNull();
  });

  it("clears a stale error once a later connect call succeeds", async () => {
    installBridge({ connect: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const { result } = renderHook(() => useConnectors());

    await act(async () => {
      await result.current.connect("id");
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    installBridge({ connect: vi.fn().mockResolvedValue([]) });
    await act(async () => {
      await result.current.connect("id");
    });
    expect(result.current.error).toBeNull();
  });

  it("clearError resets the error directly", async () => {
    installBridge({ test: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const { result } = renderHook(() => useConnectors());

    await act(async () => {
      await result.current.test("id");
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });
});
