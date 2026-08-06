import WidgetCard from "@/components/atoms/WidgetCard";
import TablerIcon from "@/components/atoms/TablerIcon";

interface ChecklistWidgetProps {
  items: ChecklistItemRow[];
}

const STATUS_ICON: Record<ChecklistItemRow["status"], string> = {
  pending: "ti-circle",
  in_progress: "ti-loader-2",
  completed: "ti-circle-check",
  cancelled: "ti-circle-x",
};

/**
 * Shows the current turn's plan as the model reports it via write_checklist — not what
 * actually executed (that's the step feed in TokenUsageWidget). Grouped by agent, since
 * more than one agent's checklist can coexist for the same turn (Orbit's own plan plus
 * whichever specialist it called — see ai/tools/checklistTools.ts).
 */
export default function ChecklistWidget({ items }: ChecklistWidgetProps) {
  const byAgent = new Map<string, ChecklistItemRow[]>();
  for (const item of items) {
    const list = byAgent.get(item.agent_name) ?? [];
    list.push(item);
    byAgent.set(item.agent_name, list);
  }

  return (
    <WidgetCard id="widget-checklist" title="Workflow">
      {items.length === 0 && <p className="widget-empty">Nothing planned yet.</p>}
      {[...byAgent.entries()].map(([agentName, agentItems]) => (
        <div className="checklist-agent-group" key={agentName}>
          {byAgent.size > 1 && <span className="checklist-agent-label">{agentName}</span>}
          <div className="checklist-list">
            {agentItems.map((item) => (
              <div className={`checklist-row checklist-row--${item.status}`} key={item.id}>
                <TablerIcon name={STATUS_ICON[item.status]} className="checklist-row-icon" />
                <span className="checklist-row-text">{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </WidgetCard>
  );
}
