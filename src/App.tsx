import {
  ChevronDown,
  CircleCheck,
  GitBranch,
  GitCommitHorizontal,
  Radio,
} from "lucide-react";
import { useState } from "react";

import { ConstitutionRail } from "./components/ConstitutionRail";
import { EvidencePanel } from "./components/EvidencePanel";
import { Lifecycle } from "./components/Lifecycle";
import { Sidebar } from "./components/Sidebar";
import { demoOath, demoReport, demoRun } from "./data/demo";

type ApprovalState = "pending" | "approved" | "rejected";

export default function App() {
  const [approval, setApproval] = useState<ApprovalState>("pending");

  return (
    <div className="app-shell">
      <Sidebar />
      <header className="topbar">
        <button className="repo-selector" type="button">
          <GitBranch aria-hidden="true" size={16} />
          {demoOath.application.repository}
          <ChevronDown aria-hidden="true" size={15} />
        </button>
        <span className="engine-label">Local evidence engine · v0.1</span>
      </header>

      <main className="incident-canvas">
        <header className="incident-header">
          <div className="incident-title-row">
            <div>
              <h1>{demoRun.incident.title}</h1>
              <div className="incident-meta">
                <span>{demoRun.id}</span>
                <span>
                  <CircleCheck aria-hidden="true" size={14} />
                  {approval === "approved"
                    ? "Approved"
                    : approval === "rejected"
                      ? "Rejected"
                      : "Repair ready"}
                </span>
                <span>
                  <Radio aria-hidden="true" size={14} />
                  {demoRun.incident.source}
                </span>
                <span>
                  <GitBranch aria-hidden="true" size={14} />
                  {demoRun.repository.branch}
                </span>
                <span>
                  <GitCommitHorizontal aria-hidden="true" size={14} />
                  {demoRun.repository.commit}
                </span>
              </div>
            </div>
          </div>
          <Lifecycle />
        </header>
        <EvidencePanel run={demoRun} />
      </main>

      <ConstitutionRail onDecision={setApproval} report={demoReport} />

      <footer className="statusbar">
        <span>
          <i />
          Local demo operational
        </span>
        <span>Constitution v{demoOath.version}</span>
        <span>{demoReport.summary.passed} rules passed</span>
        <span>{demoReport.summary.humanReview} human review</span>
      </footer>
    </div>
  );
}
