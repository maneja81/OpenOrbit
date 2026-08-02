import { useCallback, useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { TOUR_STEPS } from "@/lib/tourSteps";
import { AgentsSettings } from "@/lib/settings";
import type { SettingsSection } from "@/components/organisms/SettingsPanel";

interface UseTourOptions {
  tourCompleted: boolean;
  /** True while OnboardingScreen is rendered instead of the orbit scene. None of the tour's
   * targets exist then, so starting would skip every step and mark the tour done. */
  onboardingVisible: boolean;
  loaded: boolean;
  updateSettings: (patch: Partial<AgentsSettings>) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
}

const TOUR_START_DELAY_MS = 300;

/** Handing off from onboarding starts the orbit entrance: widget cards stagger in on
 * animation-delay up to 1.2s plus a 0.5s run (see #widgets-*.entering in globals.css) and
 * begin at opacity 0. Starting the tour on the usual short delay would highlight cards that
 * are still invisible and still moving. */
const TOUR_START_AFTER_ONBOARDING_DELAY_MS = 1800;

export function useTour({
  tourCompleted,
  onboardingVisible,
  loaded,
  updateSettings,
  openSettings,
  closeSettings,
}: UseTourOptions): { startTour: () => void } {
  const startedRef = useRef(false);
  const cameFromOnboardingRef = useRef(false);
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);

  const runTour = useCallback(() => {
    const markDone = () => updateSettings({ tourCompleted: true });
    try {
      // A replay requested while a tour is still open would otherwise stack a second
      // driver.js overlay on top of the first, leaving the old one unreachable.
      driverRef.current?.destroy();
      const tourDriver = driver({
        allowClose: true,
        showProgress: true,
        skipMissingElement: true,
        steps: TOUR_STEPS.map((step) => ({
          element: step.element,
          popover: { title: step.title, description: step.description },
          onHighlightStarted: () => (step.settingsSection ? openSettings(step.settingsSection) : closeSettings()),
        })),
        onDestroyStarted: () => {
          markDone();
          tourDriver.destroy();
          driverRef.current = null;
        },
      });
      driverRef.current = tourDriver;
      tourDriver.drive();
    } catch {
      driverRef.current = null;
      markDone();
    }
  }, [updateSettings, openSettings, closeSettings]);

  useEffect(() => {
    if (startedRef.current) return;
    if (!loaded || tourCompleted) return;
    // Wait for onboarding to hand off rather than giving up: this effect re-runs when
    // onboardingVisible flips, and startedRef is still false, so the tour starts then.
    if (onboardingVisible) {
      cameFromOnboardingRef.current = true;
      return;
    }
    startedRef.current = true;

    // No cleanup returned here on purpose: React 19 StrictMode double-invokes this
    // effect on initial mount (mount → cleanup → mount again in dev). startedRef
    // already guards against running the tour twice; if we cancelled this timer on
    // the simulated unmount, the second invocation would see startedRef already true
    // and skip re-arming it, so the tour would never fire. Matches the no-cleanup
    // ref-guard pattern used by the startup-SFX effect above.
    window.setTimeout(
      runTour,
      cameFromOnboardingRef.current ? TOUR_START_AFTER_ONBOARDING_DELAY_MS : TOUR_START_DELAY_MS
    );
  }, [loaded, tourCompleted, onboardingVisible, runTour]);

  // Replay path: no startedRef/tourCompleted gate (that's what makes it a replay) and no
  // start delay, since the UI is already mounted by the time a user can ask for it.
  return { startTour: runTour };
}
