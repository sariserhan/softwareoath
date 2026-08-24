import type { EvaluationMetricsV1 } from "./types";

export function evaluateLabels(
  expected: Iterable<string>,
  observed: Iterable<string>,
): EvaluationMetricsV1 {
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  const truePositive = [...observedSet].filter((item) => expectedSet.has(item)).length;
  const falsePositive = [...observedSet].filter((item) => !expectedSet.has(item)).length;
  const falseNegative = [...expectedSet].filter((item) => !observedSet.has(item)).length;
  const precision = truePositive + falsePositive === 0
    ? expectedSet.size === 0 ? 1 : 0
    : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0
    ? 1
    : truePositive / (truePositive + falseNegative);
  return {
    version: 1,
    truePositive,
    falsePositive,
    falseNegative,
    precision,
    recall,
  };
}
