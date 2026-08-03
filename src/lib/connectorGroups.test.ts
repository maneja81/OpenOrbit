import { describe, expect, it } from "vitest";
import { formatGroupStatus, groupConnectors, type ConnectorListItem } from "./connectorGroups";

function entry(
  id: string,
  overrides: Partial<ConnectorCatalogEntry> = {}
): ConnectorCatalogEntry {
  return {
    id,
    name: id,
    description: "",
    icon: "ti-plug",
    status: "disconnected",
    accountLabel: null,
    settingsFields: [],
    settingsConfigured: false,
    credentialsOnly: false,
    settingsSourceId: null,
    ...overrides,
  };
}

/** The live Google shape: a credentials-only parent plus four services pointing at it. */
function googleCatalog(): ConnectorCatalogEntry[] {
  return [
    entry("google-account", { credentialsOnly: true }),
    entry("gmail", { settingsSourceId: "google-account" }),
    entry("google-calendar", { settingsSourceId: "google-account" }),
    entry("google-drive", { settingsSourceId: "google-account" }),
    entry("google-contacts", { settingsSourceId: "google-account" }),
  ];
}

describe("groupConnectors", () => {
  it("returns an empty list for an empty catalog", () => {
    expect(groupConnectors([])).toEqual([]);
  });

  it("emits every entry as a single when none share settings", () => {
    const items = groupConnectors([entry("slack"), entry("notion")]);
    expect(items).toEqual([
      { kind: "single", connector: entry("slack") },
      { kind: "single", connector: entry("notion") },
    ]);
  });

  it("nests the Google services under their shared-credentials parent", () => {
    const items = groupConnectors(googleCatalog());
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("group");
    const group = items[0] as Extract<ConnectorListItem, { kind: "group" }>;
    expect(group.parent.id).toBe("google-account");
    expect(group.children.map((child) => child.id)).toEqual([
      "gmail",
      "google-calendar",
      "google-drive",
      "google-contacts",
    ]);
  });

  it("preserves catalog order across groups and singles", () => {
    const items = groupConnectors([entry("slack"), ...googleCatalog(), entry("notion")]);
    expect(items.map((item) => (item.kind === "group" ? item.parent.id : item.connector.id))).toEqual([
      "slack",
      "google-account",
      "notion",
    ]);
  });

  it("keeps an orphan child at the top level when its parent is missing", () => {
    const items = groupConnectors([entry("gmail", { settingsSourceId: "google-account" })]);
    expect(items).toEqual([
      { kind: "single", connector: entry("gmail", { settingsSourceId: "google-account" }) },
    ]);
  });

  it("treats a self-referencing settingsSourceId as owning its settings", () => {
    const items = groupConnectors([entry("gmail", { settingsSourceId: "gmail" })]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("single");
  });

  it("emits a childless credentials-only entry as a single", () => {
    const items = groupConnectors([entry("google-account", { credentialsOnly: true })]);
    expect(items).toEqual([
      { kind: "single", connector: entry("google-account", { credentialsOnly: true }) },
    ]);
  });
});

describe("formatGroupStatus", () => {
  it("counts connected children", () => {
    const children = googleCatalog().slice(1);
    children[0].status = "connected";
    children[2].status = "connected";
    expect(formatGroupStatus(children)).toBe("2 of 4 connected");
  });

  it("reports zero when nothing is connected", () => {
    expect(formatGroupStatus(googleCatalog().slice(1))).toBe("0 of 4 connected");
  });

  it("reports every child when all are connected", () => {
    const children = googleCatalog()
      .slice(1)
      .map((child) => ({ ...child, status: "connected" as const }));
    expect(formatGroupStatus(children)).toBe("4 of 4 connected");
  });

  it("returns an empty string when there are no children", () => {
    expect(formatGroupStatus([])).toBe("");
  });
});
