import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useHttpTools } from "./useHttpTools";

/** Minimal stand-in for the preload bridge. Only the httpTools calls this hook makes. */
function installBridge(overrides: Record<string, unknown> = {}) {
  const api = {
    httpTools: {
      listCollections: vi.fn().mockResolvedValue([]),
      listTools: vi.fn().mockResolvedValue([]),
      createCollection: vi.fn(),
      updateCollection: vi.fn(),
      deleteCollection: vi.fn(),
      createTool: vi.fn(),
      updateTool: vi.fn(),
      deleteTool: vi.fn(),
      getCollectionHeaders: vi.fn().mockResolvedValue({}),
      getToolHeaders: vi.fn().mockResolvedValue({}),
      testTool: vi.fn().mockResolvedValue({ ok: true }),
      ...overrides,
    },
  };
  (globalThis as unknown as { window: { agentsAPI: unknown } }).window.agentsAPI = api;
  return api;
}

describe("useHttpTools error clearing", () => {
  beforeEach(() => {
    installBridge();
  });

  afterEach(() => {
    delete (window as unknown as { agentsAPI?: unknown }).agentsAPI;
    vi.restoreAllMocks();
  });

  it("starts with no error", async () => {
    const { result } = renderHook(() => useHttpTools());
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  // U-shape bug: getCollectionHeaders/getToolHeaders used to leave a stale error from an
  // earlier failed testTool call showing forever, since only testTool cleared it on entry.
  it("clears a stale error once a later testTool call succeeds", async () => {
    installBridge({ testTool: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const { result } = renderHook(() => useHttpTools());

    await act(async () => {
      await result.current.testTool({ baseUrl: "https://example.com" });
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    installBridge({ testTool: vi.fn().mockResolvedValue({ ok: true }) });
    await act(async () => {
      await result.current.testTool({ baseUrl: "https://example.com" });
    });
    expect(result.current.error).toBeNull();
  });

  it("clears a stale error once a later getCollectionHeaders call succeeds", async () => {
    installBridge({ getCollectionHeaders: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const { result } = renderHook(() => useHttpTools());

    await act(async () => {
      await result.current.getCollectionHeaders("id");
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    installBridge({ getCollectionHeaders: vi.fn().mockResolvedValue({}) });
    await act(async () => {
      await result.current.getCollectionHeaders("id");
    });
    expect(result.current.error).toBeNull();
  });

  it("clears a stale error once a later getToolHeaders call succeeds", async () => {
    installBridge({ getToolHeaders: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const { result } = renderHook(() => useHttpTools());

    await act(async () => {
      await result.current.getToolHeaders("id");
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    installBridge({ getToolHeaders: vi.fn().mockResolvedValue({}) });
    await act(async () => {
      await result.current.getToolHeaders("id");
    });
    expect(result.current.error).toBeNull();
  });

  it("clearError resets the error directly", async () => {
    installBridge({ testTool: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const { result } = renderHook(() => useHttpTools());

    await act(async () => {
      await result.current.testTool({ baseUrl: "https://example.com" });
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });
});
