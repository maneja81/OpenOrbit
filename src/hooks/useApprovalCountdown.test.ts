import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useApprovalCountdown } from "./useApprovalCountdown";

const T0 = 1_800_000_000_000; // fixed, whole-second epoch so quantisation is exact

describe("useApprovalCountdown", () => {
  beforeEach(() => {
    // `Date` must be in toFake — advancing timers alone does not move Date.now(), and a hook
    // that reads the wall clock would then never appear to count down.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when there is no deadline", () => {
    const { result } = renderHook(() => useApprovalCountdown(null));

    expect(result.current).toBeNull();
  });

  it("reports the time remaining", () => {
    const { result } = renderHook(() => useApprovalCountdown(T0 + 5000));

    expect(result.current).toBe(5000);
  });

  it("counts down as the clock advances", () => {
    const { result } = renderHook(() => useApprovalCountdown(T0 + 5000));

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current).toBe(3000);
  });

  it("goes negative once the deadline has passed", () => {
    const { result } = renderHook(() => useApprovalCountdown(T0 + 2000));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current).toBeLessThanOrEqual(0);
  });

  // Without re-reading on render, the first tick after a new approval arrives still showed the
  // previous one's remaining time.
  it("re-reads immediately when the deadline changes", () => {
    const { result, rerender } = renderHook(({ at }) => useApprovalCountdown(at), {
      initialProps: { at: T0 + 60_000 } as { at: number | null },
    });

    expect(result.current).toBe(60_000);

    act(() => {
      rerender({ at: T0 + 3000 });
    });

    expect(result.current).toBe(3000);
  });

  it("drops back to null when the deadline is removed", () => {
    const { result, rerender } = renderHook(({ at }) => useApprovalCountdown(at), {
      initialProps: { at: T0 + 5000 } as { at: number | null },
    });

    expect(result.current).not.toBeNull();

    act(() => {
      rerender({ at: null });
    });

    expect(result.current).toBeNull();
  });

  it("stops polling once unmounted", () => {
    const { unmount } = renderHook(() => useApprovalCountdown(T0 + 5000));

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
