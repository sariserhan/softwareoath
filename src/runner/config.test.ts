import { describe, expect, it } from "vitest";
import { hostedRunnerFromEnvironment } from "./config";

describe("hosted runner configuration", () => {
  it("fails closed without an image", () => {
    expect(() => hostedRunnerFromEnvironment({})).toThrow(
      "SOFTWARE_OATH_RUNNER_BROKER_URL",
    );
  });

  it("requires a broker token", () => {
    expect(() =>
      hostedRunnerFromEnvironment({
        SOFTWARE_OATH_RUNNER_BROKER_URL: "http://runner-broker:8790",
      }),
    ).toThrow("SOFTWARE_OATH_RUNNER_BROKER_TOKEN");
  });

  it("creates a Docker runner for complete configuration", () => {
    expect(
      hostedRunnerFromEnvironment({
        SOFTWARE_OATH_RUNNER_BROKER_URL: "http://runner-broker:8790",
        SOFTWARE_OATH_RUNNER_BROKER_TOKEN: "secret",
      }).name,
    ).toBe("runner-broker:none");
  });
});
