export interface CommandRequest {
  command: string;
  workspacePath: string;
  timeoutMs: number;
  readOnly?: boolean;
}

export interface CommandResult {
  exitCode: number | null;
  output: string;
  durationMs: number;
}

export interface TrustedRunner {
  readonly name: string;
  identity?(): Promise<string>;
  execute(request: CommandRequest): Promise<CommandResult>;
}
