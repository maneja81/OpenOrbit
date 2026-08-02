import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import TablerIcon from "@/components/atoms/TablerIcon";
import SlashCommandMenu, { SlashMenuItem } from "@/components/molecules/SlashCommandMenu";

export type AddSourceId = "file" | "folder" | "url";

/** The three ways something enters the knowledge base. Kept in the order they're most used. */
const SOURCES: SlashMenuItem[] = [
  { id: "file", icon: "ti-file-plus", label: "File", sublabel: "Add documents from your computer" },
  { id: "folder", icon: "ti-folder-plus", label: "Folder", sublabel: "Attach a folder to browse and read" },
  { id: "url", icon: "ti-world", label: "URL", sublabel: "Save a web page" },
];

interface AddSourceMenuProps {
  onSelect: (id: AddSourceId) => void;
}

/** A single "+" affordance in the Knowledge widget header, in place of one icon button per source.
 * Three separate buttons crowded the header once folders joined files and URLs there.
 *
 * The list itself is SlashCommandMenu — it is presentational and already implements the roving
 * listbox behaviour (aria-selected, scroll-into-view) the app's other menus use, so only the
 * open/close, positioning and key handling live here.
 *
 * The menu goes into a portal positioned from the trigger's rect rather than sitting in the
 * widget card, for the reason Combobox does the same: every widget card has a backdrop-filter
 * and so its own stacking context, so a menu left inside the Knowledge card is painted under
 * the next card down the rail. */
export default function AddSourceMenu({ onSelect }: AddSourceMenuProps) {
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<{ top: number; right: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Right-aligned to the trigger, so the menu grows leftward across the card rather than off
  // the edge of the window.
  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;
    const updatePosition = () => {
      const rect = containerRef.current!.getBoundingClientRect();
      setMenuStyle({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The menu is portalled, so it is no longer inside containerRef — check it separately or
      // every click on an option counts as a click outside.
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const choose = (item: SlashMenuItem) => {
    setOpen(false);
    onSelect(item.id as AddSourceId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      // Down or Enter on the trigger opens the menu at the first item, matching how the app's
      // other keyboard-navigable menus behave.
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setSelectedIndex(0);
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      // Escape is consumed here, not just acted on: this menu also opens inside KnowledgeModal,
      // and Modal listens for Escape on `document`. Letting the key carry on bubbling dismissed
      // the menu and closed the whole modal out from under it in the same press.
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % SOURCES.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + SOURCES.length) % SOURCES.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      choose(SOURCES[selectedIndex]);
    }
  };

  return (
    <div className="add-source" ref={containerRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        className="widget-icon-btn"
        aria-label="Add to knowledge base"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setSelectedIndex(0);
          setOpen((v) => !v);
        }}
      >
        <TablerIcon name="ti-plus" />
      </button>
      {open &&
        menuStyle &&
        createPortal(
          <div className="add-source-menu" ref={menuRef} style={{ top: menuStyle.top, right: menuStyle.right }}>
            <SlashCommandMenu
              items={SOURCES}
              selectedIndex={selectedIndex}
              onSelect={choose}
              onHover={setSelectedIndex}
            />
          </div>,
          document.body
        )}
    </div>
  );
}
