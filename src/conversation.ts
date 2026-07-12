import { Command } from "@langchain/langgraph";
import type { createTaskAgent } from "./agent.ts";

export type TaskAgent = ReturnType<typeof createTaskAgent>["agent"];
export type AgentResult = Awaited<ReturnType<TaskAgent["invoke"]>>;
export type DeleteDecision = "approve" | "reject";

type ToolCall = { id?: string; name?: string };
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
