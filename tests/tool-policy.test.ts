import { describe, expect, it } from "vitest";
import { blockedToolNames, filterAgentTools, isBlockedToolName } from "../src/tool-policy.ts";

describe("tool-policy", () => {
  it("blocks habit and tag tool names case-insensitively", () => {
    expect(isBlockedToolName("list_habits")).toBe(true);
    expect(isBlockedToolName("Create_Habit")).toBe(true);
    expect(isBlockedToolName("list_tags")).toBe(true);
    expect(isBlockedToolName("CREATE_TAG")).toBe(true);
    expect(isBlockedToolName("create_task")).toBe(false);
    expect(isBlockedToolName("list_projects")).toBe(false);
  });

  it("filters blocked tools and reports their names", () => {
    const tools = [
      { name: "create_task" },
      { name: "list_habits" },
      { name: "list_tags" },
      { name: "list_projects" },
      { name: "get_habit" },
    ];
    expect(filterAgentTools(tools).map((t) => t.name)).toEqual(["create_task", "list_projects"]);
    expect(blockedToolNames(tools).sort()).toEqual(["get_habit", "list_habits", "list_tags"]);
  });

  it("keeps tools without a name", () => {
    expect(filterAgentTools([{}])).toEqual([{}]);
  });
});
