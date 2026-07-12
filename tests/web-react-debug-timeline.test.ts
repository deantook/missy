import { describe, expect, it } from "vitest";
import { DebugTimeline, type ClientDebugEvent } from "../web/src/lib/debug-timeline.ts";

describe("DebugTimeline", () => {
  it("clears on start and appends events", () => {
    const timeline = new DebugTimeline();
    timeline.append({ kind: "note", message: "old" });
    timeline.clear();
    expect(timeline.entries).toEqual([]);
    timeline.append({ kind: "mcp", action: "connect" });
    timeline.append({ kind: "thinking", delta: "a" });
    timeline.append({ kind: "thinking", delta: "b" });
    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries[1]).toMatchObject({ kind: "thinking", text: "ab" });
  });

  it("stores error details", () => {
    const timeline = new DebugTimeline();
    timeline.setError({ code: "AGENT_ERROR", message: "x", stack: "stack" });
    expect(timeline.error?.stack).toBe("stack");
    timeline.clear();
    expect(timeline.error).toBeNull();
  });
});
