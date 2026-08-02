import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProviders } from "./useProviders";

/**
 * The Chat slot's URL and key stopped living in the settings table once a provider is selected.
 * A Settings screen still bound to `chatApiUrl`/`chatApiKeySet` therefore rendered a blank URL
 * and claimed no key was saved, while the app ran perfectly well on credentials it could not
 * see — reported from real use, and the reason this hook exists.
 */
describe("useProviders.chatSlot", () => {
  const list = vi.fn();

  beforeEach(() => {
    list.mockReset().mockResolvedValue({
      catalog: [],
      configured: [
        { id: "anthropic", apiUrl: "https://api.anthropic.com/v1", keySet: true },
        { id: "local", apiUrl: "http://localhost:11434/v1", keySet: false },
      ],
    });
    vi.stubGlobal("agentsAPI", { providers: { list, selectChat: vi.fn() } });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("reads the configured provider rather than the legacy settings", async () => {
    const { result } = renderHook(() => useProviders(true));
    await waitFor(() => expect(list).toHaveBeenCalled());

    // The legacy values passed in are deliberately empty — which is exactly what they hold after
    // onboarding writes a provider, and what used to be rendered.
    const slot = result.current.chatSlot("anthropic", "", false);
    expect(slot).toEqual({
      providerId: "anthropic",
      apiUrl: "https://api.anthropic.com/v1",
      keySet: true,
    });
  });

  it("reports a local server with no key as configured-but-keyless", async () => {
    const { result } = renderHook(() => useProviders(true));
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(result.current.chatSlot("local", "", false)).toEqual({
      providerId: "local",
      apiUrl: "http://localhost:11434/v1",
      keySet: false,
    });
  });

  it("falls back to the legacy pair on an install that predates the registry", async () => {
    const { result } = renderHook(() => useProviders(true));
    await waitFor(() => expect(list).toHaveBeenCalled());

    // chatProviderId "" means the slot was never moved, so the legacy values are still the truth
    // — and the dropdown still has to show something, inferred from the URL the same way the
    // migration seeded these installs.
    expect(result.current.chatSlot("", "https://openrouter.ai/api/v1", true)).toEqual({
      providerId: "openrouter",
      apiUrl: "https://openrouter.ai/api/v1",
      keySet: true,
    });
  });

  it("shows a provider with no stored row as unconfigured rather than throwing", async () => {
    const { result } = renderHook(() => useProviders(true));
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(result.current.chatSlot("openai", "", false)).toEqual({
      providerId: "openai",
      apiUrl: "",
      keySet: false,
    });
  });

  it("does not fetch while the panel is closed", () => {
    renderHook(() => useProviders(false));
    expect(list).not.toHaveBeenCalled();
  });
});
