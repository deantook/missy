import { describe, expect, it } from "vitest";
import {
  latestCreatedParentTaskId,
  parentTaskCreationNeedsVerification,
} from "../src/conversation.ts";

const ai = (calls: Array<{ id: string; name: string; args?: Record<string, unknown> }>) => ({
  tool_calls: calls,
  getType: () => "ai",
});
const tool = (id: string, status: "success" | "error" = "success", content?: unknown) => ({
  tool_call_id: id,
  status,
  content,
  getType: () => "tool",
});

describe("parentTaskCreationNeedsVerification", () => {
  it("does not trigger on a single create_task", () => {
    const result = {
      messages: [
        ai([{ id: "t1", name: "create_task", args: { title: "alone" } }]),
        tool("t1", "success", '{"id":"task-1"}'),
      ],
    };
    expect(parentTaskCreationNeedsVerification(result)).toBe(false);
  });

  it("does not trigger on batch_add_tasks alone (flat batch)", () => {
    const result = {
      messages: [
        ai([{
          id: "b1",
          name: "batch_add_tasks",
          args: { tasks: [{ title: "A" }, { title: "B" }] },
        }]),
        tool("b1"),
      ],
    };
    expect(parentTaskCreationNeedsVerification(result)).toBe(false);
  });

  it("triggers when parent create_task is followed by child creates without parentId", () => {
    const result = {
      messages: [
        ai([{ id: "p1", name: "create_task", args: { title: "父" } }]),
        tool("p1", "success", '{"id":"parent-1"}'),
        ai([
          { id: "c1", name: "create_task", args: { title: "子1" } },
          { id: "c2", name: "create_task", args: { title: "子2" } },
        ]),
        tool("c1"),
        tool("c2"),
      ],
    };
    expect(parentTaskCreationNeedsVerification(result)).toBe(true);
    expect(latestCreatedParentTaskId(result)).toBe("parent-1");
  });

  it("triggers when parent create_task is followed by batch_add_tasks missing parentId", () => {
    const result = {
      messages: [
        ai([{ id: "p1", name: "create_task", args: { title: "父" } }]),
        tool("p1", "success", { id: "parent-9" }),
        ai([{
          id: "b1",
          name: "batch_add_tasks",
          args: { items: [{ title: "子1" }, { title: "子2", parentId: "parent-9" }] },
        }]),
        tool("b1"),
      ],
    };
    expect(parentTaskCreationNeedsVerification(result)).toBe(true);
  });

  it("passes when subsequent writes include parentId", () => {
    const result = {
      messages: [
        ai([{ id: "p1", name: "create_task", args: { title: "父" } }]),
        tool("p1", "success", '{"id":"parent-1"}'),
        ai([
          { id: "c1", name: "create_task", args: { title: "子1", parentId: "parent-1", sortOrder: 1 } },
          { id: "c2", name: "create_task", args: { title: "子2", parentId: "parent-1", sortOrder: 2 } },
        ]),
        tool("c1"),
        tool("c2"),
      ],
    };
    expect(parentTaskCreationNeedsVerification(result)).toBe(false);
  });

  it("prefers task id over projectId in create_task response", () => {
    const result = {
      messages: [
        ai([{ id: "p1", name: "create_task", args: { title: "父" } }]),
        tool("p1", "success", { id: "parent-1", projectId: "proj-x" }),
      ],
    };
    expect(latestCreatedParentTaskId(result)).toBe("parent-1");
  });

  it("ignores failed child tool calls", () => {
    const result = {
      messages: [
        ai([{ id: "p1", name: "create_task", args: { title: "父" } }]),
        tool("p1", "success", '{"id":"parent-1"}'),
        ai([{ id: "c1", name: "create_task", args: { title: "子1" } }]),
        tool("c1", "error"),
      ],
    };
    expect(parentTaskCreationNeedsVerification(result)).toBe(false);
  });
});
