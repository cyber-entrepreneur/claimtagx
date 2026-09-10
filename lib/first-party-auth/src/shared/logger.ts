/** Outbound port for structured logging. Never log secrets/tokens/codes. */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string, context?: Readonly<Record<string, unknown>>): void;
}

export const noopLogger: Logger = {
  log() {
    /* intentionally empty */
  },
};
