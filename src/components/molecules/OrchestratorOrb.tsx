import { RefObject, useState } from "react";
import { motion } from "framer-motion";
import Tooltip from "@/components/atoms/Tooltip";
import AgentInfoModal from "@/components/molecules/AgentInfoModal";
import { ORCHESTRATOR_TOOL_NAMES } from "@/lib/agents";
import { humanizeToolName } from "@/lib/humanizeToolName";
import { useSnapOnClick } from "@/hooks/useSnapOnClick";

interface OrchestratorOrbProps {
  orchestratorRef: RefObject<HTMLDivElement | null>;
  speaking: boolean;
  name: string;
  model?: string;
  entering?: boolean;
  cognitiveState: string;
  sessionStats: string;
}

export default function OrchestratorOrb({
  orchestratorRef,
  speaking,
  name,
  model,
  entering,
  cognitiveState,
  sessionStats,
}: OrchestratorOrbProps) {
  const { x, y, onClick } = useSnapOnClick();
  const [infoOpen, setInfoOpen] = useState(false);
  const tooltipLines = ORCHESTRATOR_TOOL_NAMES.map(humanizeToolName);

  return (
    <div
      id="orchestrator"
      className={[speaking && "speaking", entering && "entering"].filter(Boolean).join(" ") || undefined}
      ref={orchestratorRef}
    >
      <Tooltip label="Tools" lines={tooltipLines}>
        <motion.div
          className="orchestrator-snap"
          style={{ x, y }}
          onClick={(e) => {
            onClick(e);
            setInfoOpen(true);
          }}
        >
          <div id="ap" className={speaking ? "speaking" : undefined} />
          <span className="nm">{name.toUpperCase()}</span>
          <span className="sb">{cognitiveState}</span>
          {sessionStats && <span className="ss">{sessionStats}</span>}
        </motion.div>
      </Tooltip>
      <AgentInfoModal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        name={name}
        tagline="orchestrator"
        model={model}
        toolNames={ORCHESTRATOR_TOOL_NAMES}
        connectorToolCount={0}
      />
    </div>
  );
}
