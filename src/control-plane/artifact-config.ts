import { S3Client } from "@aws-sdk/client-s3";

import { LocalArtifactStore, type ArtifactStore } from "./artifacts";
import { S3ArtifactStore } from "./s3-artifacts";

export function artifactStoreFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ArtifactStore {
  const bucket = environment.SOFTWARE_OATH_ARTIFACT_S3_BUCKET;
  if (!bucket) {
    if (environment.SOFTWARE_OATH_REQUIRE_DURABLE_ARTIFACTS === "true") {
      throw new Error("Durable S3 artifact storage is required.");
    }
    return new LocalArtifactStore(
      environment.SOFTWARE_OATH_ARTIFACT_PATH ?? ".software-oath/artifacts",
    );
  }
  const retentionDays = Number(environment.SOFTWARE_OATH_ARTIFACT_RETENTION_DAYS ?? 365);
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("SOFTWARE_OATH_ARTIFACT_RETENTION_DAYS must be a positive integer.");
  }
  return new S3ArtifactStore(
    new S3Client({
      region: environment.AWS_REGION,
      endpoint: environment.SOFTWARE_OATH_ARTIFACT_S3_ENDPOINT,
      forcePathStyle: environment.SOFTWARE_OATH_ARTIFACT_S3_FORCE_PATH_STYLE === "true",
    }),
    bucket,
    environment.SOFTWARE_OATH_ARTIFACT_S3_PREFIX ?? "software-oath",
    environment.SOFTWARE_OATH_MEMORY_PATH ?? ".software-oath/memory",
    retentionDays,
    environment.SOFTWARE_OATH_ARTIFACT_KMS_KEY_ID,
  );
}
