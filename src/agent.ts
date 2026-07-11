import { createDeepAgent } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { SYSTEM_PROMPT } from "./prompts.ts";

export type NamedTool = { name?: string };

export function buildDeleteInterruptOn(
  tools: readonly NamedTool[],
): Record<string, { allowedDecisions: Array<"approve" | "reject"> }> {
  const interruptOn: Record<
    string,
    { allowedDecisions: Array<"approve" | "reject"> }
  > = {};

  for (const tool of tools) {
    const name = tool.name;
    if (typeof name === "string" && name.startsWith("delete_")) {
      interruptOn[name] = { allowedDecisions: ["approve", "reject"] };
    }
  }

  return interruptOn;
}

export function createTaskAgent(params: {
  model: string;
  tools: readonly NamedTool[];
}) {
  const interruptOn = buildDeleteInterruptOn(params.tools);
  const checkpointer = new MemorySaver();

  const agent = createDeepAgent({
    model: params.model,
    tools: params.tools as never[],
    systemPrompt: SYSTEM_PROMPT,
    interruptOn,
    checkpointer,
  });

  return { agent, checkpointer, interruptOn };
}
