import { GitBranch } from "lucide-react";
import { useEffect, useState } from "react";

import { AnalyticsDashboard } from "./components/AnalyticsDashboard.js";
import { ConnectRepository } from "./components/ConnectRepository.js";
import { ConstitutionView } from "./components/ConstitutionView.js";
import { DashboardDataProvider, useDashboardData } from "./components/DashboardData.js";
import { DependencyOptimizer } from "./components/DependencyOptimizer.js";
import { IncidentReplayWorkspace } from "./components/IncidentReplayWorkspace.js";
import { OverviewDashboard } from "./components/OverviewDashboard.js";
import { RepositoryIntelligence } from "./components/RepositoryIntelligence.js";
import { ReviewWorkspace } from "./components/ReviewWorkspace.js";
import { RunHistory } from "./components/RunHistory.js";
import { SettingsView } from "./components/SettingsView.js";
import { Sidebar } from "./components/Sidebar.js";

const views = new Set([
  "Overview", "Connect", "Incidents", "Analytics", "Constitution", "Knowledge",
  "Questions", "Optimizer", "Replays", "Runs", "Settings",
]);

function initialView(): string {
  const requested = new URLSearchParams(window.location.search).get("view");
  return requested && views.has(requested) ? requested : "Incidents";
}

function Workspace() {
  const [view, setView] = useState(initialView);
  const { repositories, repository, review, stale, refreshing, selectRepository } =
    useDashboardData();

  useEffect(() => {
    const restore = () => setView(initialView());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function navigate(next: string) {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.pushState({}, "", url);
  }

  function mainView() {
    switch (view) {
      case "Overview": return <OverviewDashboard />;
      case "Connect": return <ConnectRepository />;
      case "Analytics": return <AnalyticsDashboard />;
      case "Constitution": return <ConstitutionView />;
      case "Settings": return <SettingsView />;
      case "Runs": return <RunHistory />;
      case "Optimizer": return <DependencyOptimizer />;
      case "Replays": return <IncidentReplayWorkspace />;
      case "Knowledge":
      case "Questions": return <RepositoryIntelligence initialTab={view} onTabChange={navigate} />;
      default: return <ReviewWorkspace />;
    }
  }

  return (
    <div className="app-shell">
      <Sidebar active={view} onNavigate={navigate} />
      <header className="topbar">
        <GitBranch aria-hidden="true" size={16} />
        <select
          aria-label="Active repository"
          className="repo-selector"
          value={repository?.repository ?? ""}
          onChange={(event) => selectRepository(event.target.value)}
        >
          {!repositories.length ? <option value="">No repository connected</option> : null}
          {repositories.map(({ repository }) => <option key={repository} value={repository}>{repository}</option>)}
        </select>
        <span className="engine-label">Connected evidence engine · API v1</span>
      </header>
      {mainView()}
      <footer className="statusbar">
        <span><i />{stale ? "Control plane reconnecting" : refreshing ? "Refreshing" : "Control plane connected"}</span>
        <span>{repository?.defaultBranch ? `Branch ${repository.defaultBranch}` : "No repository"}</span>
        <span>{review?.receipt.verification.report.summary.passed ?? 0} rules passed</span>
        <span>{review?.receipt.verification.report.summary.humanReview ?? 0} human review</span>
      </footer>
    </div>
  );
}

export default function App() {
  return <DashboardDataProvider><Workspace /></DashboardDataProvider>;
}
