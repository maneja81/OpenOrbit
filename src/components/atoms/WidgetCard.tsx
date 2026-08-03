import { ReactNode, useState } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";

interface WidgetCardProps {
  title: string;
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
  defaultCollapsed?: boolean;
  /** Stable id for the card shell — used as a tour step target (see src/lib/tourSteps.ts). */
  id?: string;
}

export default function WidgetCard({
  title,
  headerRight,
  children,
  className,
  defaultCollapsed = false,
  id,
}: WidgetCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div id={id} className={`widget-card${collapsed ? " collapsed" : ""}${className ? ` ${className}` : ""}`}>
      <div className="widget-card-header">
        <div className="widget-card-header-left">
          <button
            className="widget-collapse-btn"
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            onClick={() => setCollapsed((c) => !c)}
          >
            <TablerIcon name="ti-chevron-down" />
          </button>
          <span className="widget-card-title">{title}</span>
        </div>
        {!collapsed && headerRight}
      </div>
      {!collapsed && <div className="widget-card-body">{children}</div>}
    </div>
  );
}
