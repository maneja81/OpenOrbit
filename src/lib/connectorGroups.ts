/** One row of the Connectors list: either a connector on its own, or a shared-credentials
 * parent with the siblings that draw their settings from it nested underneath. */
export type ConnectorListItem =
  | { kind: "group"; parent: ConnectorCatalogEntry; children: ConnectorCatalogEntry[] }
  | { kind: "single"; connector: ConnectorCatalogEntry };

/** Folds the flat catalog into that shape using each entry's `settingsSourceId`, so the
 * four Google services collapse into the Google Account row that already holds their OAuth
 * client id/secret rather than taking four top-level rows of their own.
 *
 * Catalog order is preserved for both levels. An entry whose `settingsSourceId` names a
 * connector missing from `entries` is emitted as a "single" rather than dropped — an
 * orphan must still be reachable in the UI. */
export function groupConnectors(entries: ConnectorCatalogEntry[]): ConnectorListItem[] {
  const ids = new Set(entries.map((entry) => entry.id));
  const isChild = (entry: ConnectorCatalogEntry): boolean =>
    !!entry.settingsSourceId && entry.settingsSourceId !== entry.id && ids.has(entry.settingsSourceId);

  const childrenByParent = new Map<string, ConnectorCatalogEntry[]>();
  for (const entry of entries) {
    if (!isChild(entry)) continue;
    const siblings = childrenByParent.get(entry.settingsSourceId!);
    if (siblings) siblings.push(entry);
    else childrenByParent.set(entry.settingsSourceId!, [entry]);
  }

  const items: ConnectorListItem[] = [];
  for (const entry of entries) {
    const children = childrenByParent.get(entry.id);
    if (children) items.push({ kind: "group", parent: entry, children });
    else if (!isChild(entry)) items.push({ kind: "single", connector: entry });
  }
  return items;
}

/** Header summary for a group, e.g. "2 of 4 connected" — the only place a collapsed group
 * shows its children's state. Empty string when there is nothing to count. */
export function formatGroupStatus(children: ConnectorCatalogEntry[]): string {
  if (children.length === 0) return "";
  const connected = children.filter((child) => child.status === "connected").length;
  return `${connected} of ${children.length} connected`;
}
