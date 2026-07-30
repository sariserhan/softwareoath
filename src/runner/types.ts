export interface CommandRequest {
  command: string;
  workspacePath: string;
  timeoutMs: number;
}

export interface CommandResult {
  exitCode: number | null;
  output: string;
  durationMs: number;
}

export interface TrustedRunner {
  readonly name: string;
  execute(request: CommandRequest): Promise<CommandResult>;
}
