import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomUUID } from "node:crypto";
import { lastAssistantText, resolveInterrupts, type TaskAgent } from "./conversation.ts";

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

export async function runRepl(agent: TaskAgent): Promise<void> {
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
        result = await resolveInterrupts(
          agent,
          result,
          config,
          (name, args) => promptConfirm(rl, name, args),
        );
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
