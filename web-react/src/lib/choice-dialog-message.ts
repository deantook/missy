import type { ChoiceField } from "./choice-prompt.ts";

export type ChoiceFormValues = Record<string, string | string[]>;

export function buildSelectionChoiceMessage(labels: string[], custom: string): string {
  const trimmed = custom.trim();
  const parts = labels.length ? [`我的选择：${labels.join("、")}`] : [];
  if (trimmed) parts.push(`补充：${trimmed}`);
  return parts.join("；");
}

export function buildFormChoiceMessage(fields: ChoiceField[], values: ChoiceFormValues): string {
  const answers = fields.flatMap((field) => {
    const value = values[field.id];
    const selected = Array.isArray(value) ? value : [value?.trim()].filter(Boolean);
    if (!selected.length) return [];
    const unit = field.unit && field.type === "number" ? ` ${field.unit}` : "";
    return [`${field.label}：${selected.join("、")}${unit}`];
  });
  return `我的信息：${answers.join("；")}`;
}
