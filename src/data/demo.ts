import oathSource from "../../examples/storefront/software-oath.yml?raw";
import runSource from "../../examples/storefront/repair-run.json?raw";
import { evaluateOath, parseOath } from "../domain/oath";
import type { RepairRun } from "../domain/types";

export const demoOath = parseOath(oathSource);
export const demoRun = JSON.parse(runSource) as RepairRun;
export const demoReport = evaluateOath(
  demoOath,
  demoRun,
  "2026-05-12T10:18:00Z",
);
