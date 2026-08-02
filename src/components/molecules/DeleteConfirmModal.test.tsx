import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import DeleteConfirmModal from "./DeleteConfirmModal";

describe("DeleteConfirmModal Enter-to-confirm", () => {
  afterEach(cleanup);

  it("confirms when Enter is pressed and the word matches", () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmModal open itemLabel="Cipher" onConfirm={onConfirm} onCancel={vi.fn()} />);

    const input = screen.getByPlaceholderText("DELETE");
    fireEvent.change(input, { target: { value: "DELETE" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Enter while the word does not match", () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmModal open itemLabel="Cipher" onConfirm={onConfirm} onCancel={vi.fn()} />);

    const input = screen.getByPlaceholderText("DELETE");
    fireEvent.change(input, { target: { value: "delete" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores keys other than Enter", () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmModal open itemLabel="Cipher" onConfirm={onConfirm} onCancel={vi.fn()} />);

    const input = screen.getByPlaceholderText("DELETE");
    fireEvent.change(input, { target: { value: "DELETE" } });
    fireEvent.keyDown(input, { key: "a" });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("clicking Delete still confirms", () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmModal open itemLabel="Cipher" onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("DELETE"), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
