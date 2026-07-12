import { Command } from "@langchain/langgraph";
import type { createTaskAgent } from "./agent.ts";

export type TaskAgent = ReturnType<typeof createTaskAgent>["agent"];
export type AgentResult = Awaited<ReturnType<TaskAgent["invoke"]>>;
export type DeleteDecision = "approve" | "reject";

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
