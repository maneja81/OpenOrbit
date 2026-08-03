import { setSetting } from "./settingsStore";
import { readAppSetting } from "../appSettings";
import type { SettingKey } from "../settingsSchema";
import { devLog } from "../devLog";

/**
 * The orchestrator's tool attachments, unlike every other agent's, live in settings rather than
 * an `agents` row — so the delete handlers that prune `agents.*_ids` never touched them.
 *
 * A deleted MCP server, connector or HTTP tool collection therefore stayed listed against the
 * orchestrator forever. Mostly harmless, because the attach helpers skip ids they can't resolve,
 * but the lists grew unboundedly across delete/recreate cycles and — the part that isn't
 * harmless — recreating something that reused a previous id silently re-attached it to the
 * orchestrator without anyone asking for it.
 */
const ATTACHMENT_KEYS = {
  mcp: "orchestratorMcpServerIds",
  connector: "orchestratorConnectorIds",
  httpToolCollection: "orchestratorHttpToolCollectionIds",
} as const satisfies Record<string, SettingKey>;

export type AttachmentKind = keyof typeof ATTACHMENT_KEYS;

/** Drops `id` from the orchestrator's list of that kind. Call it wherever the thing itself is
 * deleted, alongside the existing agents-table prune. */
export function detachFromOrchestrator(kind: AttachmentKind, id: string): void {
  const key = ATTACHMENT_KEYS[kind];
  const current = readAppSetting(key);
  if (!current.includes(id)) return;
  setSetting(`appSettings.${key}`, current.filter((existing) => existing !== id));
  devLog(`[settings] detached ${id} from ${key}`);
}
