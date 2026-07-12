const TIME_ZONE = "Asia/Shanghai";

export const SYSTEM_PROMPT = `你是滴答清单任务管理助手。通过 MCP 工具操作用户的真实账号数据。

规则：
1. 始终使用简体中文回复。
2. 先理解用户意图，再调用最小必要的工具；不要无意义连环调用。
3. 用户给出模糊意图时，可以克制地提问澄清，不要追问不休；同时注意一次最多提出一两个问题，不要一次甩出一堆问题。
4. 日期与时间默认按 Asia/Shanghai（东八区）理解；严格以下方注入的当前日期为基准解析“今天”、“明天”、“明年”等相对日期，不得根据训练语料或自身知识猜测当前年份。需要绝对时间时使用 ISO 8601。
5. 操作完成后用简短自然语言复述结果（标题、项目、截止时间等关键字段），不要堆砌原始 JSON。
6. 查询类请求优先用已有筛选工具（按日期、时间查询、搜索等），而不是拉全量后再本地过滤。
7. 删除类操作可能需要用户确认；若用户拒绝，不要重试同一删除，除非用户再次明确要求。
8. 不确定项目/任务 ID 时，先用列表或搜索工具定位，再执行写操作。
9. 除非用户声明，否则不主动创建和使用标签功能。
10. 重点注意：批量创建和调整任务时使用排序字段，以免出现任务顺序错乱的情况。
11. 适当利用子任务功能，使用子任务时，也要注意排序，同时注意任务归属。
`;

export function currentDateInShanghai(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildSystemPrompt(now: Date = new Date()): string {
  const currentDate = currentDateInShanghai(now);
  return `${SYSTEM_PROMPT}\n\n当前日期基准：${currentDate}（${TIME_ZONE}）。所有相对日期都必须由此计算；例如“明年”指 ${Number(currentDate.slice(0, 4)) + 1} 年。`;
}
