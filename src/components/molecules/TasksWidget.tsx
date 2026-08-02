import WidgetCard from "@/components/atoms/WidgetCard";
import TablerIcon from "@/components/atoms/TablerIcon";
import { useTasks } from "@/hooks/useTasks";

function formatDueAt(dueAt: string | null): string {
  if (!dueAt) return "No due date";
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return dueAt;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function TasksWidget() {
  const { tasks, error, completeTask, deleteTask } = useTasks();
  const pending = tasks.filter((t) => t.status === "pending");

  return (
    <WidgetCard id="widget-tasks" title="Tasks & Reminders">
      <div className="tk-list">
        {pending.length === 0 && <p className="widget-empty">No tasks yet.</p>}
        {pending.map((task) => (
          <div className="tk-row" key={task.id}>
            <TablerIcon name={task.prompt ? "ti-bolt" : "ti-bell"} />
            <div className="tk-info">
              <span className="tk-title">{task.title}</span>
              <span className="tk-meta">
                {formatDueAt(task.next_run_at ?? task.due_at)}
                {task.recurrence_interval_ms !== null && (
                  <span className="tk-badge">
                    <TablerIcon name="ti-repeat" /> recurring
                  </span>
                )}
              </span>
            </div>
            <button className="widget-icon-btn" aria-label={`Complete ${task.title}`} onClick={() => completeTask(task.id)}>
              <TablerIcon name="ti-check" />
            </button>
            <button className="widget-icon-btn" aria-label={`Delete ${task.title}`} onClick={() => deleteTask(task.id)}>
              <TablerIcon name="ti-x" />
            </button>
          </div>
        ))}
      </div>
      {error && <p className="widget-error">{error}</p>}
    </WidgetCard>
  );
}
