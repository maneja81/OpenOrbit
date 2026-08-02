import Modal from "@/components/atoms/Modal";
import TablerIcon from "@/components/atoms/TablerIcon";
import { humanizeToolName } from "@/lib/humanizeToolName";

interface AgentInfoModalProps {
  open: boolean;
  onClose: () => void;
  icon?: string;
  name: string;
  tagline?: string;
  description?: string;
  model?: string;
  toolNames: string[];
  connectorToolCount: number;
}

/** Read-only quick-glance agent info popup, opened by clicking an orbit node. Editing
 * already exists via AgentAccordion inside Settings — this doesn't duplicate that. */
export default function AgentInfoModal({
  open,
  onClose,
  icon,
  name,
  tagline,
  description,
  model,
  toolNames,
  connectorToolCount,
}: AgentInfoModalProps) {
  return (
    <Modal open={open} onClose={onClose} label={name}>
      <div className="km-header">
        <span className="km-title">
          {icon && <TablerIcon name={icon} />} {name}
        </span>
        <button className="widget-icon-btn" aria-label="Close" onClick={onClose}>
          <TablerIcon name="ti-x" />
        </button>
      </div>
      <div className="km-body">
        {tagline && <p className="agent-info-tagline">{tagline}</p>}
        {description && <p className="agent-info-description">{description}</p>}
        {model && (
          <div className="agent-info-row">
            <span className="agent-info-row-label">Model</span>
            <span className="agent-info-row-value">{model}</span>
          </div>
        )}
        <div className="agent-info-row">
          <span className="agent-info-row-label">Tools</span>
        </div>
        {toolNames.length === 0 ? (
          <p className="widget-empty">No built-in tools attached.</p>
        ) : (
          <ul className="agent-info-tool-list">
            {toolNames.map((toolName) => (
              <li key={toolName}>{humanizeToolName(toolName)}</li>
            ))}
          </ul>
        )}
        {connectorToolCount > 0 && (
          <p className="agent-info-connector-count">+{connectorToolCount} connector tools attached</p>
        )}
      </div>
    </Modal>
  );
}
