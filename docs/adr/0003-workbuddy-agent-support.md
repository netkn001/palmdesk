# ADR 0003: WorkBuddy AI Agent 全面支持 (WorkBuddy Agent Integration)

* **状态 (Status)**: 已接受 (Accepted)
* **日期 (Date)**: 2026-10-12
* **领域 (Domain)**: Agent 识别与启动 (GUI Detection & Launch) / 本地会话解析 (Session Reading) / 移动端呈现 (Mobile UX)
* **关联 (Related)**: [ADR 0001: 会话阅读模式现代化改造](0001-session-reader-modernization.md), [ADR 0002: 会话列表信息架构与多维组织](0002-session-list-information-architecture.md), [AGENT_DETECTION.md](../AGENT_DETECTION.md)

---

## 1. 背景与上下文 (Context)

WorkBuddy（腾讯出品的桌面 AI Agent 工作台）是面向知识工作者与开发者的 Agent 产品。与传统对话式 ChatBot 不同，WorkBuddy 具备自主执行多步骤长程任务、本地工具调用（如终端 Bash、文件读写、网络搜索 Fetch/Search、用户交互问询等）并交付完整工作成果的能力。

PalmDesk 的核心定位是 **AI-native remote control**（面向 **agent-ready workflows**）。为了进一步丰富 PalmDesk 的 Agent 生态，让用户在移动端便捷地连接与管控 WorkBuddy，需要全面打通以下两层支持：
1. **GUI 层面（Agent 目录与一键启动）**：自动发现宿主机上运行中或已安装的 WorkBuddy 实例，聚合到移动端「Agent 目录」，支持单窗口/多窗口切入控制以及未运行状态下的一键拉起。
2. **会话层面（只读会话日志阅读）**：在不开启窗口推流或远程屏幕的情况下，纯只读解析 WorkBuddy 本地历史会话日志，提供结构化 Markdown、代码高亮、思考过程折叠以及工具调用的时间线展示，并保持与桌面端执行的实时同步。

---

## 2. 决策记录 (Decisions)

### 2.1 品牌与命名规范
* **Agent 标识 (ID)**：统一为 `workbuddy`。
* **界面显示名 (Display Name)**：遵循 PalmDesk 极简品牌命名惯例（如 Codex、Claude、Kimi），统一展示为 `WorkBuddy`。
* **会话前缀 (Session ID)**：采用 `workbuddy:session-file:<uuid>` 标准 UUID 格式。
* **阅读器分类图标 (Category Icon)**：采用 `💼`（办公公文包），象征其桌面办公与 Agent 工作伙伴定位。

### 2.2 维度一：GUI 桌面窗口识别与多源安装探测
* **核心特征库注册 (`src/utils/agent-registry.ts`)**：
  * Windows 原生可执行文件名：`workbuddyai.exe`、`workbuddy.exe`；
  * macOS Bundle ID：`com.tencent.workbuddy`、`com.tencent.workbuddy.mac`、`com.tencent.workbuddy.app`、`ai.workbuddy.desktop`。
* **Windows 安装探测增强 (`electron-main/agent-launcher.ts`)**：
  * WorkBuddy 在 Windows 下默认安装在用户专属目录 `%LOCALAPPDATA%\Programs\WorkBuddyAI`，且并未主动向系统全局注册表 `App Paths` 写入键值。
  * 因此，Windows 探测脚本在原有 `App Paths` 与 `AppX` 扫描基础上，新增多源探测：
    1. 扫描当前用户默认安装路径：`%LOCALAPPDATA%\Programs\WorkBuddyAI\WorkBuddyAI.exe`；
    2. 扫描 `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall` 注册表，检索带有 `WorkBuddy` 名称项的 `DisplayIcon` 与 `InstallLocation`。
  * 确保用户在 Windows 下无需手动添加注册表即可开箱即用探测并一键拉起。

### 2.3 维度二：本地会话日志结构化解析 (`session-core`)
* **数据目录与环境变量**：
  * 缺省主目录：Windows 为 `%USERPROFILE%\.workbuddy-ai`，macOS/Linux 为 `~/.workbuddy-ai`；
  * 环境变量覆盖：支持通过 `WORKBUDDY_HOME` 或 `WORKBUDDY_DATA_DIR` 自定义路径；
  * 会话日志路径规则：读取 `${WORKBUDDY_HOME}/projects/*/*.jsonl` 文件。
* **智能用户提问提取 (Prompt Extraction)**：
  * WorkBuddy 会在每轮对话向大模型注入包含环境信息、用户习惯、SOUL.md 等在内的长篇 `<system-reminder>` 预设；
  * 解析时通过正则表达式抽离 `<user_query>(.*?)</user_query>` 中的真实提问，作为会话阅读的时间线正文及最近消息摘要，避免冗长注入提示词污染阅读界面。若未匹配到标签则优雅回退至原始内容。
* **会话标题降级策略**：
  * 优先级 1：提取 `type === 'ai-title'` 记录中的 `aiTitle`（如“查询今日天气”）；
  * 优先级 2：首轮抽取的干净 `<user_query>`（截取前 96 字符）；
  * 优先级 3：会话所在项目目录名或会话 ID。
* **时间线卡片映射模型 (Timeline Mapping)**：
  * `type === 'message' && role === 'assistant'`：映射为 `message`（Markdown 输出）；
  * `type === 'reasoning'`：映射为 `thinking`（折叠思考过程，随 `includeThinking` 选项开闭）；
  * `type === 'function_call'` 且 `name === 'Bash'`：映射为 `command`（控制台终端样式，含命令与标准输出）；
  * 其他工具（`AskUserQuestion`、`WebSearch`、`WebFetch`、`SkillManage`、`Edit`、`Write`、`Read` 等）：映射为 `tool_call`；
  * 工具结果（`type === 'function_call_result'`）通过 `callId` 与调用精准关联对齐。
* **活跃会话感知与文件监听**：
  * 结合读取 `~/.workbuddy-ai/sessions/*.json`（记录运行中实例的 PID、端口与最后心跳）及宿主进程表，对正在运行的活跃会话标记 `status: 'running'`；
  * 依托 `session-core` 的 `watchFile` 机制，在用户浏览活跃会话时，实现亚秒级的增量流式更新推送。

---

## 3. 影响与收益 (Consequences)

### 正向影响 (Positive)
* **拓展 AI Agent 覆盖版图**：PalmDesk 正式支持中国主流桌面 Agent 产品 WorkBuddy，为广大国内用户提供移动端连接与监控方案。
* **延续一致的零侵入安全设计**：无缝融入现有系统，无需注入进程或拦截网络，完全基于系统公开窗口元数据与只读持久化日志。
* **体验闭环**：在移动端既能查看 WorkBuddy 运行中的每一步思考与工具调用，又能在需要介入时（如交互确认、GUI 编辑）一键直通远程控制窗口。

### 限制与边界 (Limitations)
* 若用户在 WorkBuddy 设置中彻底关闭了本地历史记录持久化，将无法在会话阅读中检索历史记录，但 GUI 窗口识别与启动控制不受影响。
