import TablerIcon from "@/components/atoms/TablerIcon";
import IconButton from "@/components/atoms/IconButton";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { APP_LINKS } from "@/lib/appLinks";

interface AppControlsProps {
  onOpenSettings: () => void;
  onStartTour: () => void;
  onOpenAbout: () => void;
  /** This build's own version (app:info.packageVersion) — not the latest published release,
   * which used to be shown here by mistake (see AgentsApp.tsx / AboutTab.tsx). */
  version: string;
  /** True when a newer release than `version` has been published. Surfaced as a dot on
   * #aboutbtn rather than a separate control — About already has the release details and the
   * link out, and this app has no toast/banner system to put a fuller notice in. */
  updateAvailable: boolean;
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

export default function AppControls({
  onOpenSettings,
  onStartTour,
  onOpenAbout,
  version,
  updateAvailable,
}: AppControlsProps) {
  return (
    <>
      <div id="ctrls">
        {/* #aboutbtn is a tour target (see lib/tourSteps.ts) — the id must stay stable. */}
        <IconButton
          id="aboutbtn"
          aria-label={updateAvailable ? "About this app — update available" : "About this app"}
          title={updateAvailable ? "About (update available)" : "About"}
          onClick={onOpenAbout}
        >
          <TablerIcon name="ti-info-circle" />
          {updateAvailable && <span className="update-dot" aria-hidden="true" />}
        </IconButton>
        <IconButton id="helpbtn" aria-label="Open the OpenOrbit wiki" title="Help" onClick={openWiki}>
          <TablerIcon name="ti-question-mark" />
        </IconButton>
        {/* Empty until the app:info round trip in AgentsApp.tsx resolves — hide rather than
            show a blank "v". */}
        {version && <span id="app-version">v{version}</span>}
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
