import { ipcMain } from "electron";
import { getDb } from "../db";

export interface MemoryRecord {
  id: number;
  agentId: string | null;
  kind: string;
  content: string;
  createdAt: string;
}

const MEMORY_COLUMNS = `
  id,
  agent_id AS agentId,
  kind,
  content,
  created_at AS createdAt
`;

export function registerMemoryHandlers() {
  ipcMain.handle("memory:list", (_event, agentId?: string): MemoryRecord[] => {
    const db = getDb();
    if (agentId) {
      return db
        .prepare(`SELECT ${MEMORY_COLUMNS} FROM memory WHERE agent_id = ? ORDER BY id DESC`)
        .all(agentId) as MemoryRecord[];
    }
    return db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory ORDER BY id DESC`).all() as MemoryRecord[];
  });

  ipcMain.handle(
    "memory:add",
    (_event, entry: { agentId?: string | null; kind: string; content: string }): MemoryRecord => {
      if (typeof entry.kind !== "string" || entry.kind.length === 0) {
        throw new Error("Memory entry requires a non-empty kind");
      }
      if (typeof entry.content !== "string" || entry.content.length === 0) {
        throw new Error("Memory entry requires non-empty content");
      }
      const db = getDb();
      const result = db
        .prepare("INSERT INTO memory (agent_id, kind, content) VALUES (?, ?, ?)")
        .run(entry.agentId ?? null, entry.kind, entry.content);
      return db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memory WHERE id = ?`).get(result.lastInsertRowid) as MemoryRecord;
    }
  );
}
