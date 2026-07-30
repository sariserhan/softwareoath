import {
  Activity,
  BookOpenCheck,
  FileWarning,
  Gauge,
  Settings,
} from "lucide-react";

const navigation = [
  { label: "Overview", icon: Gauge },
  { label: "Incidents", icon: FileWarning, active: true },
  { label: "Constitution", icon: BookOpenCheck },
  { label: "Runs", icon: Activity },
  { label: "Settings", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">Software Oath</div>
      <nav aria-label="Primary navigation">
        {navigation.map(({ label, icon: Icon, active }) => (
          <button
            aria-current={active ? "page" : undefined}
            className={`nav-item ${active ? "is-active" : ""}`}
            key={label}
            type="button"
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="workspace-switcher">
        <span className="workspace-avatar">AE</span>
        <span>
          <strong>Acme Engineering</strong>
          <small>Production workspace</small>
        </span>
      </div>
    </aside>
  );
}
