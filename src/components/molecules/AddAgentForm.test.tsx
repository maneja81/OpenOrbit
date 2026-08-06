import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import AddAgentForm from "./AddAgentForm";

function renderForm(onCreate = vi.fn()) {
  return { onCreate, ...render(<AddAgentForm defaultModel="gpt-4.1-mini" onCreate={onCreate} onCancel={() => {}} />) };
}

describe("AddAgentForm — Suggest name & tagline", () => {
  afterEach(() => {
    cleanup();
    // @ts-expect-error test-only cleanup of a global stubbed per test
    delete window.agentsAPI;
  });

  it("disables Suggest until a description or prompt has been typed", () => {
    renderForm();
    const suggestBtn = screen.getByRole("button", { name: /suggest a name and tagline/i });
    expect((suggestBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("What does this agent do?"), {
      target: { value: "Tracks flight prices and alerts on drops" },
    });
    expect((suggestBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("fills Name and Tagline from the suggestion once it resolves", async () => {
    const suggestIdentity = vi.fn().mockResolvedValue({ name: "Fareway", tagline: "Flight Price Tracking" });
    window.agentsAPI = { agent: { suggestIdentity } } as unknown as Window["agentsAPI"];
    renderForm();

    fireEvent.change(screen.getByPlaceholderText("What does this agent do?"), {
      target: { value: "Tracks flight prices and alerts on drops" },
    });
    fireEvent.click(screen.getByRole("button", { name: /suggest a name and tagline/i }));

    await waitFor(() =>
      expect((screen.getByPlaceholderText("e.g. Scout") as HTMLInputElement).value).toBe("Fareway")
    );
    expect((screen.getByPlaceholderText("e.g. Web research") as HTMLInputElement).value).toBe("Flight Price Tracking");
    expect(suggestIdentity).toHaveBeenCalledWith("Tracks flight prices and alerts on drops");
  });

  it("shows an error and leaves the fields untouched when the suggestion fails", async () => {
    const suggestIdentity = vi.fn().mockRejectedValue(new Error("Couldn't reach the model"));
    window.agentsAPI = { agent: { suggestIdentity } } as unknown as Window["agentsAPI"];
    renderForm();

    fireEvent.change(screen.getByPlaceholderText("What does this agent do?"), {
      target: { value: "Tracks flight prices" },
    });
    fireEvent.click(screen.getByRole("button", { name: /suggest a name and tagline/i }));

    await waitFor(() => expect(screen.getByText(/Couldn't reach the model/i)).toBeTruthy());
    expect((screen.getByPlaceholderText("e.g. Scout") as HTMLInputElement).value).toBe("");
  });

  it("prefers the description over the prompt draft as suggestion context", () => {
    window.agentsAPI = { agent: { suggestIdentity: vi.fn() } } as unknown as Window["agentsAPI"];
    renderForm();

    fireEvent.change(screen.getByPlaceholderText("Describe this agent's role…"), {
      target: { value: "prompt draft text" },
    });
    const suggestBtn = screen.getByRole("button", { name: /suggest a name and tagline/i });
    expect((suggestBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByPlaceholderText("What does this agent do?"), {
      target: { value: "description text" },
    });
    fireEvent.click(suggestBtn);
    expect(window.agentsAPI.agent.suggestIdentity).toHaveBeenCalledWith("description text");
  });
});
