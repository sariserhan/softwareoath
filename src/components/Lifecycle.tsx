import { Check } from "lucide-react";

const stages = [
  ["Detected", "09:41", "by monitor"],
  ["Reproduced", "09:49", "in staging"],
  ["Patched", "10:02", "proposed fix"],
  ["Verified", "10:18", "checks complete"],
  ["Awaiting approval", "Now", "human decision"],
];

export function Lifecycle() {
  return (
    <ol className="lifecycle" aria-label="Repair lifecycle">
      {stages.map(([label, time, detail], index) => {
        const complete = index < stages.length - 1;
        return (
          <li className={complete ? "is-complete" : "is-current"} key={label}>
            <span className="stage-marker">
              {complete ? <Check aria-hidden="true" size={15} /> : index + 1}
            </span>
            <span className="stage-copy">
              <strong>{label}</strong>
              <small>{time}</small>
              <small>{detail}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
