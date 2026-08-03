import { ReactNode, RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import TitleBar from "@/components/molecules/TitleBar";
import StatusBar from "@/components/molecules/StatusBar";
import AppControls from "@/components/molecules/AppControls";
import OrchestratorOrb from "@/components/molecules/OrchestratorOrb";
import AgentOrb from "@/components/molecules/AgentOrb";
// import WeeklyActivityWidget from "@/components/molecules/WeeklyActivityWidget"; // hidden for now, kept for later
import SystemStatusWidget from "@/components/molecules/SystemStatusWidget";
import KnowledgeWidget from "@/components/molecules/KnowledgeWidget";
import TokenUsageWidget from "@/components/molecules/TokenUsageWidget";
import TasksWidget from "@/components/molecules/TasksWidget";
import { AgentId, AgentLayoutItem, StepEvent } from "@/lib/agents";
import { RingGeometry } from "@/hooks/useOrbitScene";

interface OrbitSceneProps {
  containerRef: RefObject<HTMLDivElement | null>;
  bgCanvasRef: RefObject<HTMLCanvasElement | null>;
  orchestratorRef: RefObject<HTMLDivElement | null>;
  setAgentRef: (id: AgentId) => (el: HTMLDivElement | null) => void;
  activeAgent: AgentId | null;
  orchestratorResponding: boolean;
  agents: AgentLayoutItem[];
  steps: StepEvent[];
  ringGeometry: RingGeometry;
  lineGeometry: Record<AgentId, string>;
  statusText: string;
  onOpenSettings: () => void;
  onStartTour: () => void;
  onOpenAbout: () => void;
  isFullscreen: boolean;
  onMinimize: () => void;
  onClose: () => void;
  onToggleFullscreen: () => void;
  agentName: string;
  orchestratorModel?: string;
  entering?: boolean;
  locationEnabled: boolean;
  cognitiveState: string;
  sessionStats: string;
  children?: ReactNode;
}

export default function OrbitScene({
  containerRef,
  bgCanvasRef,
  orchestratorRef,
  setAgentRef,
  activeAgent,
  orchestratorResponding,
  agents,
  steps,
  ringGeometry,
  lineGeometry,
  statusText,
  onOpenSettings,
  onStartTour,
  onOpenAbout,
  isFullscreen,
  onMinimize,
  onClose,
  onToggleFullscreen,
  agentName,
  orchestratorModel,
  entering,
  locationEnabled,
  cognitiveState,
  sessionStats,
  children,
}: OrbitSceneProps) {
  const activeLineD = activeAgent ? lineGeometry[activeAgent] : undefined;

  return (
    <div id="u" ref={containerRef}>
      <video id="bgvid" autoPlay muted loop playsInline>
        {/* Document-relative, not "/bg.mp4": built renderers load over file://, where a
            root-absolute path resolves to file:///bg.mp4 and the video never loads. */}
        <source src="./bg.mp4" type="video/mp4" />
      </video>
      <canvas id="bg" ref={bgCanvasRef} />
      <svg id="oc">
        <circle className="oc-ring" cx={ringGeometry.cx} cy={ringGeometry.cy} r={ringGeometry.rInner} />
        <circle className="oc-ring" cx={ringGeometry.cx} cy={ringGeometry.cy} r={ringGeometry.rOuter} />
        <AnimatePresence>
          {agents.map((agent) => (
            // Opacity only — not framer-motion's `pathLength` (which would animate via
            // an inline stroke-dasharray/stroke-dashoffset, permanently overriding the
            // existing oc-line-flow CSS animation's own dash pattern for the line's
            // entire lifetime, not just this transition).
            <motion.path
              key={agent.id}
              id={`oc-line-${agent.id}`}
              className={`oc-line${activeAgent === agent.id ? " active" : ""}`}
              d={lineGeometry[agent.id]}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: "easeInOut" }}
            />
          ))}
        </AnimatePresence>
        {activeLineD && (
          <circle id="oc-pulse-dot" className="oc-pulse-dot" r={3.5} style={{ offsetPath: `path("${activeLineD}")` }} />
        )}
      </svg>
      <TitleBar
        title={agentName}
        isFullscreen={isFullscreen}
        onMinimize={onMinimize}
        onClose={onClose}
        onToggleFullscreen={onToggleFullscreen}
      />
      <StatusBar statusText={statusText} />
      <AppControls onOpenSettings={onOpenSettings} onStartTour={onStartTour} onOpenAbout={onOpenAbout} />
      <div id="widgets-left" className={entering ? "entering" : undefined}>
        <TokenUsageWidget steps={steps} />
      </div>
      <div id="widgets-right" className={entering ? "entering" : undefined}>
        <SystemStatusWidget locationEnabled={locationEnabled} />
        <KnowledgeWidget />
        <TasksWidget />
      </div>
      <OrchestratorOrb
        orchestratorRef={orchestratorRef}
        speaking={orchestratorResponding}
        name={agentName}
        model={orchestratorModel}
        entering={entering}
        cognitiveState={cognitiveState}
        sessionStats={sessionStats}
      />
      <AnimatePresence>
        {agents.map((agent) => (
          <AgentOrb
            key={agent.id}
            agent={agent}
            status={activeAgent === agent.id ? "active" : "standby"}
            side={Math.cos(agent.angle) >= 0 ? "right" : "left"}
            orbRef={setAgentRef(agent.id)}
          />
        ))}
      </AnimatePresence>
      {children}
    </div>
  );
}
