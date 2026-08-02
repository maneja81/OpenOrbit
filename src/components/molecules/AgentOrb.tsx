import { useState } from "react";
import { motion } from "framer-motion";
import TablerIcon from "@/components/atoms/TablerIcon";
import Tooltip from "@/components/atoms/Tooltip";
import AgentInfoModal from "@/components/molecules/AgentInfoModal";
import { AgentLayoutItem, AgentStatus } from "@/lib/agents";
import { useSnapOnClick } from "@/hooks/useSnapOnClick";
import { humanizeToolName } from "@/lib/humanizeToolName";

interface AgentOrbProps {
  agent: AgentLayoutItem;
  status: AgentStatus;
  side: "left" | "right";
  orbRef: (el: HTMLDivElement | null) => void;
}

export default function AgentOrb({ agent, status, side, orbRef }: AgentOrbProps) {
  const { x, y, onClick } = useSnapOnClick();
  const [infoOpen, setInfoOpen] = useState(false);
  const tooltipLines = agent.toolNames.map(humanizeToolName);
  if (agent.connectorToolCount > 0) tooltipLines.push(`+${agent.connectorToolCount} connector tools`);

  return (
    // motion.div only for the mount/unmount (opacity+scale) transition below — position
    // (left/top) stays entirely owned by useOrbitScene's imperative per-frame loop via
    // orbRef, same as before; this component never animates or sets its own position.
    <motion.div
      className={`agent-node side-${side}`}
      id={`ag-${agent.id}`}
      ref={orbRef}
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.4 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <Tooltip label="Tools" lines={tooltipLines}>
        <div className={`agent-node-circle ${status}`}>
          <motion.div
            className="agent-node-snap"
            style={{ x, y }}
            onClick={(e) => {
              onClick(e);
              setInfoOpen(true);
            }}
          >
            <TablerIcon name={agent.icon} className="agent-node-icon" />
            <span className={`status-dot ${status}`} aria-label={`${agent.name} status: ${status}`} />
          </motion.div>
        </div>
        <div className="agent-node-label-group">
          <span className="agent-node-label">{agent.name}</span>
          {(agent.tagline || agent.model) && (
            <span className="agent-node-meta">
              {agent.tagline && <span className="agent-node-tagline">{agent.tagline}</span>}
              {agent.model && <span className="agent-node-model">{agent.model}</span>}
            </span>
          )}
        </div>
      </Tooltip>
      <AgentInfoModal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        icon={agent.icon}
        name={agent.name}
        tagline={agent.tagline}
        description={agent.description}
        model={agent.model}
        toolNames={agent.toolNames}
        connectorToolCount={agent.connectorToolCount}
      />
    </motion.div>
  );
}
