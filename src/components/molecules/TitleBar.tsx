import TablerIcon from "@/components/atoms/TablerIcon";

interface TitleBarProps {
  title: string;
  isFullscreen: boolean;
  onMinimize: () => void;
  onClose: () => void;
  onToggleFullscreen: () => void;
}

export default function TitleBar({ title, isFullscreen, onMinimize, onClose, onToggleFullscreen }: TitleBarProps) {
  return (
    <div id="titlebar">
      <div id="titlebar-controls">
        <button className="tbtn" aria-label="Close" onClick={onClose}>
          <TablerIcon name="ti-x" />
        </button>
        <button className="tbtn" aria-label="Minimize" onClick={onMinimize}>
          <TablerIcon name="ti-minus" />
        </button>
        <button
          className={`tbtn${isFullscreen ? " active" : ""}`}
          aria-label="Toggle fullscreen"
          onClick={onToggleFullscreen}
        >
          <TablerIcon name={isFullscreen ? "ti-arrows-minimize" : "ti-arrows-maximize"} />
        </button>
      </div>
      <span id="titlebar-title">{title.toUpperCase()}</span>
    </div>
  );
}
