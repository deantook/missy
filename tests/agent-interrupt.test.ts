import { describe, expect, it } from "vitest";
import { buildDeleteInterruptOn } from "../src/agent.ts";
import { createdProjectWithoutTasks, projectCreationNeedsVerification, successfulToolNames } from "../src/conversation.ts";

describe("buildDeleteInterruptOn", () => {
  it("maps tools whose names start with delete_", () => {
    const tools = [
      { name: "delete_task" },
      { name: "create_task" },
      { name: "delete_focus" },
      { name: "list_projects" },
    ];
    const map = buildDeleteInterruptOn(tools);
    expect(Object.keys(map).sort()).toEqual(["delete_focus", "delete_task"]);
    expect(map.delete_task).toEqual({ allowedDecisions: ["approve", "reject"] });
  });

  it("returns empty object when no delete tools", () => {
    expect(buildDeleteInterruptOn([{ name: "create_task" }])).toEqual({});
  });
});

describe("project creation consistency", () => {
  const ai = (calls: Array<{ id: string; name: string }>) => ({ tool_calls: calls, getType: () => "ai" });
  const tool = (id: string, status: "success" | "error" = "success") => ({ tool_call_id: id, status, getType: () => "tool" });

  it("detects a successfully created project with no created tasks", () => {
    const result = { messages: [ai([{ id: "p1", name: "create_project" }]), tool("p1")] };
    expect(successfulToolNames(result)).toEqual(["create_project"]);
    expect(createdProjectWithoutTasks(result)).toBe(true);
  });

  it("requires a successful task write before considering the project populated", () => {
    const failed = { messages: [
      ai([{ id: "p1", name: "create_project" }, { id: "t1", name: "batch_add_tasks" }]),
      tool("p1"), tool("t1", "error"),
    ] };
    expect(createdProjectWithoutTasks(failed)).toBe(true);

    const succeeded = { messages: [
      ...failed.messages,
      ai([{ id: "t2", name: "batch_add_tasks" }]), tool("t2"),
    ] };
    expect(createdProjectWithoutTasks(succeeded)).toBe(false);
    expect(projectCreationNeedsVerification(succeeded)).toBe(true);

    const verified = { messages: [
      ...succeeded.messages,
      ai([{ id: "v1", name: "get_project_with_undone_tasks" }]), tool("v1"),
    ] };
    expect(projectCreationNeedsVerification(verified)).toBe(false);
  });
});
