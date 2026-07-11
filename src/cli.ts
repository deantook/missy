import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";

type AgentLike = {
  invoke: (
    input: unknown,
    config?: { configurable: { thread_id: string } },
  ) => Promise<Record<string, unknown>>;
};

function lastAssistantText(result: Record<string, unknown>): string {
  const messages = result.messages as Array<{ content?: unknown }> | undefined;
  if (!messages?.length) return "(无回复)";
  const last = messages[messages.length - 1];
  const content = last?.content;
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

async function promptConfirm(
  rl: readline.Interface,
  toolName: string,
  args: unknown,
): Promise<"approve" | "reject"> {
  output.write("\n⚠️  需要确认删除操作\n");
  output.write(`工具: ${toolName}\n`);
  output.write(`参数: ${JSON.stringify(args, null, 2)}\n`);
  const answer = (await rl.question("确认执行？[y/N] ")).trim().toLowerCase();
  if (answer === "y" || answer === "yes") return "approve";
  return "reject";
}

async function resolveInterrupts(
  rl: readline.Interface,
  agent: AgentLike,
  result: Record<string, unknown>,
  config: { configurable: { thread_id: string } },
): Promise<Record<string, unknown>> {
  let current = result;

  while (current.__interrupt__) {
    const interrupts = current.__interrupt__ as Array<{
      value: {
        actionRequests: Array<{ name: string; args: unknown }>;
      };
    }>;
    const actionRequests = interrupts[0]?.value?.actionRequests ?? [];
    const decisions = [];

    for (const action of actionRequests) {
      const decision = await promptConfirm(rl, action.name, action.args);
      if (decision === "approve") {
        decisions.push({ type: "approve" as const });
      } else {
        decisions.push({
          type: "reject" as const,
          message:
            "用户拒绝了该删除操作。不要重试同一删除，除非用户再次明确要求。",
        });
      }
    }

    current = await agent.invoke(new Command({ resume: { decisions } }), config);
  }

  return current;
}

export async function runRepl(agent: AgentLike): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const threadId = randomUUID();
  const config = { configurable: { thread_id: threadId } };

  output.write("滴答清单助手已启动。输入问题开始对话；输入 exit / quit 退出。\n");

  try {
    while (true) {
      const line = (await rl.question("\n你: ")).trim();
      if (!line) continue;
      if (line === "exit" || line === "quit") break;

      try {
        let result = await agent.invoke(
          { messages: [{ role: "user", content: line }] },
          config,
        );
        result = await resolveInterrupts(rl, agent, result, config);
        output.write(`\n助手: ${lastAssistantText(result)}\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output.write(`\n错误: ${message}\n`);
      }
    }
  } finally {
    rl.close();
  }
}
