import { Command } from "@langchain/langgraph";
import type { createTaskAgent } from "./agent.ts";

export type TaskAgent = ReturnType<typeof createTaskAgent>["agent"];
export type AgentResult = Awaited<ReturnType<TaskAgent["invoke"]>>;
export type DeleteDecision = "approve" | "reject";

type ToolCall = {
  id?: string;
  name?: string;
  args?: unknown;
  arguments?: unknown;
};
type AgentMessage = {
  name?: string;
  status?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  getType?: () => string;
};

export function successfulToolNames(result: { messages?: unknown }): string[] {
  if (!Array.isArray(result.messages)) return [];
  const calls = new Map<string, string>();
  for (const raw of result.messages) {
    const message = raw as AgentMessage;
    for (const call of message.tool_calls ?? []) {
      if (call.id && call.name) calls.set(call.id, call.name);
    }
  }
  return result.messages.flatMap((raw) => {
    const message = raw as AgentMessage;
    if (message.getType?.() !== "tool" || message.status === "error") return [];
    const name = message.name ?? (message.tool_call_id ? calls.get(message.tool_call_id) : undefined);
    return name ? [name] : [];
  });
}

export function createdProjectWithoutTasks(result: { messages?: unknown }): boolean {
  const names = successfulToolNames(result);
  const createdProject = names.includes("create_project");
  const createdTasks = names.includes("create_task") || names.includes("batch_add_tasks");
  return createdProject && !createdTasks;
}

export function projectCreationNeedsVerification(result: { messages?: unknown }): boolean {
  const names = successfulToolNames(result);
  if (!names.includes("create_project")) return false;
  const createdTasks = names.includes("create_task") || names.includes("batch_add_tasks");
  return !createdTasks || !names.includes("get_project_with_undone_tasks");
}

export function latestCreatedProjectId(result: { messages?: unknown }): string | undefined {
  if (!Array.isArray(result.messages)) return undefined;
  const createCallIds = new Set<string>();
  for (const raw of result.messages) {
    const message = raw as AgentMessage;
    for (const call of message.tool_calls ?? []) {
      if (call.id && call.name === "create_project") createCallIds.add(call.id);
    }
  }
  let projectId: string | undefined;
  for (const raw of result.messages) {
    const message = raw as AgentMessage & { content?: unknown };
    if (message.getType?.() !== "tool" || message.status === "error") continue;
    const name = message.name ?? (message.tool_call_id && createCallIds.has(message.tool_call_id) ? "create_project" : undefined);
    if (name !== "create_project") continue;
    projectId = findProjectId(message.content) ?? projectId;
  }
  return projectId;
}

function findProjectId(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      return findProjectId(JSON.parse(trimmed));
    } catch {
      const match = trimmed.match(/(?:project[_ ]?id|\"id\")\s*[:=]\s*[\"']?([\w-]+)/i);
      return match?.[1];
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProjectId(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["projectId", "project_id", "id"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const key of ["text", "content", "data", "project", "result"]) {
    const found = findProjectId(record[key]);
    if (found) return found;
  }
  return undefined;
}

function findTaskId(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      return findTaskId(JSON.parse(trimmed));
    } catch {
      const match = trimmed.match(/(?:task[_ ]?id|\"id\")\s*[:=]\s*[\"']?([\w-]+)/i);
      return match?.[1];
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTaskId(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["id", "taskId", "task_id"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const key of ["text", "content", "data", "result", "task"]) {
    const found = findTaskId(record[key]);
    if (found) return found;
  }
  return undefined;
}

type SuccessfulTaskWrite = {
  callId: string;
  name: "create_task" | "batch_add_tasks";
  args: Record<string, unknown>;
};

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

function nonEmptyParentId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function createTaskParentId(args: Record<string, unknown>): string | undefined {
  return nonEmptyParentId(args.parentId);
}

function batchItems(args: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["tasks", "items"]) {
    const value = args[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item));
    }
  }
  return [];
}

function batchMissingParentId(args: Record<string, unknown>): boolean {
  const items = batchItems(args);
  if (!items.length) return true;
  return items.some((item) => !nonEmptyParentId(item.parentId));
}

function successfulTaskWrites(result: { messages?: unknown }): SuccessfulTaskWrite[] {
  if (!Array.isArray(result.messages)) return [];
  const calls = new Map<string, { name: "create_task" | "batch_add_tasks"; args: Record<string, unknown> }>();
  for (const raw of result.messages) {
    const message = raw as AgentMessage;
    for (const call of message.tool_calls ?? []) {
      if (!call.id || (call.name !== "create_task" && call.name !== "batch_add_tasks")) continue;
      calls.set(call.id, {
        name: call.name,
        args: parseArgs(call.args ?? call.arguments),
      });
    }
  }
  const writes: SuccessfulTaskWrite[] = [];
  for (const raw of result.messages) {
    const message = raw as AgentMessage;
    if (message.getType?.() !== "tool" || message.status === "error" || !message.tool_call_id) continue;
    const call = calls.get(message.tool_call_id);
    if (!call) continue;
    writes.push({ callId: message.tool_call_id, name: call.name, args: call.args });
  }
  return writes;
}

export function latestCreatedParentTaskId(result: { messages?: unknown }): string | undefined {
  if (!Array.isArray(result.messages)) return undefined;
  const writes = successfulTaskWrites(result);
  const parentCalls = writes.filter((w) => w.name === "create_task" && !createTaskParentId(w.args));
  if (!parentCalls.length) return undefined;
  const parentCallIds = new Set(parentCalls.map((w) => w.callId));
  let taskId: string | undefined;
  for (const raw of result.messages) {
    const message = raw as AgentMessage & { content?: unknown };
    if (message.getType?.() !== "tool" || message.status === "error") continue;
    if (!message.tool_call_id || !parentCallIds.has(message.tool_call_id)) continue;
    taskId = findTaskId(message.content) ?? taskId;
  }
  return taskId;
}

export function parentTaskCreationNeedsVerification(result: { messages?: unknown }): boolean {
  const writes = successfulTaskWrites(result);
  const createCount = writes.filter((w) => w.name === "create_task").length;
  const hasBatch = writes.some((w) => w.name === "batch_add_tasks");
  const multiWrite = createCount >= 2 || (createCount >= 1 && hasBatch);
  if (!multiWrite) return false;

  const parentIndex = writes.findIndex((w) => w.name === "create_task" && !createTaskParentId(w.args));
  if (parentIndex < 0) return false;

  const after = writes.slice(parentIndex + 1);
  if (!after.length) return false;

  return after.some((w) => {
    if (w.name === "create_task") return !createTaskParentId(w.args);
    return batchMissingParentId(w.args);
  });
}

export function hasRenderableChoicePrompt(message: string): boolean {
  const match = message.match(/(?:^|\n)(?:```choice_prompt[ \t]*\r?\n([\s\S]*?)\r?\n```|<choice_prompt>[ \t]*\r?\n([\s\S]*?)\r?\n<\/choice_prompt>)/);
  if (!match) return false;
  try {
    const value = JSON.parse((match[1] ?? match[2])!) as Record<string, unknown>;
    if (typeof value.question !== "string" || !value.question.trim()) return false;
    if (value.mode === "single" || value.mode === "multiple") {
      return Array.isArray(value.options) && value.options.length >= 2 && value.options.length <= 8
        && value.options.every((option) => option && typeof option === "object" && typeof (option as { label?: unknown }).label === "string");
    }
    if (value.mode !== "form" || !Array.isArray(value.fields) || value.fields.length < 1 || value.fields.length > 10) return false;
    const ids = new Set<string>();
    return value.fields.every((item) => {
      if (!item || typeof item !== "object") return false;
      const field = item as Record<string, unknown>;
      if (typeof field.id !== "string" || !/^[a-zA-Z][\w-]*$/.test(field.id) || ids.has(field.id) || typeof field.label !== "string") return false;
      ids.add(field.id);
      if (field.type === "text" || field.type === "number") return true;
      return (field.type === "single" || field.type === "multiple") && Array.isArray(field.options)
        && field.options.length >= 2 && field.options.length <= 8
        && field.options.every((option) => option && typeof option === "object" && typeof (option as { label?: unknown }).label === "string");
    });
  } catch {
    return false;
  }
}

export function needsStructuredClarification(message: string): boolean {
  if (message.includes("```choice_prompt") || message.includes("<choice_prompt>")) return !hasRenderableChoicePrompt(message);
  return /[？?]/.test(message) && /(?:你|您|请|需要|能否|是否|多少|什么|哪个|哪些|如何)/.test(message);
}

export function lastAssistantText(result: AgentResult): string {
  const messages = result.messages as Array<{ content?: unknown }> | undefined;
  if (!messages?.length) return "(无回复)";
  const content = messages[messages.length - 1]?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content ?? "(无回复)");
}

export async function resolveInterrupts(
  agent: TaskAgent,
  result: AgentResult,
  config: { configurable: { thread_id: string } },
  decide: (toolName: string, args: unknown) => Promise<DeleteDecision>,
): Promise<AgentResult> {
  return resolveInterruptsWith(result, decide, (command) => agent.invoke(command, config));
}

export async function resolveInterruptsWith(
  result: AgentResult,
  decide: (toolName: string, args: unknown) => Promise<DeleteDecision>,
  resume: (command: Command) => Promise<AgentResult>,
): Promise<AgentResult> {
  let current = result;
  while ((current as Record<string, unknown>).__interrupt__) {
    const interrupts = (current as Record<string, unknown>).__interrupt__ as Array<{
      value: { actionRequests: Array<{ name: string; args: unknown }> };
    }>;
    const actions = interrupts[0]?.value?.actionRequests ?? [];
    if (actions.length === 0) {
      throw new Error("收到中断但没有待确认的工具调用，已中止本轮。");
    }
    const decisions = [];
    for (const action of actions) {
      const decision = await decide(action.name, action.args);
      decisions.push(
        decision === "approve"
          ? { type: "approve" as const }
          : {
              type: "reject" as const,
              message: "用户未授权该删除操作。不要重试，除非用户再次明确授权。",
            },
      );
    }
    current = await resume(new Command({ resume: { decisions } }));
  }
  return current;
}
