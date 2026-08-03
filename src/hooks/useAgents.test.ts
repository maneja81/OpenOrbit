import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAgents } from "./useAgents";

function row(id: string, overrides: Partial<AgentDisplayRow> = {}): AgentDisplayRow {
  return {
    id,
    name: id,
    icon: "ti-robot",
    tagline: "",
    description: "",
    prompt: "",
    model: "gpt-4.1",
    tools: "[]",
    enabled: 1,
    system: 0,
    created_at: "2026-08-03 00:00:00",
    mcp_server_ids: "[]",
    connector_ids: "[]",
    http_tool_collection_ids: "[]",
    toolNames: [],
    connectorToolCount: 0,
    ...overrides,
  } as AgentDisplayRow;
}

function installBridge(agent: Record<string, unknown>) {
  (window as unknown as { agentsAPI: unknown }).agentsAPI = {
    agent: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(row("new")),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      exportToFile: vi.fn().mockResolvedValue({ canceled: false }),
      importFromFile: vi.fn().mockResolvedValue([]),
      ...agent,
    },
  };
}

const BOOM = new Error("bridge exploded");

describe("useAgents error handling", () => {
  afterEach(() => {
    delete (window as unknown as { agentsAPI?: unknown }).agentsAPI;
    vi.restoreAllMocks();
  });

  it("starts with no error", async () => {
    installBridge({});
    const { result } = renderHook(() => useAgents());

    await waitFor(() => expect(result.current.error).toBeNull());
  });

  // U8 — the mount fetch had no .catch(), so a rejection was unhandled and the orbit rendered
  // empty. That is indistinguishable from a genuinely fresh install.
  it("surfaces a failure of the initial list instead of silently showing no agents", async () => {
    installBridge({ list: vi.fn().mockRejectedValue(BOOM) });
    const { result } = renderHook(() => useAgents());

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.agents).toEqual([]);
  });

  // U7 — the core of it: create and delete rejected into nothing at all.
  it("surfaces a failed create and resolves undefined", async () => {
    installBridge({ create: vi.fn().mockRejectedValue(BOOM) });
    const { result } = renderHook(() => useAgents());

    let created: unknown = "sentinel";
    await act(async () => {
      created = await result.current.createAgent({ name: "Nope" });
    });

    expect(created).toBeUndefined();
    expect(result.current.error).toBeTruthy();
  });

  it("surfaces a failed delete and resolves false", async () => {
    installBridge({ delete: vi.fn().mockRejectedValue(BOOM) });
    const { result } = renderHook(() => useAgents());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.deleteAgent("knowledgeAgent");
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it("resolves true when the delete actually succeeds", async () => {
    installBridge({});
    const { result } = renderHook(() => useAgents());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.deleteAgent("knowledgeAgent");
    });

    expect(ok).toBe(true);
    expect(result.current.error).toBeNull();
  });

  // U9 — deleteAgent used to splice local state, removing the row on the strength of the call
  // not throwing. It now refetches, like updateAgent and createAgent already did.
  it("refetches after a delete rather than splicing local state", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([row("a"), row("b")])
      .mockResolvedValue([row("b")]);
    installBridge({ list });
    const { result } = renderHook(() => useAgents());

    await waitFor(() => expect(result.current.rawAgents).toHaveLength(2));

    await act(async () => {
      await result.current.deleteAgent("a");
    });

    expect(result.current.rawAgents.map((r) => r.id)).toEqual(["b"]);
    // Once on mount, once after the delete — the splice version never called it a second time.
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed update", async () => {
    installBridge({ update: vi.fn().mockRejectedValue(BOOM) });
    const { result } = renderHook(() => useAgents());

    await act(async () => {
      await result.current.updateAgent("a", { name: "x" });
    });

    expect(result.current.error).toBeTruthy();
  });

  it("surfaces a failed import and resolves an empty list", async () => {
    installBridge({ importFromFile: vi.fn().mockRejectedValue(BOOM) });
    const { result } = renderHook(() => useAgents());

    let created: unknown;
    await act(async () => {
      created = await result.current.importAgents();
    });

    expect(created).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });

  it("surfaces a failed export and reports it as canceled", async () => {
    installBridge({ exportToFile: vi.fn().mockRejectedValue(BOOM) });
    const { result } = renderHook(() => useAgents());

    let res: { canceled: boolean } | undefined;
    await act(async () => {
      res = await result.current.exportAgent("a");
    });

    expect(res).toEqual({ canceled: true });
    expect(result.current.error).toBeTruthy();
  });

  it("clears a previous error when the next operation succeeds", async () => {
    const del = vi.fn().mockRejectedValueOnce(BOOM).mockResolvedValue(undefined);
    installBridge({ delete: del });
    const { result } = renderHook(() => useAgents());

    await act(async () => {
      await result.current.deleteAgent("a");
    });
    expect(result.current.error).toBeTruthy();

    await act(async () => {
      await result.current.deleteAgent("a");
    });
    expect(result.current.error).toBeNull();
  });
});
