import { describe, expect, it } from "vitest";
import { parseChoicePrompt, visibleAssistantContent } from "../web/src/lib/choice-prompt.ts";

describe("choice prompt protocol", () => {
  const content = `需要先确认你的目标岗位。\n\n\`\`\`choice_prompt
{"mode":"multiple","question":"你希望重点准备哪些方向？","options":[{"label":"Java 基础"},{"label":"Spring Boot","description":"项目搭建与常用组件"}],"allowOther":true,"submitLabel":"开始制定"}
\`\`\``;

  it("parses a valid single or multiple choice prompt", () => {
    expect(parseChoicePrompt(content)).toEqual({
      mode: "multiple",
      question: "你希望重点准备哪些方向？",
      options: [{ label: "Java 基础" }, { label: "Spring Boot", description: "项目搭建与常用组件" }],
      fields: [],
      allowOther: true,
      submitLabel: "开始制定",
    });
  });

  it("keeps protocol details out of the visible assistant message", () => {
    expect(visibleAssistantContent(content)).toBe("需要先确认你的目标岗位。");
    expect(visibleAssistantContent("回答中\n```choice_prompt\n{\"mode\":" )).toBe("回答中");
  });

  it("parses an embedded prompt and preserves normal text after it", () => {
    const response = `${content}\n\n另外补充：选择后我会继续制定计划。`;
    expect(parseChoicePrompt(response)?.options).toHaveLength(2);
    expect(visibleAssistantContent(response)).toBe("需要先确认你的目标岗位。\n\n另外补充：选择后我会继续制定计划。");
  });

  it("rejects malformed and unsafe prompt shapes", () => {
    expect(parseChoicePrompt("```choice_prompt\n{}\n```" )).toBeNull();
    expect(parseChoicePrompt(`\`\`\`choice_prompt\n{"mode":"single","question":"Q","options":[{"label":"only"}]}\n\`\`\``)).toBeNull();
  });

  it("parses a mixed input form for information collection", () => {
    const form = `\`\`\`choice_prompt
{"mode":"form","question":"请填写基础信息","fields":[{"id":"height","label":"身高","type":"number","unit":"cm","min":100,"max":250},{"id":"gender","label":"性别","type":"single","options":[{"label":"男"},{"label":"女"}]}],"submitLabel":"生成计划"}
\`\`\``;
    expect(parseChoicePrompt(form)).toMatchObject({
      mode: "form",
      question: "请填写基础信息",
      options: [],
      allowOther: false,
      fields: [
        { id: "height", label: "身高", type: "number", unit: "cm", min: 100, max: 250, required: true },
        { id: "gender", label: "性别", type: "single", required: true, options: [{ label: "男" }, { label: "女" }] },
      ],
    });
  });

  it("accepts and hides the XML wrapper emitted by some models", () => {
    const response = `先收集一下你的基础信息。\n\n<choice_prompt>\n{"mode":"form","question":"请填写基本信息","fields":[{"id":"height","label":"身高","type":"number","unit":"cm"}],"submitLabel":"继续"}\n</choice_prompt>`;
    expect(parseChoicePrompt(response)).toMatchObject({ mode: "form", question: "请填写基本信息" });
    expect(visibleAssistantContent(response)).toBe("先收集一下你的基础信息。");
    expect(visibleAssistantContent("说明\n<choice_prompt>\n{\"mode\":")).toBe("说明");
  });
});
