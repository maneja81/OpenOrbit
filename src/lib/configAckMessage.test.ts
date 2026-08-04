import { describe, expect, it } from "vitest";
import { configAckMessage, shouldPersistConfigAck, type ConfigAckEvent } from "./configAckMessage";

describe("configAckMessage", () => {
  it("returns empty string for zero events", () => {
    expect(configAckMessage([])).toBe("");
  });

  it("formats a single file event", () => {
    expect(configAckMessage([{ type: "file", fileName: "report.pdf" }])).toBe(
      "I've got report.pdf. How can I help?"
    );
  });

  it("formats a single location event", () => {
    expect(configAckMessage([{ type: "location" }])).toBe("location is now enabled. How can I help?");
  });

  it("formats a single connector event", () => {
    expect(
      configAckMessage([{ type: "connector", label: "Gmail", agentNames: ["Cipher", "Atlas"] }])
    ).toBe("Gmail is now available with Cipher, Atlas. How can I help?");
  });

  it("formats a connector event with zero agentNames without a dangling 'with' clause", () => {
    expect(configAckMessage([{ type: "connector", label: "Gmail", agentNames: [] }])).toBe(
      "Gmail is now available. How can I help?"
    );
  });

  it("caps a batch over 3 events and summarizes the remainder", () => {
    const events: ConfigAckEvent[] = [
      { type: "file", fileName: "a.pdf" },
      { type: "file", fileName: "b.pdf" },
      { type: "location" },
      { type: "connector", label: "Gmail", agentNames: [] },
    ];
    expect(configAckMessage(events)).toBe(
      "I've got a.pdf, I've got b.pdf, location is now enabled, and 1 more change. How can I help?"
    );
  });
});

describe("shouldPersistConfigAck", () => {
  it("is true when the batch contains a file event", () => {
    expect(shouldPersistConfigAck([{ type: "file", fileName: "a.pdf" }])).toBe(true);
  });

  it("is true when the batch contains a connector event", () => {
    expect(shouldPersistConfigAck([{ type: "connector", label: "Gmail", agentNames: [] }])).toBe(true);
  });

  it("is false for a location-only batch", () => {
    expect(shouldPersistConfigAck([{ type: "location" }])).toBe(false);
  });
});
