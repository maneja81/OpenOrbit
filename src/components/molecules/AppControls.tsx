import TablerIcon from "@/components/atoms/TablerIcon";
import IconButton from "@/components/atoms/IconButton";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { APP_LINKS } from "@/lib/appLinks";

interface AppControlsProps {
  onOpenSettings: () => void;
  onStartTour: () => void;
  onOpenAbout: () => void;
  version: string;
}

/** Bottom-left (#ctrls) and bottom-right (#ctrls-right) chrome docks. Both sit over #chat,
 * which spans the full window width at z-index 30 and does not disable pointer events — so
 * both docks need a higher stacking order in globals.css or their buttons render fine and
 * swallow no clicks. */
// No window.agentsAPI under `npm run dev:web` — same guard AboutTab.tsx uses before any
// fs.openExternal call.
function openWiki() {
  if (!hasAgentsAPI()) return;
  void window.agentsAPI.fs.openExternal(APP_LINKS.wiki);
}

export default function AppControls({ onOpenSettings, onStartTour, onOpenAbout, version }: AppControlsProps) {
  return (
    <>
      <div id="ctrls">
        {/* #aboutbtn is a tour target (see lib/tourSteps.ts) — the id must stay stable. */}
        <IconButton id="aboutbtn" aria-label="About this app" title="About" onClick={onOpenAbout}>
          <TablerIcon name="ti-info-circle" />
        </IconButton>
        <IconButton id="helpbtn" aria-label="Open the OpenOrbit wiki" title="Help" onClick={openWiki}>
          <TablerIcon name="ti-question-mark" />
        </IconButton>
        {/* "0.0.0" is the deliberate no-release-found sentinel (see scripts/releaseInfo.ts) —
            hide it rather than show a meaningless version number. */}
        {version !== "0.0.0" && <span id="app-version">v{version}</span>}
      </div>
      <div id="ctrls-right">
        <IconButton id="tourbtn" aria-label="Replay tour" title="Replay tour" onClick={onStartTour}>
          <TablerIcon name="ti-route" />
        </IconButton>
        <IconButton id="setbtn" aria-label="Open settings" onClick={onOpenSettings}>
          <TablerIcon name="ti-settings" />
        </IconButton>
      </div>
    </>
  );
}
