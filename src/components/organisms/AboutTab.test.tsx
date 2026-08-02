import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import AboutTab from "./AboutTab";
import { THIRD_PARTY_NOTICES } from "@/lib/thirdPartyNotices";
import { APP_LINKS, isPlaceholderLink } from "@/lib/appLinks";

// Unlike the other settings tabs this one has no injected hook — it reads the bridge
// directly — so window.agentsAPI is faked instead. hasAgentsAPI() only checks for presence.
const openExternal = vi.fn();
const revealInFolder = vi.fn();
const clearCache = vi.fn(async () => 0);

function stubBridge() {
  vi.stubGlobal("window", window);
  (window as unknown as { agentsAPI: unknown }).agentsAPI = {
    appInfo: {
      get: vi.fn(async () => ({ packageVersion: "1.0.0", electron: "43.0.0", node: "22.0.0", platform: "darwin" })),
      storage: vi.fn(async () => ({ cacheBytes: 1024, dbBytes: 2048, knowledgeBytes: 512 })),
      stats: vi.fn(async () => ({ messages: 3, agents: 4 })),
      clearCache,
    },
    fs: { openExternal, revealInFolder },
  };
}

describe("AboutTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubBridge();
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as { agentsAPI?: unknown }).agentsAPI;
  });

  it("renders without a bridge rather than throwing", () => {
    delete (window as unknown as { agentsAPI?: unknown }).agentsAPI;
    expect(() => render(<AboutTab sessionElapsedMs={60_000} />)).not.toThrow();
  });

  /** CLAUDE.md's Attribution Conventions: this screen *is* the NOTICE file, so every entry
   * in THIRD_PARTY_NOTICES has to actually reach it. A vendored asset whose entry never
   * renders is the failure this guards. */
  it("lists every third-party notice", () => {
    render(<AboutTab sessionElapsedMs={0} />);
    fireEvent.click(screen.getByText("Legal & Attribution"));

    expect(THIRD_PARTY_NOTICES.length).toBeGreaterThan(0);
    for (const notice of THIRD_PARTY_NOTICES) {
      expect(screen.getAllByText(new RegExp(notice.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).length, notice.name)
        .toBeGreaterThan(0);
    }
  });

  it("reveals a notice's full licence text on demand, and hides it again", () => {
    const notice = THIRD_PARTY_NOTICES[0];
    const { container } = render(<AboutTab sessionElapsedMs={0} />);
    fireEvent.click(screen.getByText("Legal & Attribution"));

    expect(container.querySelectorAll(".about-license-text").length).toBe(0);

    // By role, not text: the app's own licence Row is *labelled* "License" and its button
    // carries the SPDX id instead, so a plain text match hits that label and clicks nothing.
    const toggle = screen.getAllByRole("button", { name: "License" })[0];
    fireEvent.click(toggle);
    expect(container.querySelectorAll(".about-license-text").length).toBe(1);
    expect(container.querySelector(".about-license-text")?.textContent).toBe(notice.licenseText);

    fireEvent.click(screen.getByText("Hide"));
    expect(container.querySelectorAll(".about-license-text").length).toBe(0);
  });

  it("loads version, storage and stats from the bridge", async () => {
    render(<AboutTab sessionElapsedMs={0} />);

    await waitFor(() => {
      const api = (window as unknown as { agentsAPI: { appInfo: { get: ReturnType<typeof vi.fn> } } }).agentsAPI;
      expect(api.appInfo.get).toHaveBeenCalled();
    });
  });

  /** Privacy and Terms have no destination yet. appLinks documents that fs.openExternal
   * *throws* on a non-http(s) URL, so a placeholder must never be handed to it. */
  it("never opens a placeholder link", () => {
    render(<AboutTab sessionElapsedMs={0} />);
    fireEvent.click(screen.getByText("More"));

    const placeholders = (["privacy", "terms"] as const).filter((k) => isPlaceholderLink(APP_LINKS[k]));
    expect(placeholders.length).toBeGreaterThan(0);

    for (const label of ["Privacy Policy", "Terms"]) {
      const button = screen.queryByText(label)?.closest(".row")?.querySelector("button");
      if (button) fireEvent.click(button);
    }

    for (const call of openExternal.mock.calls) {
      expect(isPlaceholderLink(call[0] as string), `opened placeholder ${call[0]}`).toBe(false);
    }
  });

  it("opens a real link through the bridge", () => {
    render(<AboutTab sessionElapsedMs={0} />);
    fireEvent.click(screen.getByText("More"));

    fireEvent.click(screen.getByText("Documentation").closest(".row")!.querySelector("button")!);

    expect(openExternal).toHaveBeenCalledWith(APP_LINKS.docs);
  });
});
