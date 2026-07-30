import { ExternalLink, FileCode2, ShieldCheck } from "lucide-react";
import { useState } from "react";

import type { RepairRun } from "../domain/types";

const tabs = ["Summary", "Diff", "Tests", "Receipt"] as const;
type Tab = (typeof tabs)[number];

interface EvidencePanelProps {
  run: RepairRun;
}

export function EvidencePanel({ run }: EvidencePanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("Summary");

  return (
    <section className="evidence-section" aria-labelledby="patch-heading">
      <div className="patch-header">
        <div className="patch-icon">
          <ShieldCheck aria-hidden="true" size={22} />
        </div>
        <div>
          <span className="section-label">Patch summary</span>
          <h2 id="patch-heading">{run.repair.summary}</h2>
        </div>
        <button className="text-action" type="button">
          View reproduction <ExternalLink aria-hidden="true" size={14} />
        </button>
      </div>

      <div className="file-list" aria-label="Changed files">
        <span>Files</span>
        {run.repair.files.map((file) => (
          <span className="file-token" key={file}>
            <FileCode2 aria-hidden="true" size={14} />
            {file}
          </span>
        ))}
      </div>

      <div className="tab-row" role="tablist" aria-label="Repair evidence">
        <div>
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab}
              className={activeTab === tab ? "is-selected" : ""}
              key={tab}
              onClick={() => setActiveTab(tab)}
              role="tab"
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>
        <span className="evidence-stamp">
          <ShieldCheck aria-hidden="true" size={13} />
          Evidence verified
        </span>
      </div>

      <div className="evidence-frame" role="tabpanel">
        {activeTab === "Summary" || activeTab === "Diff" ? (
          <>
            <div className="code-header">
              <span>{run.repair.files[0]}</span>
              <span className="modified-label">Modified</span>
            </div>
            <pre className="diff" aria-label="Proposed code diff">
              {run.repair.diff.map((line, index) => (
                <code
                  className={
                    line.startsWith("+")
                      ? "added"
                      : line.startsWith("-")
                        ? "removed"
                        : ""
                  }
                  key={`${line}-${index}`}
                >
                  <span>{String(index + 184).padStart(3, "0")}</span>
                  {line}
                </code>
              ))}
            </pre>
          </>
        ) : null}
        {activeTab === "Tests" ? (
          <div className="test-list">
            {run.evidence
              .filter((evidence) => evidence.kind !== "review")
              .map((evidence) => (
                <div key={evidence.ruleId}>
                  <ShieldCheck aria-hidden="true" size={17} />
                  <span>
                    <strong>{evidence.summary}</strong>
                    <small>
                      {evidence.command} · {evidence.durationMs} ms
                    </small>
                  </span>
                </div>
              ))}
          </div>
        ) : null}
        {activeTab === "Receipt" ? (
          <dl className="receipt">
            <div>
              <dt>Run</dt>
              <dd>{run.id}</dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd>{run.repository.commit}</dd>
            </div>
            <div>
              <dt>Evidence records</dt>
              <dd>{run.evidence.length}</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>Deterministic local engine</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </section>
  );
}
