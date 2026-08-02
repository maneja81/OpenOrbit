import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import AddUrlModal from "./AddUrlModal";
import { KnowledgeFilesContext, KnowledgeFilesContextValue } from "@/lib/knowledgeFilesContext";

function renderModal(addUrls: KnowledgeFilesContextValue["addUrls"]) {
  const ctxValue = {
    files: [],
    loading: false,
    error: null,
    addFiles: vi.fn(),
    addUrls,
    pickAndAdd: vi.fn(),
    removeFile: vi.fn(),
    updateCategory: vi.fn(),
    syncOne: vi.fn(),
  } as unknown as KnowledgeFilesContextValue;

  return render(
    <KnowledgeFilesContext.Provider value={ctxValue}>
      <AddUrlModal open onClose={() => {}} />
    </KnowledgeFilesContext.Provider>
  );
}

describe("AddUrlModal loading states", () => {
  afterEach(() => {
    cleanup();
    // @ts-expect-error test-only cleanup of a global stubbed per test
    delete window.agentsAPI;
  });

  it("shows a spinner and disables the button while fetching a page", async () => {
    let resolveDiscover: (v: unknown) => void = () => {};
    const discoverLinks = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDiscover = resolve;
        })
    );
    window.agentsAPI = { knowledgebase: { discoverLinks } } as unknown as Window["agentsAPI"];

    renderModal(vi.fn());

    fireEvent.change(screen.getByPlaceholderText("https://example.com/docs"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fetch page/i }));

    const button = await screen.findByRole("button", { name: /fetching page/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.querySelector(".spin-icon")).toBeTruthy();

    resolveDiscover({ seedUrl: "https://example.com", title: "Example", sameDomainLinks: [], externalLinks: [] });
    await waitFor(() => expect(screen.getByText(/Add 1 selected/i)).toBeTruthy());
  });

  it("closes immediately on confirm without waiting for addUrls to finish", async () => {
    window.agentsAPI = {
      knowledgebase: {
        discoverLinks: vi.fn().mockResolvedValue({
          seedUrl: "https://example.com",
          title: "Example",
          sameDomainLinks: [],
          externalLinks: [],
        }),
      },
    } as unknown as Window["agentsAPI"];

    // Never resolves during the test — if handleConfirm awaited this, onClose would
    // never fire and the assertion below would time out.
    const addUrls = vi.fn(() => new Promise<void>(() => {}));
    const onClose = vi.fn();

    const ctxValue = {
      files: [],
      loading: false,
      error: null,
      addFiles: vi.fn(),
      addUrls,
      pickAndAdd: vi.fn(),
      removeFile: vi.fn(),
      updateCategory: vi.fn(),
      syncOne: vi.fn(),
    } as unknown as KnowledgeFilesContextValue;

    render(
      <KnowledgeFilesContext.Provider value={ctxValue}>
        <AddUrlModal open onClose={onClose} />
      </KnowledgeFilesContext.Provider>
    );

    fireEvent.change(screen.getByPlaceholderText("https://example.com/docs"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fetch page/i }));
    await screen.findByText(/Add 1 selected/i);

    fireEvent.click(screen.getByRole("button", { name: /add 1 selected/i }));

    expect(addUrls).toHaveBeenCalledWith(["https://example.com"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
