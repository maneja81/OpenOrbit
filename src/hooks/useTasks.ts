import { useCallback, useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";

export function useTasks() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [error, setError] = useState<string | null>(
    hasAgentsAPI() ? null : "Native task bridge unavailable (window.agentsAPI is missing)."
  );

  const refresh = useCallback(async () => {
    if (!hasAgentsAPI()) return;
    const rows = await window.agentsAPI.tasks.list();
    setTasks(rows);
  }, []);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;
    window.agentsAPI.tasks.list().then((rows) => {
      if (!cancelled) setTasks(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Chrono's tools (create_task/update_task/etc.) and the background scheduler both write
  // straight to the tasks table, bypassing the tasks:* IPC handlers above — without this
  // subscription, tasks created via chat or reminders/recurring tasks the scheduler just ran
  // would never show up here until something else happened to trigger a refresh. See
  // broadcastTasksUpdate in electron/main/ipc/agent.ts and electron/main/tasks/scheduler.ts.
  useEffect(() => {
    if (!hasAgentsAPI()) return;
    return window.agentsAPI.tasks.onUpdate(() => {
      void refresh();
    });
  }, [refresh]);

  const createTask = useCallback(
    async (input: TaskCreateInput) => {
      if (!hasAgentsAPI()) return;
      setError(null);
      try {
        await window.agentsAPI.tasks.create(input);
        await refresh();
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
      }
    },
    [refresh]
  );

  const updateTask = useCallback(
    async (id: string, patch: TaskUpdatePatch) => {
      if (!hasAgentsAPI()) return;
      setError(null);
      try {
        await window.agentsAPI.tasks.update(id, patch);
        await refresh();
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
      }
    },
    [refresh]
  );

  const completeTask = useCallback(
    async (id: string) => {
      if (!hasAgentsAPI()) return;
      setError(null);
      try {
        await window.agentsAPI.tasks.complete(id);
        await refresh();
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
      }
    },
    [refresh]
  );

  const deleteTask = useCallback(
    async (id: string) => {
      if (!hasAgentsAPI()) return;
      setError(null);
      try {
        await window.agentsAPI.tasks.delete(id);
        await refresh();
      } catch (e) {
        setError(formatHumanizedError(humanizeError(e)));
      }
    },
    [refresh]
  );

  return { tasks, error, createTask, updateTask, completeTask, deleteTask, refresh };
}
