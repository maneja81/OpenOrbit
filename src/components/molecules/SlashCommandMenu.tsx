import { useEffect, useRef } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";

export interface SlashMenuItem {
  id: string;
  icon: string;
  label: string;
  sublabel?: string;
  /** Text inserted into the input on select, in place of the default `/{id} `
   * (used by agent-directing commands, which insert "{AgentName}, " instead of a
   * literal slash command — the orchestrator already reliably hands off based on a
   * plain name mention in the message text, so no new "@mention" syntax is needed). */
  insertText?: string;
}

interface SlashCommandMenuProps {
  items: SlashMenuItem[];
  selectedIndex: number;
  emptyText?: string;
  onSelect: (item: SlashMenuItem) => void;
  onHover: (index: number) => void;
}

export default function SlashCommandMenu({
  items,
  selectedIndex,
  emptyText,
  onSelect,
  onHover,
}: SlashCommandMenuProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Keyboard navigation (arrow keys) can move the highlighted item outside the visible
  // 240px window; scroll it into view since the container doesn't do this automatically.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div className="slash-menu" role="listbox">
      {items.length === 0 && emptyText && <div className="slash-menu-empty">{emptyText}</div>}
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          ref={i === selectedIndex ? activeRef : undefined}
          aria-selected={i === selectedIndex}
          className={`slash-menu-item${i === selectedIndex ? " active" : ""}`}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(item);
          }}
        >
          <TablerIcon name={item.icon} className="slash-menu-icon" />
          <span className="slash-menu-label">{item.label}</span>
          {item.sublabel && <span className="slash-menu-sublabel">{item.sublabel}</span>}
        </button>
      ))}
    </div>
  );
}
