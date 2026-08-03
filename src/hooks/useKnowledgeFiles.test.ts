import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useKnowledgeFiles } from "./useKnowledgeFiles";

/** Minimal stand-in for the preload bridge. Only the knowledgebase calls this hook makes. */
function installBridge(overrides: Record<string, unknown> = {}) {
  const api = {
    knowledgebase: {
      list: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue(undefined),
      sync: vi.fn().mockResolvedValue({ missing: [] }),
      updateCategory: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    },
    fs: { openPath: vi.fn().mockResolvedValue(undefined) },
  };
  (globalThis as unknown as { window: { agentsAPI: unknown } }).window.agentsAPI = api;
  return api;
}

/** A promise you resolve by hand, so an operation can be held mid-flight and the pending state
 * observed while it is genuinely outstanding. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useKnowledgeFiles pending state", () => {
  beforeEach(() => {
    installBridge();
  });

  afterEach(() => {
    delete (window as unknown as { agentsAPI?: unknown }).agentsAPI;
    vi.restoreAllMocks();
  });

  it("starts with nothing pending", async () => {
    const { result } = renderHook(() => useKnowledgeFiles());

    await waitFor(() => expect(result.current.pendingIds.size).toBe(0));
  });

  // U10 — the row's own buttons had no way to know an operation was already running, so an
  // impatient second click queued a duplicate remove or re-sync.
  it("marks a row pending while removeFile is in flight, and clears it after", async () => {
    const gate = deferred<void>();
    installBridge({ remove: vi.fn().mockReturnValue(gate.promise) });
    const { result } = renderHook(() => useKnowledgeFiles());

    let done!: Promise<void>;
    act(() => {
      done = result.current.removeFile(7);
    });

    await waitFor(() => expect(result.current.pendingIds.has(7)).toBe(true));

    await act(async () => {
      gate.resolve();
      await done;
    });

    expect(result.current.pendingIds.has(7)).toBe(false);
  });

  it("marks a row pending while syncOne is in flight", async () => {
    const gate = deferred<{ missing: [] }>();
    installBridge({ sync: vi.fn().mockReturnValue(gate.promise) });
    const { result } = renderHook(() => useKnowledgeFiles());

    let done!: Promise<void>;
    act(() => {
      done = result.current.syncOne(3);
    });

    await waitFor(() => expect(result.current.pendingIds.has(3)).toBe(true));

    await act(async () => {
      gate.resolve({ missing: [] });
      await done;
    });

    expect(result.current.pendingIds.has(3)).toBe(false);
  });

  // The `finally` in track() exists for exactly this: a row whose operation threw must not be
  // left with dead buttons until the component remounts.
  it("releases the row when the operation fails", async () => {
    installBridge({ remove: vi.fn().mockRejectedValue(new Error("nope")) });
    const { result } = renderHook(() => useKnowledgeFiles());

    await act(async () => {
      await result.current.removeFile(11);
    });

    expect(result.current.pendingIds.has(11)).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it("tracks several rows independently", async () => {
    const a = deferred<void>();
    const b = deferred<void>();
    const remove = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    installBridge({ remove });
    const { result } = renderHook(() => useKnowledgeFiles());

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.removeFile(1);
      second = result.current.removeFile(2);
    });

    await waitFor(() => {
      expect(result.current.pendingIds.has(1)).toBe(true);
      expect(result.current.pendingIds.has(2)).toBe(true);
    });

    await act(async () => {
      a.resolve();
      await first;
    });

    // Releasing one must not release the other — a shared boolean would have.
    expect(result.current.pendingIds.has(1)).toBe(false);
    expect(result.current.pendingIds.has(2)).toBe(true);

    await act(async () => {
      b.resolve();
      await second;
    });

    expect(result.current.pendingIds.size).toBe(0);
  });
});
