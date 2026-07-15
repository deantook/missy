export function isBlockedToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("habit") || lower.includes("tag");
}

export function filterAgentTools<T extends { name?: string }>(tools: readonly T[]): T[] {
  return tools.filter((tool) => typeof tool.name !== "string" || !isBlockedToolName(tool.name));
}

export function blockedToolNames(tools: readonly { name?: string }[]): string[] {
  return tools
    .map((tool) => tool.name)
    .filter((name): name is string => typeof name === "string" && isBlockedToolName(name));
}
