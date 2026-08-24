const REDACTION = "[REDACTED]";

export function redactSensitiveOutput(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g,
      REDACTION,
    )
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTION)
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, REDACTION)
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, `$1${REDACTION}`)
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY))=([^\s]+)/gi,
      `$1=${REDACTION}`,
    );
}
