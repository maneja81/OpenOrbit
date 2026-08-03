import { useState } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";

export interface SettingsNavItem {
  id: string;
  label: string;
  icon: string;
  danger?: boolean;
}

export interface SettingsNavGroup {
  label?: string;
  items: SettingsNavItem[];
}

interface SettingsSidebarProps {
  groups: SettingsNavGroup[];
  activeSection: string;
  onChange: (id: string) => void;
}

export default function SettingsSidebar({ groups, activeSection, onChange }: SettingsSidebarProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  return (
    <aside className="settings-sidebar">
      <div className="sidebar-titlebar">
        <TablerIcon name="ti-settings" />
        <span>Settings</span>
      </div>
      <div className="sidebar-search">
        <TablerIcon name="ti-search" />
        <input
          type="text"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search settings"
        />
      </div>
      <nav className="sidebar-nav" role="tablist">
        {groups.map((group, groupIndex) => {
          const visibleItems = normalizedQuery
            ? group.items.filter((item) => item.label.toLowerCase().includes(normalizedQuery))
            : group.items;
          if (visibleItems.length === 0) return null;
          return (
            <div className="sidebar-group" key={group.label || groupIndex}>
              {group.label && <div className="sidebar-group-label">{group.label}</div>}
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={activeSection === item.id}
                  className={`sidebar-item${activeSection === item.id ? " active" : ""}${item.danger ? " danger" : ""}`}
                  onClick={() => onChange(item.id)}
                >
                  <TablerIcon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
