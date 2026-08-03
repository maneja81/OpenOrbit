import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useMcpServers } from "./useMcpServers";

/** Minimal stand-in for the preload bridge. Only the mcp calls this hook makes. */
function installBridge(overrides: Record<string, unknown> = {}) {
  const api = {
    mcp: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getEnv: vi.fn().mockResolvedValue({}),
      test: vi.fn().mockResolvedValue({ ok: true }),
      search: vi.fn().mockResolvedValue([]),
      ...overrides,
    },
  };
  (globalThis as unknown as { window: { agentsAPI: unknown } }).window.agentsAPI = api;
  return api;
}

describe("useMcpServers error clearing", () => {
  beforeEach(() => {
    installBridge();
  });

  afterEach(() => {
    delete (window as unknown as { agentsAPI?: unknown }).agentsAPI;
    vi.restoreAllMocks();
  });

  it("starts with no error", async () => {
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  // U-shape bug: testServer/searchRegistry/getEnv used to leave a stale error from an
  // earlier failed call showing forever, since none of the three cleared it on entry.
  it("clears a stale error once a later testServer call succeeds", async () => {
    installBridge({ test: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const { result } = renderHook(() => useMcpServers());

    await act(async () => {
      await result.current.testServer({ name: "n", command: "c" });
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    installBridge({ test: vi.fn().mockResolvedValue({ ok: true }) });
    await act(async () => {
      await result.current.testServer({ name: "n", command: "c" });
    });
    expect(result.current.error).toBeNull();
  });

  it("clears a stale error once a later searchRegistry call succeeds", async () => {
    installBridge({ search: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const { result } = renderHook(() => useMcpServers());

    await act(async () => {
      await result.current.searchRegistry("q");
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    installBridge({ search: vi.fn().mockResolvedValue([]) });
    await act(async () => {
      await result.current.searchRegistry("q");
    });
    expect(result.current.error).toBeNull();
  });

  it("clears a stale error once a later getEnv call succeeds", async () => {
    installBridge({ getEnv: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const { result } = renderHook(() => useMcpServers());

    await act(async () => {
      await result.current.getEnv("id");
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    installBridge({ getEnv: vi.fn().mockResolvedValue({}) });
    await act(async () => {
      await result.current.getEnv("id");
    });
    expect(result.current.error).toBeNull();
  });

  it("clearError resets the error directly", async () => {
    installBridge({ test: vi.fn().mockRejectedValueOnce(new Error("boom")) });
    const { result } = renderHook(() => useMcpServers());

    await act(async () => {
      await result.current.testServer({ name: "n", command: "c" });
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });
});
