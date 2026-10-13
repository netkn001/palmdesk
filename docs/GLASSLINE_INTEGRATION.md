# PalmDesk 会话阅读

Codex 首版实现于 2026-09-15，2026-09-16 扩展 Claude Code 和 Claude Desktop 本地 Code 会话。读取能力迁入 PalmDesk 仓库，Glassline 独立项目未作修改。

## 产品与代码归属

PalmDesk 承接会话阅读与远程窗口操作的整合体验。`session-core/` 是仓库内独立模块，来自 Glassline 的固定提交 `63f7d3dd67f723f6f20fe3c91b8e04a725e3bfce`，包含 Codex 与 Claude Code 解析器、会话目录缓存、数据模型、Markdown 渲染器及相关测试。保留 Apache-2.0 LICENSE 和 NOTICE；后续修复直接在 PalmDesk 维护。

不需要额外的 Glassline HTTP 服务、部署地址或第三个仓库。模块边界保留，后续确有其他消费者时再考虑发布共享包。

## 已实现的流程

1. 会话阅读在 macOS 和 Windows 上默认开启（可在电脑首页设置中关闭），范围是当前用户的 Codex、Claude Code 与 Claude Desktop 本地 Code 会话。读取目录遵循 `CODEX_HOME`、`CLAUDE_CONFIG_DIR` 和 `CLAUDE_USER_DATA_DIR`。所有来源按更新时间合并展示，列表、详情和助手署名标明来源。
2. 扫码认证后进入阅读视图，无须先授权或启动窗口捕获。没有开启读取时默认进入窗口选择。
3. 选择会话，阅读 Markdown、复制回复、向前加载历史；工具活动及长输出默认折叠。
4. 页面可见时每 8 秒检查所选会话，出现新内容后显示提示；点击查看更新才重新定位到最近消息。
5. 切换到窗口，选择原应用后可关联到正在阅读的会话。已有窗口也可手动关联。发送 prompt 前由用户确认 GUI 当前任务。
6. 切回阅读保留位置、会话和连接；窗口输入草稿也保留。阅读时暂停视频传输，阻止窗口控制，并释放按住的键和鼠标按钮。
7. 返回后台挂起的页面时自动检查连接，必要时重新认证并建立 WebRTC。阅读组件在连接切换期间保留内容和滚动位置，重新检查读取授权；关闭读取仍会清除内容。窗口恢复引用由桌面保存并绑定控制端设备，断线后有效五分钟，恢复时重新核对原生窗口身份。不会重放文字输入或图片粘贴。

关联只在当前连接内有效，是导航提示。窗口 ID 不代表 GUI 当前会话，首版没有自动切换 GUI 内任务，也没有从阅读页直接向声称的某个会话发送 prompt。

## 实现入口

| 模块 | 职责 |
| --- | --- |
| `session-core/index.mjs` | 本地会话列表与分页读取、对外数据投影、长内容限制 |
| `session-core/src/` | Codex、Claude Code 解析器和缓存，以及共享的有界文件读取；Codex 摘要读取头尾各最多 64 KiB，Claude 摘要以流读取并保留紧凑父链记录，最多 32 MiB |
| `session-core/public/timeline-renderers.js` | 浏览器端 Markdown 渲染，转义原始 HTML 并限制链接协议 |
| `electron-main/session-reader.ts` | 支持平台上默认开启的读取设置、平台检查、设置持久化、撤销正在处理的请求 |
| `src/utils/session-reader-channel.ts` | 独立可靠通道上的请求、分片、背压、超时、撤销和断开处理 |
| `src/components/SessionReader/` | 手机会话列表与阅读组件 |
| `src/components/SessionReaderSettings/` | 本机读取开关 |
| `src/views/remote/index.vue` | 认证连接到本机读取 IPC 的桥接 |
| `src/views/webrtc/index.vue` | 阅读／窗口切换与临时关联 |

远端只提交会话 ID 和历史游标，源文件路径由本机目录映射解析，不提供任意文件、raw 数据或执行接口。主进程仅接受主窗口 IPC；网络桥接在每次请求和分片发送时核对当前认证连接。关闭开关会令进行中的读取失效，并通知手机清除内容。

读取通道与原有输入通道分离。回复以最多 8,000 UTF-16 单元分片，每片 JSON 小于 64 KiB；发送队列有背压检查和时限，客户端重组上限 8 MiB。客户端可同时等待最多三项请求，主机有界串行处理。

## Claude Code 读取范围

| 本地来源 | macOS 主机 | Windows 主机 |
| --- | --- | --- |
| Codex | 支持 | 支持原生 Windows 日志 |
| Claude Code | 支持 | 支持原生 Windows 日志 |
| Claude Desktop · Code | 支持 | 支持原生本地 Code 日志 |
| Desktop Chat/Cowork、云端/SSH/WSL 抓取 | 不支持 | 不支持 |

Linux 主机不启用阅读。Windows 上 `~` 是当前用户主目录（通常为 `%USERPROFILE%`），Codex 默认使用其 `.codex`，Claude Code 使用 `.claude`；支持空格及非 ASCII 路径。WSL 主目录不自动搜索，不启动 WSL、SSH 或 Agent。环境变量必须设置在启动 PalmDesk 的环境中。

按照 [Claude Code 会话文档](https://code.claude.com/docs/en/sessions)，读取 `CLAUDE_CONFIG_DIR` 或 `~/.claude` 下的 `projects/*/*.jsonl`。自定义目录须出现在启动 PalmDesk 的环境中。只发现项目根会话文件，不递归读取嵌套子 Agent 日志，也不读取 Claude 网页聊天。

会话 ID 使用 `claude-code:session-file:<uuid>`，与 Codex 的相同 UUID 分开路由。标题优先使用 `custom-title`（用户重命名），其次为 `agent-name`、`ai-title` 和首条有效用户消息。存在有效 `last-prompt.leafUuid` 时沿当前父链读取，并接上标记之后的回复；缺失或损坏时退回有效文件顺序。Sidechain、thinking、图片和内部命令包装不展示。Bash 映射为命令，其他工具显示名称、输入和按 `tool_use_id` 匹配的结果。

为保留父链，Claude 摘要会流式扫描变化的文件，超过 32 MiB 时保留为不可读的会话项；打开后明确提示前往原窗口。摘要按文件指纹缓存。损坏行不会使其余记录消失，尚未写完的尾行可在后续刷新恢复。两个适配器均关闭进程扫描，不调用 Agent CLI。

## Claude Desktop Code 读取范围

按照 [Claude Desktop 文档](https://code.claude.com/docs/en/desktop)，Desktop 包含 Chat、Cowork 和 Code 三个入口；此适配仅覆盖本地 Code 日志。存储格式依据 macOS Claude `1.52386.6` 安装包及本地索引、Windows Claude MSIX `1.24012.9.0` 安装包核对，不属于 Anthropic 承诺的稳定 API。Windows 具体证据和未验证项见 [验证记录](smoke-artifacts/windows-session-reading-2026-09-24.md)。

- macOS 默认发现 `~/Library/Application Support/Claude` 与 `Claude-3p`。Windows 检查 `%APPDATA%\Claude`、`%LOCALAPPDATA%\Claude-3p`、旧版 `%APPDATA%\Claude-3p`，以及 `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache` 下的 `Roaming\Claude`、`Local\Claude-3p`、`Roaming\Claude-3p`。覆盖普通及第三方模型配置；若设置 `CLAUDE_USER_DATA_DIR`，则只使用该目录。
- 读取 `claude-code-sessions/<account>/<org>/local_<uuid>.json`，按 `cliSessionId` 关联全局 Claude 项目日志，或索引同级 `<local_uuid 或 UUID 前八位>/.claude/projects/*/<cliSessionId>.jsonl`。
- 保留 `claude-code:session-file:<cliSessionId>` 标识及既有解析器。全局和 Desktop 副本按日志更新时间选取最新一份，列表和详情读取同一份文件；来源显示为 `Claude Desktop · Code`。Desktop 的非空标题优先于日志标题，索引重命名会在下次读取时生效。
- 索引每文件最多读取 10 MiB，变化后才重新解析；只保留关联 ID、标题、项目路径和时间。索引中的任意文件路径、账号字段及应用配置不会投影到手机。专属目录内只接受关联 UUID 的根日志，跳过符号链接、Windows junction 与嵌套子 Agent。Codex 的 `sessions` 和 Claude Code 的 `projects` 扫描根目录同样拒绝符号链接/junction，刷新时不会继续使用已被链接替换的目录缓存。
- 缺失、损坏或过大的索引不会阻断 CLI 读取。只有索引、没有日志的会话不展示；不会连接 Claude 账号、调用 CLI 或抓取云端/SSH 日志。Chat、Cowork 及远程会话专用适配不在本版范围内。

真实只读验证使用本机 `Claude-3p` 的 9 条 Code 索引，其中 6 条仍有全局日志，均正确识别为 Desktop，标题匹配且无重复。共读取 10 页、118 条文字消息与 136 项工具活动，其中 4 个会话验证了历史分页。没有修改这些会话；仓库中的测试记录全部为合成数据。会话专属目录、短目录名、追加与重命名由合成测试覆盖；尚未通过真实手机或在 Claude Desktop 中新建会话验证写入全过程。

合成 WebRTC 页面在 390 × 844 浏览器尺寸下验证了三种来源的混合列表、Desktop 标题及助手署名、历史加载和新回复提示。提示出现前后阅读位置保持不变（`scrollTop = 3318`），点击后显示最新回复；切回 CLI 会话后署名恢复为 `Claude Code`，无横向溢出。

## 本版限制

- 提供 macOS 和 Windows 上的 Codex、Claude Code 与 Claude Desktop 本地 Code 读取；其他 Agent 继续使用原窗口功能。Windows 三种来源的真实主机 + 手机完整流程仍未验收。
- 搜索覆盖已发现的全部会话，每次显示最近 100 条匹配项。
- 历史每页 40 项，单项正文或输出各保留前 16,384 字符，截断有明确提示。
- 日志并非稳定 API，可能缺失记录；本轮状态可以是未知。首次建立目录需扫描文件，详情仍会解析相应日志文件，超过 32 MiB 时拒绝读取并提示前往原窗口，读取过程中也检查大小上限。
- 附件预览、自动识别 GUI 当前任务和选择另一窗口时保留连接尚未实现。同一页面重连保留阅读位置与文字草稿；页面刷新或被系统回收后不会保留这些内存状态。
- 阅读时暂停视频传输并阻止窗口输入；重连后保持阅读模式，切回窗口才恢复捕获。
- 未接入 Glassline 的 CLI follow-up：本版 prompt 继续通过原 GUI 输入。

## 验证

```sh
pnpm test:session-core
pnpm test:smoke
pnpm typecheck
pnpm build:prod
pnpm build:native
pnpm build:desktop:win # 在 Windows 主机运行
```

测试覆盖合成 JSONL 的分页、追加与未完整写入的尾行、跨轮次重复 prompt、超长输出、32 MiB 文件上限（含读取中增长）、Markdown 截断标记与搜索，以及支持平台上默认开启、关闭持久化、撤销、分片完整性、背压、请求排队和断开。Claude 扩展另外覆盖混合来源排序、同 UUID 路由、重命名、父链、子 Agent 排除、工具结果配对、缓存失效、损坏日志恢复和主进程读取开关。

Desktop 扩展覆盖全局/专属/短目录布局、共享日志去重及详情一致性、普通/第三方配置目录、只改索引的重命名、分页与追加、索引及日志大小上限、缺失日志、损坏索引恢复、ID 不匹配与路径隔离，以及同一个主进程读取开关的授权和撤销。

Windows 回归另外覆盖默认目录及 MSIX 目录、三个环境变量覆盖、空格/中文路径、CRLF 与未写完尾行、重复配置目录、每层 junction 替换，以及 macOS/Windows 的持久化、损坏设置、写入失败和撤销后再启用时的旧请求拒绝。现有分片与撤销测试继续验证清空连接的阅读端。

浏览器联调页仅使用临时目录内的合成记录，通过两个真实 WebRTC peer 连接阅读组件与读取模块，同时提供合成窗口视频。它不会读取本机真实会话或发送真实 GUI 输入：

```sh
pnpm exec vite --config test/smoke/session-reader.vite.mjs
```

打开 `http://127.0.0.1:5194/test/smoke/session-reader.html`。列表同时包含 Codex、Claude Code 和 Claude Desktop Code；可为当前选中的会话添加合成回复、切换读取开关、重连，并检查阅读位置、输出折叠和窗口输入。此页面用于验证新增功能，不替代真实手机、原生窗口输入或跨网络 TURN 验收。
