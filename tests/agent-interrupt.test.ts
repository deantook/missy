import { describe, expect, it } from "vitest";
import { buildDeleteInterruptOn } from "../src/agent.ts";

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
