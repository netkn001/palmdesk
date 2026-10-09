# PalmDesk

[English](README.md) | 简体中文

面向 AI agent 工作流优化的 AI-native 远程控制：在手机浏览器中阅读本地 AI 会话，并操作 macOS 或 Windows 上的单个应用窗口。

PalmDesk 由 [Abreto](https://github.com/Abreto) 维护，基于 [BilldDesk](https://github.com/galaxy-s10/billd-desk) 开源版开发。产品以 agent-ready workflows 为目标，围绕用户使用 AI agent 的流程做专门优化：发现 Agent 应用、阅读支持的本地会话，再回到原应用窗口继续操作。从手机浏览器即可与 macOS 或 Windows 上的 Codex、ChatGPT、Claude、Kimi、ZCode 或终端交互；电脑浏览器也可作为控制端。

**状态：实验性预览版，尚未发布稳定版。** 打包后的桌面客户端默认连接官方后端 [https://palmdesk.abreto.icu](https://palmdesk.abreto.icu)。连接设备后，电脑已开启会话阅读时默认进入阅读页，否则进入 Agent 目录；选择窗口后才开始捕获。“打开即恢复到上次窗口”属于后续计划。历史依赖审计结果和发布前待办见 [开源准备记录](docs/OPEN_SOURCE_READINESS.md)。

## 会话阅读（预览）

PalmDesk 现已内置从 Glassline 迁入的会话读取模块，无须单独部署 Glassline。支持 **macOS 和 Windows 上当前用户的 Codex、Claude Code 和 Claude Desktop 本地 Code 会话**，按更新时间混合展示并标明来源。

| 本地来源 | macOS 主机 | Windows 主机 |
| --- | --- | --- |
| Codex | 支持 | 支持原生 Windows 日志 |
| Claude Code | 支持 | 支持原生 Windows 日志 |
| Claude Desktop · Code | 支持 | 支持原生本地 Code 日志 |
| Desktop Chat/Cowork、云端/SSH/WSL 抓取 | 不支持 | 不支持 |

Codex 读取 `CODEX_HOME` 或 `~/.codex`。Claude Code 读取 `CLAUDE_CONFIG_DIR` 或 `~/.claude` 下的 `projects/*/*.jsonl`，支持会话重命名、文字回复和工具结果。Windows 上的 `~` 是当前用户的主目录（通常为 `%USERPROFILE%`）。Claude Desktop 在 macOS 上读取 `~/Library/Application Support/Claude` 和 `Claude-3p`；在 Windows 上检查 `%APPDATA%\Claude`、`%LOCALAPPDATA%\Claude-3p`、旧版 `%APPDATA%\Claude-3p`，以及 `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache` 下对应的应用包目录。`CLAUDE_USER_DATA_DIR` 可指定唯一的自定义 Desktop 目录。兼容全局及会话专属日志，保留 Desktop 标题，并对共享日志去重。

自定义目录需设置在启动 PalmDesk 的环境中，支持空格和非 ASCII 路径。读取仅限本地且只读，不自动搜索 WSL 主目录，跳过 Desktop SSH/WSL 索引和嵌套子 Agent 日志，不抓取云端记录；本地日志仍需存在且可读。Linux 主机不支持会话阅读。Windows 存储核对和自动化检查见 [验证记录](docs/smoke-artifacts/windows-session-reading-2026-09-24.md)；三种来源的真实 Windows 主机 + 手机完整流程仍未验收。

1. 在电脑 PalmDesk 首页开启「会话阅读」，允许已连接设备读取当前用户的 Codex、Claude Code 和 Claude Desktop 本地 Code 回复及工具输出。设置默认关闭，保存在当前安装的应用数据目录。
2. 用手机扫码或设备代码连接，默认进入「阅读」页，按项目、标题或最近消息搜索并打开会话。单独阅读不要求启动窗口捕获，也不需要屏幕录制和辅助功能权限。
3. 阅读页支持 Markdown、复制和历史分页；命令、工具输出与差异默认折叠。页面可见时每 8 秒检查所选会话，发现变化后显示提示，点击后转到最新内容。
4. 点击「去窗口继续」切到窗口视图，尚未选窗时选择原应用窗口。可以关联当前窗口，但发送 prompt 前仍需确认 GUI 中打开的是目标任务。阅读／窗口切换保留连接、阅读位置和未发送的输入草稿；阅读时会释放按键、阻止窗口输入并暂停视频传输。

切换到手机其他应用或锁屏时会暂停视频；若浏览器来不及通知就被系统挂起，电脑端在十秒未收到控制端状态后暂停视频。返回同一浏览器页面会恢复视频或自动重连，并保留阅读位置和文字草稿。断线后五分钟内，电脑可为同一已认证控制端恢复所选窗口，但会重新检查原生窗口身份；原窗口已关闭或恢复信息过期时返回选窗。阅读模式重连后，只有切回「窗口」才重新捕获。两端都需支持此功能。浏览器后台长连接无法保证，页面刷新或被系统回收后也不会保留这些内存状态；iOS Safari 仍需实机验收。

窗口关联仅在当前连接内有效。「返回 Agent 入口」会重新连接，以便选择另一窗口，同时清除阅读选择和窗口关联；它与「阅读／窗口」视图切换的行为不同。

列表显示最近 100 条匹配结果，搜索会覆盖全部已发现的会话。历史每次读取 40 项；单项正文或输出超过 16,384 字符时显示截断提示，完整内容请在原窗口查看。日志文件超过 32 MiB 时请在原窗口查看。本地日志可能不完整，无法确认的任务状态显示为未知。首版不包含附件预览和自动定位 GUI 内的任务。

读取使用独立 WebRTC DataChannel，不占用窗口输入消息队列。关闭电脑上的读取开关会撤回后续读取并清除已连接阅读页中的内容。详细实现和测试见 [会话阅读集成说明](docs/GLASSLINE_INTEGRATION.md)。

## 当前能力

- Electron 单窗口视频捕获，WebRTC 视频与输入 DataChannel。
- 手机连接页、设备历史、横竖屏界面、画质和帧率选择。
- 电脑展示连接二维码，手机网页支持相机扫码和图片识码；连接链接打开后自动认证，已开启会话阅读时进入阅读页，否则进入 Agent 目录。
- 手机端窗口列表、应用名和标题搜索、缩略图、手动刷新；选择后才开始视频捕获。
- 「窗口」页的 Agent 目录自动识别已打开的 Codex、Claude、ChatGPT、Kimi 和 ZCode；单窗口直接进入，多窗口展开选择。应用进程已打开但没有可用窗口时仍保留入口。
- 点击「打开 Agent」可在已连接电脑上启动已安装、受支持的应用；打开后单窗口直接进入，多窗口由用户选择。应用已运行但暂无窗口时，可以明确重试打开窗口。
- Agent 支持按设备置顶和最近使用排序；“其他应用”保留通用窗口控制，可手动把终端等窗口关联到 Agent。手动关联在本次连接内刷新后保留，重新连接后需重新关联。
- Agent 目录使用 macOS bundle ID 或 Windows 可执行文件身份识别应用；“已打开”仅表示检测到应用，不代表任务正在执行。「阅读」页另行展示支持的本地会话、项目路径及从日志推断的状态，尚不能自动识别或切换 GUI 当前任务。
- 窗口列表覆盖 macOS 所有桌面（Spaces）；选中其他桌面或最小化的窗口后，先激活该窗口并等待它可捕获。
- 控制页可返回 Agent 入口，复用设备凭据重新连接并获取目录；同一个 Agent 下的窗口保持原有顺序。
- 点击、双击、长按右键、拖拽、滚动、双指捏合缩放、平移与只读模式。
- 本地中文输入框、发送文字、回车、常用按键和硬件键盘。
- macOS 和 Windows Codex 窗口支持从手机选择或粘贴单张 PNG/JPEG 图片，预览后粘贴为 prompt 附件。
- macOS 按应用 bundle ID、PID 和原生窗口 ID 识别目标；输入前刷新边界并验证聚焦。
- Windows 按 HWND、PID、可执行文件路径和进程启动时间识别目标；支持当前虚拟桌面的普通窗口、指定窗口最小化还原，以及高 DPI 和多显示器物理坐标。
- Windows 发送文字使用原生 Unicode 输入，保留中英文原文，避免中文输入法把英文转成候选词。
- 窗口消失、捕获结束、连接断开时停止输入并释放按键。
- 可配置 API 和信令；浏览器默认使用当前域名。未手动配置 TURN 时，由后端下发并续期临时中继凭据。

Linux 暂无原生主机适配器，会拒绝捕获和输入。浏览器控制端不受此主机限制。视频采用窗口源，但输入仍依赖系统焦点和鼠标键盘接口，不等于操作系统级的输入隔离。

### 从手机给 Codex 粘贴图片（macOS 和 Windows）

连接 macOS 或 Windows 主机并选择 Codex 窗口后，在底部使用「选择图片」「粘贴图片」，或在文字框中长按粘贴图片。第一版支持单张 PNG/JPEG，最大 10 MiB、约 2500 万像素，单边不超过 16384 像素；不支持 HEIC、GIF 或其他文件。传输保留原始图片字节，主机解码后写入图片剪贴板，不缩放、不做有损重压缩。Windows 根据可执行文件和进程身份识别 Codex，不依赖窗口标题；其他应用不展示这些图片控件。

先在远程画面中点一下 Codex 的 prompt 输入框，再点击「粘贴到 Codex」。电脑校验当前控制会话和窗口身份，将图片写入系统剪贴板，在 macOS 执行 `Cmd+V`，在 Windows 执行 `Ctrl+V`；原有文字草稿保留，由你确认附件后发送消息。当前只验证窗口焦点，不自动定位 prompt 输入框，也不自动选择 GUI 任务。粘贴会把电脑剪贴板替换为该图片。Windows 检测到窗口或进程身份变化、前台焦点丢失、仍有输入按下或权限不足时会停止粘贴；请松开按键和鼠标按钮、切回目标窗口后重试，并以相同权限级别运行 Codex 与 PalmDesk（通常均不使用管理员权限）。

图片经已认证连接的独立 WebRTC 通道分块传到主机，不使用云端文件存储。切换到阅读、仅观看、断开或结束窗口控制时会取消待处理操作。若图片连接断开，可点「重新连接图片」后手动重试，已选图片会保留。若显示结果未确认，先检查 Codex 附件再重试，避免重复粘贴；已经交给操作系统的输入无法撤销。主动读取手机剪贴板需要 HTTPS 和浏览器允许粘贴；不可用时使用选图入口。两端均需更新到支持此功能的版本。临时原生测试窗口已验证 Windows 真实剪贴板像素、`Ctrl+V`、中英文草稿保留、取消和目标拒绝；真实手机连接 Codex 的附件显示、iOS Safari 及提权目标恢复仍待实机验收，详见 [Windows 图片粘贴验证记录](docs/smoke-artifacts/windows-image-paste-2026-09-24.md)。

## 安装预览版

从 [GitHub Releases](https://github.com/Abreto/palmdesk/releases) 下载 Apple Silicon Mac DMG 或 Windows x64 安装包。使用安装包无需安装 Node.js、pnpm 或开发工具。Mac 打开 DMG 后将 PalmDesk 拖入 Applications，Windows 运行安装向导；随后在手机网页扫码或输入设备凭据连接。

暂不提供 Intel Mac 安装包。Mac 预览版在 macOS 15 构建，更早系统尚未验收；Windows 需要 Windows 10 1903 及以上 / Windows 11 x64，并具有可用的 Windows Graphics Capture。从 v0.0.3 起，macOS 使用固定自签名证书，尚无 Developer ID 签名和公证；Windows 安装包未签名。安装和发布说明见 [桌面安装包与预发布](docs/DESKTOP_RELEASES.md)。

## 本地启动

源码开发需要 Node.js 22.16.0 及以上、`package.json` 固定的 pnpm 11.19.0。macOS 桌面端需要 Xcode Command Line Tools；Windows 使用系统 .NET Framework 4.x 编译器，无需额外安装 Visual Studio。

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev:desktop
```

Windows PowerShell 将复制环境文件的命令替换为 `Copy-Item .env.example .env.local`。首次运行会编译 `native-bin/palmdesk-window.exe`，随后启动 Electron。使用 `pnpm dev:desktop:lan` 可开放开发网页供局域网手机访问。Windows 运行和测试说明见 [Windows 桌面](docs/LOCAL_DEVELOPMENT.md#windows-桌面)。

打包后的桌面客户端默认连接 `https://palmdesk.abreto.icu`，手机邀请网页也使用该地址。网页构建默认同源，开发模式使用本地后端代理，两端必须连接同一个服务。自部署可使用本仓库的 [容器适配层](containers/README.md)，它基于固定 BilldDesk 后端快照提供会话认证和 Cloudflare/coturn 临时凭据，需要 MySQL 和 Redis。部署顺序和浏览器测试方法见 [开发环境](docs/LOCAL_DEVELOPMENT.md)，地址、HTTPS 和 TURN 配置见 [服务配置](docs/SERVICE_CONFIGURATION.md)。

使用默认 `.env.local` 时，设备注册和连接需要本机 `4300` 端口上的后端；启动桌面端或网页不会自动启动后端。使用其他服务时，在 `.env.local` 或客户端连接设置中配置地址，界面保存的设置优先于环境变量默认值。

macOS 开发脚本编译 Swift 窗口辅助程序，并创建、本地签名独立的 Electron 应用：

```text
.local/electron-dev/Electron.app
name: PalmDesk Local <id> Dev
bundle ID: io.github.abreto.palmdesk.local.<id>.dev
```

所有本地构建都按工作区隔离身份。以上名称和 bundle ID 用于主工作区或普通 clone；linked worktree 使用 `PalmDesk WT <id> Dev` 及 `io.github.abreto.palmdesk.worktree.<id>.dev`。本地打包版去掉名称中的 ` Dev` 和标识末尾的 `.dev`；只有显式 `--release` 构建才使用 `PalmDesk` 和 `io.github.abreto.palmdesk`。各身份的权限和配置独立，详情及旧版本迁移步骤见 [应用身份](docs/LOCAL_DEVELOPMENT.md#应用身份)。

macOS 上需给当前工作区的开发应用（`PalmDesk Local <id> Dev` 或 `PalmDesk WT <id> Dev`）配置“屏幕录制”和“辅助功能”权限。观看当前桌面可捕获的窗口需要屏幕录制；切换桌面、还原窗口和发送输入还需要辅助功能，即使处于窗口只读模式也需要授权才能自动切换。屏幕录制授权后可能需要重启。从 Codex Remote 开发版迁移时，应用身份和本地数据目录已改变，需要重新授权和设置连接服务。

`pnpm doctor:desktop` 可检查使用冲突身份的旧构建；macOS 启动检查发现同一身份有多个已注册副本时，也会显示路径并退出。同一身份只保留一个可启动的安装位置，仅给旧 `.app` 改名不能消除冲突。

先在电脑上安装受支持的 Agent，或打开要观察、控制的其他普通应用窗口；窗口可以放在任意 macOS 桌面，或当前 Windows 虚拟桌面。手机打开同一服务的网页，输入电脑显示的设备代码和密码。通过验证后，已开启会话阅读时默认进入阅读页，切到「窗口」即可从 Agent 目录选窗；Agent 尚未运行时，点击「打开 Agent」并选择已安装应用；未开启或不支持读取时默认进入目录。电脑端和手机网页需要使用本版本。

两个连接入口默认都使用「**均衡**」：最高 **2160P、20 fps、3000 kbit/s（3 Mbps）码率上限**，优先保留文字细节。均衡降低了原来的帧率和码率上限，同时保留 3840×2160 捕获上限，以保护 Retina 文字与捏合放大后的可读性。窗口保持原始比例，小窗口和竖屏窗口不会放大；网络受限时滚动可能较不流畅。

「**高细节**」恢复原来的 2160P / 30 fps / 8000 kbit/s；「**省流量**」使用 1080P / 10 fps / 1000 kbit/s，小字可能变模糊。也可分别调整分辨率、帧率、码率和视频内容提示。显式选择保存在当前浏览器或桌面客户端本地，重连时沿用。码率是上限，不是固定发送速率或流量额度；实际用量随画面变化和网络条件调整。阅读会话或将控制端切到后台时，仍会暂停不活跃的窗口视频。这些预设是起始策略，尚非手机实测的最优参数；实机验证见[画质验证说明](docs/VIDEO_QUALITY.md)。

在窗口画面内双指捏合，可围绕手势位置从「适合」连续缩放至 300%。双指一起移动可平移画面；抬起一指后，另一指可继续平移，直到也抬起。这些手势只调整本地视频视图，工具栏和文字输入框保持原位。要单指平移，请选择「移动画面」或「仅观看」；其他触摸模式继续用于远程控制。缩放菜单显示当前比例，选择「适合」可恢复完整画面。

也可在电脑的“手机扫码连接”区域设置手机网页地址，点击“显示二维码”，随后用手机网页里的扫码按钮、系统相机或微信扫描。设备密码和二维码每次启动时默认隐藏，各自提供独立的显示／隐藏按钮。二维码包含当前设备代码和密码，网页打开后自动连接。设备密码永久不变，电脑端不提供更新密码功能，链接在重置设备前持续有效。地址、HTTPS 和微信兼容性说明见 [扫码连接](docs/SERVICE_CONFIGURATION.md#扫码连接)。

### Windows 镜像克隆主机与 `--print-link`

由同一 Windows 镜像克隆出的主机原本会共用母机的设备代码和密码。在阿里云 ECS 上，PalmDesk 启动时读取 `http://100.100.100.200/latest/meta-data/instance-id`，并记录缓存凭据所属的实例。实例 ID 不一致，或凭据产生于此检查之前时，主机会丢弃旧凭据并向后端重新申请设备。约一分钟内取不到 metadata、且此前记录过实例 ID 时，不使用缓存凭据上线，并在后台继续重试。没有 metadata 服务的机器（本地开发、非云主机）保持原有凭据。

Windows 主机登录成功后，按当前配置的手机网页地址把连接链接写入 `C:\ProgramData\PalmDesk\connection.json`（含 `instanceId`、`device`、`password`、`url`、`updatedAt`）。外部系统可通过云助手等方式远程执行。请按实际安装位置调整路径，`C:\app_manager\PalmDesk` 是 `scripts/windows/setup-unattended-host.ps1` 的默认目录：

```powershell
& "C:\app_manager\PalmDesk\PalmDesk.exe" --print-link              # 输出一行连接 URL
& "C:\app_manager\PalmDesk\PalmDesk.exe" --print-link --json       # 输出完整记录
& "C:\app_manager\PalmDesk\PalmDesk.exe" --print-link --timeout=30 --output=C:\temp\link.txt
```

`--print-link` 不打开窗口，也不影响正在运行的实例。它只输出实例 ID 与本机一致的记录，最多等待 `--timeout` 秒（默认 60）。退出码：`0` 成功，`1` 参数错误或平台不支持，`2` 链接尚未写入，`3` 记录属于其他实例，`4` 无法获取实例 ID。PalmDesk 属于 GUI 子系统程序，请通过重定向、管道或 `--output` 获取结果，交互式控制台中可能看不到输出。该文件沿用 ProgramData 默认权限，含明文密码；机器有其他用户时请自行收紧权限。macOS 主机不写此文件。

窗口列表和阅读内容通过已验证连接的 WebRTC DataChannel 传输，后端负责设备认证、信令和 TURN 凭据。自部署需使用 [容器说明](containers/README.md) 中与 PalmDesk 兼容的后端。窗口列表包含当前用户会话中 macOS 各桌面或 Windows 当前虚拟桌面的普通应用窗口，排除本客户端、桌面元素和整个屏幕。macOS 其他桌面、隐藏或最小化的窗口标注“未在当前桌面显示”，仍可展示缩略图。macOS 14 及以上在 Electron 缺少预览时，使用 ScreenCaptureKit 单窗口截图补齐，不激活窗口或切换桌面；系统无法提供画面时保留可选择的窗口条目。选择后主机会激活目标窗口，macOS 可按需切换桌面，最小化时只还原所选窗口。系统或应用拒绝激活、无法唯一识别窗口时会报错；只有窗口实际出现在捕获列表中才会启动视频。刷新列表不会切换桌面，窗口关闭、切离可捕获桌面或身份变化后会结束会话，不会自动选择其他窗口。

macOS 的辅助功能接口可能省略其他桌面的窗口。跨桌面激活会按需动态调用 SkyLight 私有接口读取桌面归属，通过 Mission Control 选择目标桌面，再验证目标实际可见、身份和焦点一致；切换时主机会短暂显示 Mission Control。原生 AX 窗口 ID 用于区分同名同尺寸窗口，接口不可用时只接受唯一的标题与边界匹配。这些接口依赖 macOS 版本，无法完成校验时会停止选择并报错。没有辅助功能信息的不可见无标题窗口会被过滤。

只开发网页：

```bash
pnpm dev:web
```

默认地址为 `http://localhost:5173/`，Vite 将 `/api` 和 `/socket.io` 代理到本机 `4300`。端口被占用时以终端输出为准。手机上的 `localhost` 指手机自身，需要使用可达的局域网地址或 HTTPS 域名。

同一局域网的手机临时调试可运行 `pnpm dev:web:lan`。网页相机扫码需要 HTTPS；局域网 HTTP 下可用系统相机打开连接链接，或在网页中选择二维码图片。

### 从手机打开 Agent

Agent 目录为空或已有应用时，都提供「打开 Agent」。列表展示主机上已安装、可启动的 Codex、Claude、ChatGPT、Kimi 和 ZCode。应用已有原生窗口时沿用现有选窗流程；否则显式启动或唤起应用、刷新目录并短暂等待窗口。手动关联的终端仍可从目录访问，不会阻止桌面应用启动。一个匹配窗口直接进入正常捕获流程，多个窗口由用户选择。应用可能不响应重新开窗；失败或超时后仍可刷新、重试或查看其他应用。

已安装应用的发现与窗口列表独立进行，加载期间仍可选择已有窗口。已安装列表缓存 30 秒，新安装的应用可能需要等待缓存过期后刷新才会出现；每次明确启动时都会重新检查安装状态。

macOS 通过 Launch Services 解析已安装的 `.app` bundle，并发送正常的打开／重新打开请求。Windows 从当前用户已安装的 MSIX 包和 Windows App Paths 注册项中识别受支持的可执行文件，打包应用通过其已注册应用 ID 启动。未注册的便携版、自定义安装和 CLI Agent 不属于启动目标，请先在电脑上打开。Windows 选窗仍限于当前虚拟桌面。不支持的平台和旧版主机会显示原因；请同时更新电脑端和控制端。

启动请求使用当前已认证连接和已知 Agent ID，路径与启动参数仅在主机解析；不会安装应用、提交提示词或编排任务。断开连接会尽可能取消尚未交给操作系统的启动工作，已打开的应用不会被关闭。重连、切换阅读页或控制端进入后台不会重发启动请求。捕获和输入仍需现有权限与原生窗口身份校验。已验证行为和待完成的实机检查见[打开 Agent 验证记录](docs/smoke-artifacts/agent-launch-2026-10-02.md)。

## 构建与检查

```bash
pnpm test:smoke
pnpm typecheck
pnpm build:prod
pnpm build:native
pnpm build:desktop
```

`build:native` 和 `build:desktop` 按当前主机选择 macOS 或 Windows；主工作区或普通 clone 的本地应用输出在 `electron-release/<version>/local-<id>/`，linked worktree 输出在 `electron-release/<version>/worktree-<id>/`，Windows 可运行目录为其中的 `win-unpacked/`。在 Windows 上运行 `pnpm build:desktop:win` 可显式构建 Windows 版本。构建命令不发布 GitHub Release。稳定版分发仍需处理依赖告警、图标来源和第三方许可，并完成 macOS Developer ID 签名、公证及 Windows 代码签名。

Apple Silicon Mac 上使用 `pnpm dist:mac`、Windows 上使用 `pnpm dist:win` 生成本地安装包。所有本地构建默认按工作区隔离应用身份、权限和数据；准备使用正式身份的发行包时，显式添加 `--release`。手动触发 **Desktop Prerelease** 工作流可构建 Apple Silicon Mac 和 Windows x64 安装包，全部成功后统一发布到 GitHub Prerelease，并附 SHA256 校验文件。暂不支持 Intel Mac 安装包。这些测试包尚未完成发行签名或公证。版本规则、操作步骤及安装限制见 [桌面安装包与预发布](docs/DESKTOP_RELEASES.md)。

从 v0.0.3 起，macOS 预发布使用固定自签名证书，并固定原生辅助程序的签名标识；`--release` 构建在证书缺失或不匹配时失败。本地普通构建未配置证书时仍使用 ad-hoc 签名。自签名不替代 Developer ID 和公证，详见[签名配置](docs/DESKTOP_RELEASES.md#固定-macos-签名)。

ad-hoc 签名在重建后可能使旧授权失效，辅助功能和屏幕录制都需要检查。修改授权后，请完全退出 PalmDesk 并重新启动；仅关闭窗口或刷新窗口列表可能仍保留旧进程的权限状态。若重启后仍未授权，请在对应权限列表中移除旧项，再添加并授权该身份当前构建的应用，然后再次完全退出并重启。

`pnpm test:smoke` 已包含会话阅读测试；只检查解析器与读取模块可运行 `pnpm test:session-core`。[会话阅读验证说明](docs/GLASSLINE_INTEGRATION.md#验证) 另提供浏览器联调页，以合成内容和真实 WebRTC 检查混合来源、分页、更新提示及视图切换。

信令集成测试需要正在运行的后端：

```bash
node --test test/smoke/signaling.test.mjs
```

GitHub Actions 配置包含 Linux、macOS、Windows 单元测试、类型检查和网页构建，以及 macOS / Windows 辅助程序编译，不覆盖真实远控或公网部署。

网页和部署适配后的后端可通过主仓库的 GitHub Actions 构建为 Docker 镜像，并发布到 GHCR。镜像名称、固定后端版本及构建方式见 [容器镜像](containers/README.md)；生产凭据、数据库和 Tunnel 由部署环境管理。

## 验证边界与计划

独立的浏览器集成烟测覆盖真实 Vue 页面、运行中的后端、Socket.IO、WebRTC 视频解码和输入 DataChannel，其中原生视频源与系统输入使用测试替身。它需要按 [浏览器与 Electron 烟测](docs/LOCAL_DEVELOPMENT.md#浏览器与-electron-烟测) 准备环境，不在 `pnpm test:smoke` 或源码检查 CI 中运行。历史结果见 [验证报告](docs/CODEX_REMOTE_REPAIR_RESULTS.md)，报告与截图中的 Codex Remote 是项目旧名称。

单独的 Windows 原生测试验证真实窗口捕获与输入。[公网后端验证](docs/smoke-artifacts/public-backend-2026-09-08.md) 记录了打包版 Windows 主机的真实 WGC 视频和 Win32 输入，以及用户随后确认的手机实测成功；跨网络 TURN 行为尚未验证。

窗口选择烟测覆盖选窗前不捕获、跨应用选择、搜索和刷新、权限错误、空列表、选窗前关闭窗口、断开重选、视频像素检查及手机横竖屏布局。单元测试覆盖列表选择标识的隔离、失效标识和捕获前的窗口身份复核。

macOS 原生跨桌面烟测使用两个临时窗口，验证普通桌面与全屏桌面的切换、最小化还原和捕获像素；会短暂切换主机桌面，结束后关闭临时窗口。先准备开发应用及原生辅助程序：

```bash
node scripts/dev.mjs --prepare-only
```

给该工作区的开发应用授予屏幕录制和辅助功能权限后运行：

```bash
.local/electron-dev/Electron.app/Contents/MacOS/Electron test/smoke/native-window-spaces.cjs
```

设置 `SMOKE_PREVIEWS_ONLY=true` 可只验证其他桌面的预览像素与内容刷新，检查截图期间桌面和焦点保持不变。

尚待完成：真实窗口视频流与系统输入的完整验收、权限恢复、iOS Safari 实机、跨 NAT / TURN；以及保存目标后自动直达、页面刷新或被系统回收后的阅读状态恢复。自动重连目前只保留同一存活页面中的状态。原生烟测验证了真实窗口列表、桌面切换、精确焦点和捕获缩略图像素。系统输入依赖操作系统前台焦点，本机用户同时操作或系统快捷键仍可能改变焦点。

## 文档导航

| 文档                                                | 内容                                             |
| --------------------------------------------------- | ------------------------------------------------ |
| [定位与使用场景](docs/USE_CASES.md)                 | AI-native 与 Agent 工作流定位、痛点分析及典型场景 |
| [本地开发](docs/LOCAL_DEVELOPMENT.md)               | 后端准备、Windows 开发、烟测、应用身份和权限恢复 |
| [服务配置](docs/SERVICE_CONFIGURATION.md)           | API、信令、扫码连接、HTTPS 和 TURN               |
| [服务端部署与测试环境](docs/DEPLOYMENT.md)          | 容器编排、数据库初始化、Nginx反代与 ssh-hk 测试环境 |
| [桌面安装包与预发布](docs/DESKTOP_RELEASES.md)      | 安装包、签名、版本规则和发布流程                 |
| [会话阅读](docs/GLASSLINE_INTEGRATION.md)           | 支持来源、读取限制、窗口关联和验证入口           |
| [流模式实现方案](docs/STREAM_MODE.md)               | 单窗口视频流、防模糊编码、Rust 重构评估与无人值守 Windows（RDP 断开）适配 |
| [Windows 无人值守主机部署](docs/WINDOWS_UNATTENDED_HOST.md) | 新机器部署清单：自动登录、开机自启、RDP 断开后保持可捕获、虚拟显示器 |
| [Agent 探测与识别](docs/AGENT_DETECTION.md)         | 原生窗口特征匹配、已安装检测与会话日志发现       |
| [容器镜像](containers/README.md)                    | 网页与后端镜像、固定后端源码及部署适配层         |
| [TURN 验证](docs/TURN_TESTING.md)                   | 强制中继与凭据续期验证                           |
| [历史验证报告](docs/CODEX_REMOTE_REPAIR_RESULTS.md) | 历史测试结果及待验收项目                         |
| [开源准备记录](docs/OPEN_SOURCE_READINESS.md)       | 历史依赖审计和稳定分发前提                       |

## 贡献与许可证

问题和建议提交到 [PalmDesk Issues](https://github.com/Abreto/palmdesk/issues)，参见 [贡献说明](.github/CONTRIBUTING.md)。安全问题见 [SECURITY.md](SECURITY.md)，不要公开设备密码、TURN 凭据或未脱敏的窗口截图。

项目采用 [MIT 许可证](LICENSE.txt)，保留上游 shuisheng 的版权声明并增加 Abreto 的署名。上游归属和依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。[上游开源版说明](README_OpenSource.md) 中的产品、服务和 Pro 功能不代表 PalmDesk 的能力。PalmDesk 是独立项目，与 OpenAI、Anthropic 或 BilldDesk 官方无隶属关系。
