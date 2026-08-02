import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SettingsPanel from "./SettingsPanel";
import { mergeWithDefaults } from "@/lib/settings";

// vitest runs with globals: false, so RTL cannot register its own cleanup.
afterEach(cleanup);

// jsdom has no layout, and Combobox scrolls its active row into view on mount.
Element.prototype.scrollIntoView = vi.fn();

// The four data hooks this panel uses all guard on hasAgentsAPI(), which is false under jsdom,
// so they no-op and need no mocking — only the props below.
function renderDangerZone(onReset: () => Promise<void>) {
  render(
    <SettingsPanel
      open
      initialSection="danger"
      onClose={vi.fn()}
      settings={mergeWithDefaults({})}
      sessionElapsedMs={0}
      onUpdate={vi.fn()}
      onReset={onReset}
      agents={[]}
      onUpdateAgent={vi.fn()}
      onCreateAgent={vi.fn()}
      onDeleteAgent={vi.fn()}
      onExportAgent={vi.fn()}
      onExportAllAgents={vi.fn()}
      onImportAgents={vi.fn()}
    />
  );
  // Mounting already-open leaves activeSection at its default: sectionOnTransition only fires
  // on the closed→open edge, which in the real app is how the panel always arrives. Navigate
  // the way a user does instead.
  // The sidebar items are role="tab", not buttons.
  fireEvent.click(screen.getByRole("tab", { name: /Danger Zone/i }));
  const input = screen.getByPlaceholderText("RESET") as HTMLInputElement;
  const button = screen.getByRole("button", { name: /Reset to Default/i });
  return { input, button };
}

describe("Danger Zone reset", () => {
  it("stays disabled until the confirmation word is typed exactly", () => {
    const { input, button } = renderDangerZone(vi.fn());
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: "reset" } });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: "RESET" } });
    expect(button).toBeEnabled();
  });

  it("calls onReset once when confirmed", async () => {
    const onReset = vi.fn().mockResolvedValue(undefined);
    const { input, button } = renderDangerZone(onReset);
    fireEvent.change(input, { target: { value: "RESET" } });
    fireEvent.click(button);
    await waitFor(() => expect(onReset).toHaveBeenCalledExactlyOnceWith());
  });

  describe("when the reset fails", () => {
    // settings:reset drops every app table inside a transaction and re-runs migrations. It can
    // genuinely fail — most plausibly SQLITE_BUSY, since the userData database is shared across
    // worktrees and a second running instance holds a write lock.
    const failing = () => vi.fn().mockRejectedValue(new Error("database is locked"));

    it("re-enables the button instead of leaving it on Resetting… forever", async () => {
      const { input, button } = renderDangerZone(failing());
      fireEvent.change(input, { target: { value: "RESET" } });
      fireEvent.click(button);
      await waitFor(() => expect(button).toBeEnabled());
      expect(button).toHaveTextContent(/Reset to Default/i);
    });

    it("tells the user what went wrong", async () => {
      // It used to say nothing at all — the rejection was unhandled and invisible.
      const { input, button } = renderDangerZone(failing());
      fireEvent.change(input, { target: { value: "RESET" } });
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByText(/database is locked/i)).toBeInTheDocument());
    });

    it("lets the user try again", async () => {
      const onReset = failing();
      const { input, button } = renderDangerZone(onReset);
      fireEvent.change(input, { target: { value: "RESET" } });
      fireEvent.click(button);
      await waitFor(() => expect(button).toBeEnabled());

      fireEvent.click(button);
      await waitFor(() => expect(onReset).toHaveBeenCalledTimes(2));
    });

    it("clears the previous error when retried", async () => {
      const onReset = vi.fn().mockRejectedValueOnce(new Error("database is locked")).mockResolvedValue(undefined);
      const { input, button } = renderDangerZone(onReset);
      fireEvent.change(input, { target: { value: "RESET" } });
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByText(/database is locked/i)).toBeInTheDocument());

      fireEvent.click(button);
      await waitFor(() => expect(screen.queryByText(/database is locked/i)).not.toBeInTheDocument());
    });

    it("does not report failure when the reset succeeds", async () => {
      const { input, button } = renderDangerZone(vi.fn().mockResolvedValue(undefined));
      fireEvent.change(input, { target: { value: "RESET" } });
      fireEvent.click(button);
      // Stays disabled on success — onReset reloads the window, and re-enabling would invite a
      // second click against a database mid-rebuild.
      await waitFor(() => expect(button).toBeDisabled());
      expect(screen.queryByText(/settings-error/i)).not.toBeInTheDocument();
    });
  });
});
