import { describe, expect, it } from "vitest";
import type { ChoiceField } from "../web-react/src/lib/choice-prompt.ts";
import { buildFormChoiceMessage, buildSelectionChoiceMessage } from "../web-react/src/lib/choice-dialog-message.ts";

describe("web-react ChoiceDialog message assembly", () => {
  it("assembles selection answers like the vanilla dialog", () => {
    expect(buildSelectionChoiceMessage(["Java 基础", "Spring Boot"], "偏后端")).toBe(
      "我的选择：Java 基础、Spring Boot；补充：偏后端",
    );
    expect(buildSelectionChoiceMessage([], "自由补充")).toBe("补充：自由补充");
  });

  it("assembles form answers like the vanilla dialog", () => {
    const fields: ChoiceField[] = [
      { id: "height", label: "身高", type: "number", required: true, unit: "cm" },
      {
        id: "gender",
        label: "性别",
        type: "single",
        required: true,
        options: [{ label: "男" }, { label: "女" }],
      },
      {
        id: "goals",
        label: "目标",
        type: "multiple",
        required: true,
        options: [{ label: "力量" }, { label: "减脂" }],
      },
    ];

    expect(
      buildFormChoiceMessage(fields, {
        height: "175",
        gender: ["女"],
        goals: ["力量", "减脂"],
      }),
    ).toBe("我的信息：身高：175 cm；性别：女；目标：力量、减脂");
  });
});
