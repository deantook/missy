import { describe, expect, it } from "vitest";
import { buildSystemPrompt, currentDateInShanghai } from "../src/prompts.ts";

describe("date context prompt", () => {
  it("injects the current Shanghai date and next year", () => {
    const prompt = buildSystemPrompt(new Date("2026-07-12T02:00:00.000Z"));

    expect(prompt).toContain("当前日期基准：2026-07-12（Asia/Shanghai）");
    expect(prompt).toContain("“明年”指 2027 年");
    expect(prompt).toContain("不得根据训练语料或自身知识猜测当前年份");
    expect(prompt).toContain("```choice_prompt");
    expect(prompt).toContain('"mode":"single"');
    expect(prompt).toContain('"mode":"form"');
    expect(prompt).toContain("绝不允许用普通 Markdown 列表或段落直接提问");
    expect(prompt).toContain("当前会话未开放标签工具");
    expect(prompt).toContain("当前会话未开放习惯工具");
    expect(prompt).toContain("运行时会校验父子结构");
    expect(prompt).not.toContain("创建后必须回查确认所有子任务的 parentId 与顺序正确，只有确认后才能向用户报告成功");
    expect(prompt).not.toContain("除非用户声明，否则不主动创建和使用标签功能");
    expect(prompt).not.toContain("不使用习惯功能。");
  });

  it("uses Asia/Shanghai across a UTC date boundary", () => {
    expect(currentDateInShanghai(new Date("2026-12-31T16:30:00.000Z"))).toBe("2027-01-01");
  });
});
