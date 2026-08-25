import { AlertTriangle, Check, LockKeyhole, X } from "lucide-react";
import { useState } from "react";

import type { OathReport } from "../domain/types.js";

type ApprovalState = "pending" | "approved" | "rejected";

interface ConstitutionRailProps {
  report: OathReport;
  onDecision: (state: ApprovalState) => void;
}

export function ConstitutionRail({
  report,
  onDecision,
}: ConstitutionRailProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [decision, setDecision] = useState<ApprovalState>("pending");
  const reviewItem = report.rules.find(
    (result) => result.status === "human_review",
  );

  function decide(next: ApprovalState) {
    setDecision(next);
    onDecision(next);
  }

  return (
    <aside className="constitution-rail" aria-labelledby="constitution-heading">
      <header>
        <h2 id="constitution-heading">Constitution verification</h2>
        <p>The repair must uphold the application&apos;s living constitution.</p>
      </header>

      <div className="rule-list">
        {report.rules.map(({ rule, status, reason }) => (
          <div
            className={`rule-row ${status === "human_review" ? "needs-review" : ""}`}
            key={rule.id}
          >
            <span className="rule-status">
              {status === "passed" ? (
                <Check aria-hidden="true" size={16} />
              ) : (
                <AlertTriangle aria-hidden="true" size={17} />
              )}
            </span>
            <span>
              <strong>{rule.title}</strong>
              <small>{status === "passed" ? "Passed" : "Human review"}</small>
              {status === "human_review" ? <em>{reason}</em> : null}
            </span>
          </div>
        ))}
      </div>

      <section className="approval-block">
        <h3>Approval required</h3>
        <p>
          {reviewItem
            ? `Acknowledge “${reviewItem.rule.title}” before approving this repair.`
            : "Review the evidence before approving this repair."}
        </p>
        <label className="acknowledgement">
          <input
            checked={acknowledged}
            disabled={decision !== "pending"}
            onChange={(event) => setAcknowledged(event.target.checked)}
            type="checkbox"
          />
          <span>I reviewed and acknowledge the human-review item.</span>
        </label>

        {decision === "pending" ? (
          <div className="decision-actions">
            <button
              className="approve-button"
              disabled={!acknowledged}
              onClick={() => decide("approved")}
              type="button"
            >
              <LockKeyhole aria-hidden="true" size={16} />
              Approve pull request
            </button>
            <button
              className="reject-button"
              onClick={() => decide("rejected")}
              type="button"
            >
              <X aria-hidden="true" size={17} />
              Reject repair
            </button>
          </div>
        ) : (
          <div className={`decision-confirmation ${decision}`}>
            {decision === "approved" ? (
              <Check aria-hidden="true" size={18} />
            ) : (
              <X aria-hidden="true" size={18} />
            )}
            <span>
              <strong>
                {decision === "approved" ? "Repair approved" : "Repair rejected"}
              </strong>
              <small>
                {decision === "approved"
                  ? "Ready for GitHub pull-request integration."
                  : "The run remains preserved for audit."}
              </small>
            </span>
          </div>
        )}
      </section>
    </aside>
  );
}
