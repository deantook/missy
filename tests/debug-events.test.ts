import { describe, expect, it } from "vitest";
import {
  previewText,
  serializeDebugError,
  debugEventsFromStreamMessage,
} from "../src/debug-events.ts";

describe("debug-events", () => {
  it("truncates preview to 2048 chars with ellipsis", () => {
    const long = "x".repeat(3000);
    const preview = previewText(long);
    expect(preview.length).toBe(2048 + 1); // 2048 + "…"
    expect(preview.endsWith("…")).toBe(true);
  });

  it("serializes stack and cause only for debug payloads", () => {
    const err = new Error("boom");
    err.cause = new Error("root");
    const full = serializeDebugError(err, "AGENT_ERROR", true);
    expect(full).toMatchObject({ code: "AGENT_ERROR", message: "boom" });
    expect(full.stack).toContain("Error: boom");
    expect(full.cause).toContain("root");
    const slim = serializeDebugError(err, "AGENT_ERROR", false);
    expect(slim).toEqual({ code: "AGENT_ERROR", message: "boom" });
    expect(slim).not.toHaveProperty("stack");
  });

  it("extracts thinking, tool_call and tool_result from stream messages", () => {
    const thinking = debugEventsFromStreamMessage({
      getType: () => "ai",
      content: [{ type: "reasoning", reasoning: "先查清单" }],
    });
    expect(thinking).toEqual([{ kind: "thinking", delta: "先查清单" }]);

    const call = debugEventsFromStreamMessage({
      getType: () => "ai",
      tool_calls: [{ id: "c1", name: "list_tasks", args: { date: "today" } }],
    });
    expect(call).toEqual([{
      kind: "tool_call", name: "list_tasks", args: { date: "today" }, id: "c1",
    }]);

    const result = debugEventsFromStreamMessage({
      getType: () => "tool",
      name: "list_tasks",
      tool_call_id: "c1",
      status: "success",
      content: "ok-payload",
    });
    expect(result).toEqual([{
      kind: "tool_result", name: "list_tasks", ok: true, preview: "ok-payload", id: "c1",
    }]);
  });
});
