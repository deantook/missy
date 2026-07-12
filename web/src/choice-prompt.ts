export type ChoicePrompt = {
  mode: "single" | "multiple";
  question: string;
  options: Array<{ label: string; description?: string }>;
  allowOther: boolean;
  submitLabel: string;
};

const blockPattern = /(?:^|\n)```choice_prompt[ \t]*\r?\n([\s\S]*?)\r?\n```/;
const unfinishedBlockPattern = /(?:^|\n)```choice_prompt(?:[ \t]*\r?\n)?[\s\S]*$/;

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

export function parseChoicePrompt(content: string | null | undefined): ChoicePrompt | null {
  if (!content) return null;
  const match = content.match(blockPattern);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]!) as Record<string, unknown>;
    if (value.mode !== "single" && value.mode !== "multiple") return null;
    const question = shortText(value.question, 240);
    if (!question || !Array.isArray(value.options) || value.options.length < 2 || value.options.length > 8) return null;
    const options = value.options.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const label = shortText(record.label, 80);
      const description = record.description === undefined ? undefined : shortText(record.description, 160);
      return label && description !== null ? { label, ...(description ? { description } : {}) } : null;
    });
    if (options.some((option) => option === null)) return null;
    return {
      mode: value.mode,
      question,
      options: options as ChoicePrompt["options"],
      allowOther: value.allowOther !== false,
      submitLabel: shortText(value.submitLabel, 24) ?? "确认选择",
    };
  } catch {
    return null;
  }
}

export function visibleAssistantContent(content: string | null | undefined): string {
  const value = content ?? "";
  const completeBlock = value.match(blockPattern);
  if (completeBlock?.index !== undefined) {
    const before = value.slice(0, completeBlock.index).trim();
    const after = value.slice(completeBlock.index + completeBlock[0].length).trim();
    return [before, after].filter(Boolean).join("\n\n");
  }
  return value.replace(unfinishedBlockPattern, "").trim();
}
