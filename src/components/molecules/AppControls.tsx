import TablerIcon from "@/components/atoms/TablerIcon";
import IconButton from "@/components/atoms/IconButton";

interface AppControlsProps {
  onOpenSettings: () => void;
  onStartTour: () => void;
  onOpenAbout: () => void;
}

/** The bottom-left dock of secondary chrome. It sits over #chat, which spans the full window
 * width at z-index 30 and does not disable pointer events — so #ctrls needs a higher stacking
 * order in globals.css or these buttons render fine and swallow no clicks. */
export default function AppControls({ onOpenSettings, onStartTour, onOpenAbout }: AppControlsProps) {
  return (
    <div id="ctrls">
      {/* #aboutbtn is a tour target (see lib/tourSteps.ts) — the id must stay stable. */}
      <IconButton id="aboutbtn" aria-label="About this app" title="About" onClick={onOpenAbout}>
        <TablerIcon name="ti-info-circle" />
      </IconButton>
      <IconButton id="tourbtn" aria-label="Replay tour" title="Replay tour" onClick={onStartTour}>
        <TablerIcon name="ti-help" />
      </IconButton>
      <IconButton id="setbtn" aria-label="Open settings" onClick={onOpenSettings}>
        <TablerIcon name="ti-settings" />
      </IconButton>
    </div>
  );
}
