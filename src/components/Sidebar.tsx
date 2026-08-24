import {
  Activity,
  BarChart3,
  BookOpenCheck,
  BrainCircuit,
  CircleHelp,
  Cable,
  FileWarning,
  Gauge,
  History,
  Settings,
} from "lucide-react";

const navigation = [
  { label: "Overview", icon: Gauge },
  { label: "Connect", icon: Cable },
  { label: "Incidents", icon: FileWarning },
  { label: "Analytics", icon: BarChart3 },
  { label: "Constitution", icon: BookOpenCheck },
  { label: "Knowledge", icon: BrainCircuit },
  { label: "Questions", icon: CircleHelp },
  { label: "Replays", icon: History },
  { label: "Runs", icon: Activity },
  { label: "Settings", icon: Settings },
];

export function Sidebar({
  active,
  onNavigate,
}: {
  active: string;
  onNavigate: (label: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">Software Oath</div>
      <nav aria-label="Primary navigation">
        {navigation.map(({ label, icon: Icon }) => (
          <button
            aria-label={label}
            aria-current={active === label ? "page" : undefined}
            className={`nav-item ${active === label ? "is-active" : ""}`}
            key={label}
            onClick={() => onNavigate(label)}
            type="button"
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="workspace-switcher">
        <span className="workspace-avatar">SO</span>
        <span>
          <strong>Connected workspace</strong>
          <small>GitHub repositories</small>
        </span>
      </div>
    </aside>
  );
}
