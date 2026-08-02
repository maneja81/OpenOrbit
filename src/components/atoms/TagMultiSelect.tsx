import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import TablerIcon from "@/components/atoms/TablerIcon";

interface TagMultiSelectOption {
  value: string;
  label: string;
}

interface TagMultiSelectProps {
  values: string[];
  options: readonly TagMultiSelectOption[];
  onChange: (values: string[]) => void;
  ariaLabel?: string;
  addLabel?: string;
  emptyLabel?: string;
}

/** Tag-input style multi-select: selected options render as chips (with a per-chip
 * remove button) and an "Add" trigger opens a searchable dropdown of the remaining
 * options — same portal/positioning/keyboard-nav approach as Combobox, since per
 * CLAUDE.md's UI conventions this must not be a native multi-select and must support
 * Up/Down/Enter/Escape navigation like SlashCommandMenu. */
export default function TagMultiSelect({
  values,
  options,
  onChange,
  ariaLabel,
  addLabel = "Add",
  emptyLabel = "Nothing to add",
}: TagMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);

  const selectedOptions = values
    .map((value) => options.find((opt) => opt.value === value))
    .filter((opt): opt is TagMultiSelectOption => opt !== undefined);
  const remaining = options.filter((opt) => !values.includes(opt.value));
  const filtered =
    query.trim().length === 0
      ? remaining
      : remaining.filter((opt) => opt.label.toLowerCase().includes(query.trim().toLowerCase()));

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const updatePosition = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      setMenuStyle({ top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, 220) });
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

  const safeActiveIndex = Math.max(0, Math.min(activeIndex, filtered.length - 1));

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [safeActiveIndex]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const addOption = (opt: TagMultiSelectOption) => {
    onChange([...values, opt.value]);
    close();
  };

  const removeValue = (value: string) => {
    onChange(values.filter((v) => v !== value));
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
      if (filtered[safeActiveIndex]) addOption(filtered[safeActiveIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Same reason as Combobox: this renders inside AgentAccordion, which lives in the Settings
      // modal, and Modal listens for Escape on `document`. Left to bubble, dismissing the tag
      // menu closed Settings with it.
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className="tag-multiselect" ref={rootRef}>
      <div className="tag-multiselect-chips">
        {selectedOptions.map((opt) => (
          <span key={opt.value} className="tag-chip">
            {opt.label}
            <button
              type="button"
              className="tag-chip-remove"
              aria-label={`Remove ${opt.label}`}
              onClick={() => removeValue(opt.value)}
            >
              <TablerIcon name="ti-x" />
            </button>
          </span>
        ))}
        {remaining.length > 0 && (
          <button
            type="button"
            ref={triggerRef}
            className="tag-multiselect-add-btn"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={ariaLabel ?? addLabel}
            onClick={() => (open ? close() : setOpen(true))}
          >
            <TablerIcon name="ti-plus" />
            {addLabel}
          </button>
        )}
      </div>
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
            {filtered.length === 0 && <div className="combobox-empty">{emptyLabel}</div>}
            {filtered.map((opt, i) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                ref={i === safeActiveIndex ? activeOptionRef : undefined}
                className={`combobox-option${i === safeActiveIndex ? " active" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addOption(opt);
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
