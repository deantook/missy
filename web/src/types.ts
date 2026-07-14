import type { ClientDebugEvent } from "./lib/debug-timeline.ts";

export type { ClientDebugEvent } from "./lib/debug-timeline.ts";

export type Usage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type User = {
  id: string;
  email: string;
  displayName: string;
  didaTokenConfigured: boolean;
  didaTokenHint: string | null;
};

export type Conversation = {
  id: string;
  title: string;
  usage: Usage;
  createdAt: string;
  updatedAt: string;
};

export type Turn = {
  id: string;
  userContent: string;
  assistantContent: string | null;
  status: "pending" | "succeeded" | "failed" | "canceled" | "unknown";
  errorMessage?: string | null;
  feedback?: "like" | "dislike" | null;
  usage: Usage;
  createdAt: string;
};

export type StreamEvent =
  | { type: "start"; turn: Turn }
  | { type: "delta"; delta: string; reset?: boolean }
  | { type: "done"; turn: Turn }
  | { type: "debug"; event: ClientDebugEvent }
  | { type: "error"; error: { message?: string; code?: string; stack?: string; cause?: string } };
