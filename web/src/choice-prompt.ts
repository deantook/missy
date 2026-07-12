export type ChoiceOption = { label: string; description?: string };
export type ChoiceField = {
  id: string;
  label: string;
  type: "text" | "number" | "single" | "multiple";
  required: boolean;
  placeholder?: string;
  unit?: string;
  min?: number;
  max?: number;
  options?: ChoiceOption[];
};
export type ChoicePrompt = {
  mode: "single" | "multiple" | "form";
  question: string;
  options: ChoiceOption[];
  fields: ChoiceField[];
  allowOther: boolean;
  submitLabel: string;
};

const fencedBlockPattern = /(?:^|\n)```choice_prompt[ \t]*\r?\n([\s\S]*?)\r?\n```/;
const xmlBlockPattern = /(?:^|\n)<choice_prompt>[ \t]*\r?\n([\s\S]*?)\r?\n<\/choice_prompt>/;
const unfinishedBlockPattern = /(?:^|\n)(?:```choice_prompt(?:[ \t]*\r?\n)?|<choice_prompt>(?:[ \t]*\r?\n)?)[\s\S]*$/;

function protocolBlock(content: string): RegExpMatchArray | null {
  const fenced = content.match(fencedBlockPattern);
  const xml = content.match(xmlBlockPattern);
  if (!fenced) return xml;
  if (!xml) return fenced;
  return (fenced.index ?? 0) <= (xml.index ?? 0) ? fenced : xml;
}

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

function parseOptions(value: unknown): ChoiceOption[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) return null;
  const options = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const label = shortText(record.label, 80);
    const description = record.description === undefined ? undefined : shortText(record.description, 160);
    return label && description !== null ? { label, ...(description ? { description } : {}) } : null;
  });
  return options.some((option) => option === null) ? null : options as ChoiceOption[];
}

function parseFields(value: unknown): ChoiceField[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return null;
  const ids = new Set<string>();
  const fields = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const id = shortText(record.id, 40);
    const label = shortText(record.label, 80);
    const type = record.type;
    if (!id || !/^[a-zA-Z][\w-]*$/.test(id) || ids.has(id) || !label || !["text", "number", "single", "multiple"].includes(String(type))) return null;
    ids.add(id);
    const options = type === "single" || type === "multiple" ? parseOptions(record.options) : undefined;
    if ((type === "single" || type === "multiple") && !options) return null;
    const placeholder = record.placeholder === undefined ? undefined : shortText(record.placeholder, 100);
    const unit = record.unit === undefined ? undefined : shortText(record.unit, 20);
    const min = typeof record.min === "number" && Number.isFinite(record.min) ? record.min : undefined;
    const max = typeof record.max === "number" && Number.isFinite(record.max) ? record.max : undefined;
    if (placeholder === null || unit === null || (min !== undefined && max !== undefined && min > max)) return null;
    return { id, label, type: type as ChoiceField["type"], required: record.required !== false, ...(placeholder ? { placeholder } : {}), ...(unit ? { unit } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(options ? { options } : {}) };
  });
  return fields.some((field) => field === null) ? null : fields as ChoiceField[];
}

export function parseChoicePrompt(content: string | null | undefined): ChoicePrompt | null {
  if (!content) return null;
  const match = protocolBlock(content);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]!) as Record<string, unknown>;
    if (value.mode !== "single" && value.mode !== "multiple" && value.mode !== "form") return null;
    const question = shortText(value.question, 240);
    if (!question) return null;
    const options = value.mode === "form" ? [] : parseOptions(value.options);
    const fields = value.mode === "form" ? parseFields(value.fields) : [];
    if (!options || !fields) return null;
    return {
      mode: value.mode,
      question,
      options,
      fields,
      allowOther: value.mode !== "form" && value.allowOther !== false,
      submitLabel: shortText(value.submitLabel, 24) ?? "确认选择",
    };
  } catch {
    return null;
  }
}

export function visibleAssistantContent(content: string | null | undefined): string {
  const value = content ?? "";
  const completeBlock = protocolBlock(value);
  if (completeBlock?.index !== undefined) {
    const before = value.slice(0, completeBlock.index).trim();
    const after = value.slice(completeBlock.index + completeBlock[0].length).trim();
    return [before, after].filter(Boolean).join("\n\n");
  }
  return value.replace(unfinishedBlockPattern, "").trim();
}
