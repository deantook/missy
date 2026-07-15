# Agent 提示词可靠性优化 — 设计文档

**日期：** 2026-07-15  
**状态：** 已批准（待实现）  
**范围：** 可靠性优先（方案 A）；不含提示词大重构与 choice_prompt 示例域替换

## 目标

在不大改提示词结构的前提下，用 **工具硬过滤** 与 **父子任务 runtime 启发式闸门** 堵住当前系统提示词中仅靠模型服从的高风险缺口，并做与闸门对齐的轻度措辞精简（C2）。

成功标准：

1. 标签/习惯相关 MCP 工具不再进入 `createDeepAgent`；模型无法调用。
2. 符合 B1 启发式的「拆解却漏 `parentId`」回合会被最多 2 次一致性重试拦截；仍失败则抛错，不向用户返回伪成功。
3. 平铺多任务、单任务创建等合法场景不被误伤。
4. 规则 9/11/14 措辞与上述行为一致；规则 10/12/13 保持不变。

## 决策摘要

| 项 | 选择 |
|----|------|
| 优化重心 | A：可靠性（父子校验 + 工具裁剪） |
| 标签/习惯 | A1：硬过滤，模型不可见 |
| 父子校验 | B1：启发式触发，镜像清单回查闸门 |
| 提示词 | C2：必要精简 + 与 runtime 对齐，不拆附录 |
| 实现骨架 | 方案 1：`conversation.ts` 检测 + `agent-runtime` 重试 + `tool-policy.ts` 过滤 |

## 非目标

- 按用户声明动态加回标签/习惯工具
- B2 强校验（≥3 个无 `parentId` 任务一律拦截）
- choice_prompt 示例改为任务域 / 提示词大拆「工作流附录」
- 改变删除 `interruptOn`、清单 `projectCreationNeedsVerification` 的现有行为

## 架构

```text
MCP getTools()
    ↓
filterAgentTools()          ← 新增：去掉 habit / tag
    ↓
createTaskAgent(tools)
    ↓
runAgentTurn stream
    ↓
delete interrupt → 清单回查 → 父子结构校验（新）→ choice_prompt 重写
```

### 模块职责

| 模块 | 职责 |
|------|------|
| `src/tool-policy.ts` | `filterAgentTools` / `isBlockedToolName`；纯函数 |
| `src/mcp.ts` 或调用方 | 在 tools 交给 agent 前应用过滤（见接入点） |
| `src/conversation.ts` | `parentTaskCreationNeedsVerification`、`latestCreatedParentTaskId`、从 tool_calls 解析 `parentId` |
| `src/agent-runtime.ts` | 在清单校验之后接入父子重试环 |
| `src/prompts.ts` | 规则 9/11/14 的 C2 措辞 |
| `src/index.ts` / `UserMcpCache.toolsFor` | 保证 CLI 与 HTTP 路径都过滤 |

## 1. 工具硬过滤（A1）

### 匹配规则

对工具 `name` 做大小写不敏感匹配：

- **习惯：** 名称包含 `habit`
- **标签：** 名称包含 `tag`

当前滴答 MCP 工具名无已知的「含 tag 但非标签功能」歧义；若日后出现误伤，改为显式黑名单表，不在本次扩大匹配语义。

### API

```ts
export function isBlockedToolName(name: string): boolean;
export function filterAgentTools<T extends { name?: string }>(tools: readonly T[]): T[];
export function blockedToolNames(tools: readonly { name?: string }[]): string[];
```

### 接入点

- HTTP：`UserMcpCache.toolsFor`（及同类缓存路径）在返回 tools 前过滤
- CLI：`src/index.ts` 在 `createTaskAgent({ tools })` 前过滤
- 过滤后若启动日志打印工具数，应反映过滤后数量；可选附带 `已过滤: ...`

### 提示词配合

规则 9、14 改为「当前会话未开放标签/习惯工具，不要尝试调用」，避免模型仍规划这些工具。

## 2. 父子任务启发式校验（B1）

### 触发条件（须同时满足）

1. **多任务写入：** 本轮成功的任务创建类调用表明存在「多于一个顶层写入意图」——具体判定：
   - 成功的 `create_task` 次数 ≥ 2；或
   - 至少 1 次成功的 `create_task`，且另有至少 1 次成功的 `batch_add_tasks`
2. **存在疑似父任务：** 至少一次成功的 `create_task`，其参数中 **没有** `parentId`（或 `parentId` 为空）
3. **后续写入缺父子绑定：** 在第一次无 `parentId` 的成功 `create_task` 之后，至少还有一次成功的任务写入（`create_task` 或 `batch_add_tasks`），且该次调用参数中缺少有效 `parentId`（对 `batch_add_tasks`：任一 item 缺少有效 `parentId` 即算缺）

### 明确不触发

- 仅一次 `create_task`（无论是否带 `parentId`）
- 仅一次 `batch_add_tasks` 且没有任何先行无 `parentId` 的 `create_task`（用户要的是平铺批量）
- 所有「父之后」的写入都已带非空 `parentId`
- 无任务创建，仅查询/更新/完成

### 通过条件

`parentTaskCreationNeedsVerification(result)` 为 false，当且仅当未触发，或：

- 存在至少一次成功的子任务写入，其 `parentId`（或 batch item 的 `parentId`）等于本轮解析到的父任务真实 ID（来自某次无 `parentId` 的成功 `create_task` 的工具返回）

实现上优先复用「工具名成功列表 + args 解析」；父 ID 提取镜像 `latestCreatedProjectId`，新增 `latestCreatedParentTaskId`。

### 参数解析

从 AI message 的 `tool_calls` 读取：

- `name`
- `args` / `arguments`（对象或 JSON 字符串）中的 `parentId`
- `batch_add_tasks`：解析 `tasks` / `items` / 顶层数组（以实现时 MCP schema 为准，测试覆盖常见形状）

工具结果侧：从成功的无 `parentId` 的 `create_task` 返回内容中解析任务 `id`（与 project id 查找类似的宽松 JSON/文本匹配）。

### Runtime 行为

插入位置：清单回查通过之后、`choice_prompt` 重写之前。

```text
for attempt in 0..2 while parentTaskCreationNeedsVerification(result):
  debug note: "父子任务结构校验重试"
  stream(系统一致性检查 user 消息，含 latestCreatedParentTaskId 提示)
if still needs verification:
  throw Error("父子任务结构验证未完成；系统已阻止返回错误的成功结果，请重试。")
```

重试消息要点：

- 不要向用户提问
- 不要重复创建父任务（若已有父 ID）
- 为应作为子步骤的任务补建/更新，填入正确 `parentId`（驼峰）与递增 `sortOrder`
- 只有结构正确后才能报告成功

## 3. 提示词 C2

修改 `src/prompts.ts` 中：

| 规则 | 变更 |
|------|------|
| 9 | 「除非用户声明…标签」→「当前会话未开放标签工具，不要尝试调用」 |
| 11 | 保留触发条件、禁止 checklist 冒充、串行创建与 `parentId`/`sortOrder`/`projectId`；删除冗长「创建后必须回查确认…才能报告成功」；改为短句说明运行时会校验、缺 `parentId` 会被要求补建、勿提前报成功 |
| 14 | 「不使用习惯功能」→「当前会话未开放习惯工具，不要尝试调用」 |

不变：规则 1–8、10、12、13 与日期注入逻辑。

## 4. 测试计划

| 文件 | 覆盖 |
|------|------|
| `tests/tool-policy.test.ts` | `habit`/`tag` 被滤；`create_task`/`list_projects` 等保留；大小写 |
| `tests/agent-interrupt.test.ts` 或 `tests/parent-task-verify.test.ts` | 触发 / 不触发 / 已带 parentId 通过；`latestCreatedParentTaskId` 解析 |
| `tests/prompts.test.ts` | 含「未开放标签」「未开放习惯」；规则 11 含运行时校验短句；不再要求旧的冗长回查全文 |

不强制增加端到端 LLM 测试；闸门单测与清单校验测试同级即可。

## 5. 错误与可观测性

- 父子校验失败：抛错文案明确「父子任务结构验证未完成」
- Debug：`note` 消息 `父子任务结构校验重试`；可选 `phase: verify` 复用或与清单共用 verify 阶段（实现时二选一，优先复用现有 `verify` phase 以免前端枚举爆炸）
- 工具过滤：不向终端用户暴露黑名单细节也可；开发日志打印过滤名即可

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 误伤合法平铺多任务 | 触发条件要求「先有无 parentId 的 create_task，且后续写入仍缺 parentId」；单批 batch 不单独触发 |
| `batch_add_tasks` args 形状不一致 | 测试覆盖多种字段名；解析失败时保守视为「缺 parentId」仅当已满足其它触发条件 |
| 过滤后用户问习惯/标签 | 模型应说明未开放；若需支持，后续加白名单配置（非本次） |
| 与清单校验叠加拉长回合 | 两闸最多各 2 次；先清单后父子，避免交叉重试 |

## 批准记录

- 重心：A  
- 过滤：A1  
- 父子：B1  
- 提示词：C2  
- 实现骨架：方案 1  
- 分段设计：工具过滤、启发式校验、Runtime+C2 均已确认
