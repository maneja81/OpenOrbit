import { ReactNode, useState } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";

interface SettingsAccordionProps {
  icon?: string;
  title: string;
  status?: ReactNode;
  headerActions?: ReactNode;
  disabled?: boolean;
  defaultOpen?: boolean;
  // Controlled mode (both provided): caller owns open state, e.g. to trigger an
  // async fetch on expand. Uncontrolled otherwise, using defaultOpen/internal state.
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}

/** Generic collapsible section reusing the `.agent-accordion*` shell (chevron header + body),
 * for settings screens (Models, Connectors) that need the same look as AgentAccordion without
 * its agent-specific fields. */
export default function SettingsAccordion({
  icon,
  title,
  status,
  headerActions,
  disabled,
  defaultOpen = false,
  open: openProp,
  onToggle,
  children,
}: SettingsAccordionProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const toggle = () => (onToggle ? onToggle(!open) : setOpenState((o) => !o));

  return (
    <div className={`agent-accordion${disabled ? " disabled" : ""}`}>
      <div className="agent-accordion-header">
        <button
          className="agent-accordion-header-toggle"
          onClick={toggle}
          aria-expanded={open}
        >
          <TablerIcon name="ti-chevron-right" className={`agent-accordion-chevron${open ? " open" : ""}`} />
          {icon && <TablerIcon name={icon} className="agent-accordion-icon" />}
          <span className="agent-accordion-name">{title}</span>
          {status}
        </button>
        <span className="agent-accordion-spacer" />
        {headerActions}
      </div>

      {open && <div className="agent-accordion-body">{children}</div>}
    </div>
  );
}
