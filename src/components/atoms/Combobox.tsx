import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import TablerIcon from "@/components/atoms/TablerIcon";

interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  value: string;
  options: readonly ComboboxOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  /** "sm" for compact inline use (widget cards, table-like rows); "md" (default) for a
   * full-width Settings-style field. One component, sized per call site, rather than a
   * separate near-duplicate component per context. */
  size?: "sm" | "md";
}

/** Custom dropdown matching the app's glass aesthetic — per CLAUDE.md's UI design
 * conventions, select/dropdown inputs must never be a native `<select>` element. Supports
 * typing to filter options (autocomplete) and Up/Down/Enter/Escape keyboard navigation,
 * same pattern established by SlashCommandMenu. The menu is rendered into a portal and
 * positioned via the trigger's bounding rect (not CSS `position: absolute` in place) so
 * it isn't clipped by a scrolling ancestor (e.g. KnowledgeModal's `.km-list`, which has
 * `overflow-y: auto`) or hidden behind a later sibling with its own stacking context
 * (e.g. a widget card's `backdrop-filter`). */
export default function Combobox({ value, options, onChange, ariaLabel, size = "md" }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((opt) => opt.value === value);
  const filtered =
    query.trim().length === 0
      ? options
      : options.filter((opt) => opt.label.toLowerCase().includes(query.trim().toLowerCase()));

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const updatePosition = () => {
      const rect = rootRef.current!.getBoundingClientRect();
      setMenuStyle({ top: rect.bottom + 6, left: rect.left, width: rect.width });
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
    if (open) searchRef.current?.focus();
  }, [open]);

  // Clamped for render rather than kept in sync via an effect — typing narrows `filtered`
  // between renders, and activeIndex only needs to point somewhere valid *when read*, not
  // be corrected as a side effect on every list-length change.
  const safeActiveIndex = Math.max(0, Math.min(activeIndex, filtered.length - 1));

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [safeActiveIndex]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const openMenu = () => {
    const selectedIndex = options.findIndex((opt) => opt.value === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const selectOption = (opt: ComboboxOption) => {
    onChange(opt.value);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[safeActiveIndex]) selectOption(filtered[safeActiveIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Consumed, not just acted on: comboboxes open inside modals (KnowledgeModal's per-row
      // category, several in Settings), and Modal listens for Escape on `document`. Left to
      // bubble, one press closed the menu and the modal around it together.
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className={`combobox combobox-${size}`} ref={rootRef}>
      <button
        type="button"
        className="combobox-trigger"
        onClick={() => (open ? close() : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span>{selected?.label ?? value}</span>
        <TablerIcon name="ti-chevron-down" className="combobox-chevron" />
      </button>
      {open &&
        menuStyle &&
        createPortal(
          <div
            className="combobox-menu"
            role="listbox"
            style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width }}
          >
            <input
              ref={searchRef}
              type="text"
              className="combobox-search"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
            />
            {filtered.length === 0 && <div className="combobox-empty">Nothing found…</div>}
            {filtered.map((opt, i) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                ref={i === safeActiveIndex ? activeOptionRef : undefined}
                aria-selected={opt.value === value}
                className={`combobox-option${i === safeActiveIndex ? " active" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectOption(opt);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
