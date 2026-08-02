import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const drive = vi.fn();
const destroy = vi.fn();
const driverFactory = vi.fn(() => ({ drive, destroy }));

vi.mock("driver.js", () => ({ driver: (...args: unknown[]) => driverFactory(...(args as [])) }));
vi.mock("driver.js/dist/driver.css", () => ({}));

import { useTour } from "./useTour";

function options(overrides: Partial<Parameters<typeof useTour>[0]> = {}) {
  return {
    tourCompleted: false,
    onboardingVisible: false,
    loaded: true,
    updateSettings: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    ...overrides,
  };
}

describe("useTour auto-start", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    driverFactory.mockClear();
    drive.mockClear();
    destroy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not start while onboarding is on screen", () => {
    // The regression this guards: none of the tour's targets exist during onboarding, and
    // skipMissingElement:true meant every step was skipped and the tour marked itself
    // complete — so a brand-new user never saw it.
    const updateSettings = vi.fn();
    renderHook(() => useTour(options({ onboardingVisible: true, updateSettings })));

    vi.advanceTimersByTime(10_000);

    expect(driverFactory).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("starts once onboarding hands off to the orbit scene", () => {
    const { rerender } = renderHook((props: { onboardingVisible: boolean }) => useTour(options(props)), {
      initialProps: { onboardingVisible: true },
    });
    vi.advanceTimersByTime(10_000);
    expect(driverFactory).not.toHaveBeenCalled();

    rerender({ onboardingVisible: false });

    // Longer delay than a normal launch: the orbit entrance staggers widget cards in from
    // opacity 0 for ~1.7s, and highlighting them before that lands on invisible elements.
    vi.advanceTimersByTime(1000);
    expect(driverFactory).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(driverFactory).toHaveBeenCalledTimes(1);
    expect(drive).toHaveBeenCalledTimes(1);
  });

  it("starts promptly when the scene is already mounted", () => {
    renderHook(() => useTour(options()));

    vi.advanceTimersByTime(500);

    expect(driverFactory).toHaveBeenCalledTimes(1);
  });

  it("does not auto-start when the tour is already completed", () => {
    renderHook(() => useTour(options({ tourCompleted: true })));

    vi.advanceTimersByTime(10_000);

    expect(driverFactory).not.toHaveBeenCalled();
  });

  it("does not auto-start before settings have loaded", () => {
    renderHook(() => useTour(options({ loaded: false })));

    vi.advanceTimersByTime(10_000);

    expect(driverFactory).not.toHaveBeenCalled();
  });

  it("replays on demand even after the tour was completed", () => {
    const { result } = renderHook(() => useTour(options({ tourCompleted: true })));

    result.current.startTour();

    expect(driverFactory).toHaveBeenCalledTimes(1);
    expect(drive).toHaveBeenCalledTimes(1);
  });

  it("destroys a live tour before starting a replay, so overlays can't stack", () => {
    const { result } = renderHook(() => useTour(options({ tourCompleted: true })));

    result.current.startTour();
    result.current.startTour();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(driverFactory).toHaveBeenCalledTimes(2);
  });
});
