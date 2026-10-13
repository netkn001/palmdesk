# 本地开发

## 环境与服务端

客户端使用 Node.js 22.16.0 及以上和 `package.json` 固定的 pnpm 版本；macOS 主机还需要 Xcode Command Line Tools。Windows 10 1903 及以上 / Windows 11 x64 使用系统 .NET Framework 4.x 编译器。浏览器前端可以独立启动，但设备注册和连接必须有后端。

1. 在独立目录部署 PalmDesk 维护的 [billd-desk-server fork](https://github.com/Abreto/billd-desk-server)。当前固定提交为 `c73983e543341c08ce9e4fb7c52446be50b6c6a2`，参见 [对应服务端说明](https://github.com/Abreto/billd-desk-server/tree/c73983e543341c08ce9e4fb7c52446be50b6c6a2)。
2. 按服务端文档配置 MySQL、Redis 和服务端密钥，初始化数据库及 live 配置。服务端密钥留在服务端目录，不写入客户端的 `VITE_*` 变量。
3. 将开发后端监听地址配置为 `127.0.0.1:4300`，并允许实际前端 origin。改用其他地址时，调整本项目 `vite.config.ts` 的开发代理或显式配置 API / 信令 URL。
4. 在本仓库运行以下命令，再按 [服务配置](SERVICE_CONFIGURATION.md) 连接手机。

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev:desktop
```

依赖含原生模块和 Electron，首次安装需要访问 npm 和 Electron 的下载服务。`pnpm-workspace.yaml` 已允许 Electron、esbuild 和 vue-demi 的必要安装脚本，并禁用遗留部署、图标工具及提示信息脚本。CI 的 `--ignore-scripts` 安装仅用于源码检查；本地启动桌面端请使用上面的普通安装命令。

Electron 下载器需要代理时，设置 `ELECTRON_GET_USE_PROXY=1` 和指向自己 HTTP 代理的 `GLOBAL_AGENT_HTTP_PROXY`。这些是本机安装环境变量，不写入客户端构建配置。本次首次安装在配置代理后完成，并核对了 Electron 可执行文件和 Vue 3 兼容层。

只开发网页时运行 `pnpm dev:web`，局域网实机调试使用 `pnpm dev:web:lan`。启动时以终端输出的端口为准。

桌面端局域网调试运行 `pnpm dev:desktop:lan`，同时启动 Electron 并将开发服务监听到 `0.0.0.0`。同一局域网的设备使用终端输出的 Network 地址访问；也可通过 `pnpm dev:desktop --host 0.0.0.0 --port 5173` 指定端口。

## 检查

无需后端的检查：

```bash
pnpm test:smoke
pnpm typecheck
pnpm build:prod
```

macOS 和 Windows 上另可运行 `pnpm build:native` 和 `pnpm build:desktop`，构建当前主机平台的原生辅助程序和本地应用目录。GitHub Actions 工作流包含 Windows 源码检查和辅助程序编译，云端结果以实际运行记录为准。

生成本地测试安装包使用 `pnpm dist:mac` 或 `pnpm dist:win`，默认使用当前工作区的隔离身份。对外发布的固定身份须显式添加 `--release`。手动触发 GitHub Actions 构建并发布 Apple Silicon Mac 和 Windows x64 测试包的步骤见 [桌面安装包与预发布](DESKTOP_RELEASES.md)。

## Windows 桌面

会话阅读与窗口捕获独立，macOS 和 Windows 均默认开启；在电脑首页设置后持久化，关闭会撤销进行中和后续的读取并清空已连接阅读页。

| 本地来源 | macOS 主机 | Windows 主机 |
| --- | --- | --- |
| Codex | 支持 | 支持原生 Windows 日志 |
| Claude Code | 支持 | 支持原生 Windows 日志 |
| Claude Desktop · Code | 支持 | 支持原生本地 Code 日志 |
| Desktop Chat/Cowork、云端/SSH/WSL 抓取 | 不支持 | 不支持 |

Windows 默认读取 `%USERPROFILE%\.codex`、`%USERPROFILE%\.claude`；`CODEX_HOME`、`CLAUDE_CONFIG_DIR` 可覆盖。Desktop 检查 `%APPDATA%\Claude`、`%LOCALAPPDATA%\Claude-3p`、旧版 `%APPDATA%\Claude-3p`，以及 `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache` 下的 `Roaming\Claude`、`Local\Claude-3p`、`Roaming\Claude-3p`。macOS 默认读取 `~/.codex`、`~/.claude`、`~/Library/Application Support/Claude` 与 `Claude-3p`。`CLAUDE_USER_DATA_DIR` 仅使用指定的 Desktop 目录。自定义变量需在启动 PalmDesk 前设置，支持空格和非 ASCII 路径。

Linux 主机不启用阅读。WSL 主目录不自动发现，Desktop 的 SSH/WSL 索引也不读取；本功能不会启动 Agent、抓取云端日志或自动选择 GUI 任务。日志布局不是稳定 API，Windows 格式核对、已运行检查及真实手机验收缺口见 [Windows 会话阅读验证记录](smoke-artifacts/windows-session-reading-2026-09-24.md)。

在 Windows 10 1903（build 18362）及以上或 Windows 11 x64 的 PowerShell 中运行：

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
pnpm dev:desktop
```

`build:native` 和开发脚本使用 `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`，缺失时尝试 `Framework` 目录。辅助程序通过 Win32 API 枚举窗口、查询进程身份、读取物理边界和校验前台焦点。开发输出为 `native-bin/palmdesk-window.exe`，打包后位于 `resources/native/palmdesk-window.exe`，运行时不会打开控制台窗口。

手机选窗、视频和键鼠输入的操作流程与 macOS 相同。窗口列表覆盖当前虚拟桌面可见或最小化的普通应用窗口，排除任务栏、桌面、工具窗口、其他虚拟桌面的隐藏窗口及 PalmDesk 自身。选择最小化窗口时仅还原该窗口。Windows 版本不自动切换虚拟桌面。

Windows 默认以当前用户权限运行，不要求管理员授权。系统不允许普通进程向权限级别更高的程序注入输入，此时视频会保留，控制暂停并提示权限问题。使用相同权限级别运行目标应用和 PalmDesk 后可重试。UAC 安全桌面、锁屏及受保护内容不属于可控制窗口。系统拒绝前台切换或目标被模态对话框禁用时，也会暂停输入，需在电脑上处理后重试。

“发送文字”通过 Windows `SendInput` 的 Unicode 事件输入原文，不经过键盘布局或中文输入法的拼音转换，不写入系统剪贴板。发送前再次校验目标 HWND、进程身份、前台焦点和权限；常用按键与硬件键盘仍使用正常键盘事件。

应用不需要 macOS 的屏幕录制或辅助功能授权，Windows 页面不展示这些设置入口。窗口边界使用每显示器 DPI 感知的物理像素；在输入前重新读取，保留副屏负坐标，不额外乘以主显示器缩放比例。关闭窗口、切换到其他虚拟桌面或进程身份改变会结束对应捕获会话。

Windows 主机启用 Chromium 的 WGC 窗口捕获，并检查系统的 `GraphicsCaptureSession.IsSupported()` 和显示器状态。系统版本过旧、WGC 不可用或被启动参数禁用时拒绝捕获。传统 GDI 捕获的边框裁剪与 WGC 不同，因此本版本不回退到该路径。

```powershell
pnpm build:desktop:win
```

主工作区的本地构建输出在 `electron-release/<version>/local-<id>/win-unpacked/`，可运行其中的 `PalmDesk Local <id>.exe`；linked worktree 使用 `worktree-<id>/win-unpacked/PalmDesk WT <id>.exe`。构建不发布安装包；发行签名和安装包分发需要另外配置。配置位于 `%APPDATA%\<应用名称>`，热开发应用的名称再加 ` Dev`，各身份均独立于正式版 `%APPDATA%\PalmDesk`。

原生集成烟测会创建两个临时同名窗口，检查 HWND 身份、边界刷新、指定窗口聚焦、最小化还原、失效身份和关闭窗口后的拒绝。它会短暂改变前台窗口，结束后清理测试窗口；只在解锁的交互式 Windows 会话中显式运行：

```powershell
pnpm build:native
$env:PALMDESK_NATIVE_SMOKE = 'true'
node --test test/smoke/native-window-windows.test.cjs
Remove-Item Env:PALMDESK_NATIVE_SMOKE
```

普通 `pnpm test:smoke` 不操作 Windows 前台窗口。原生烟测验证 Win32 适配器，不替代手机实机、真实 WebRTC 视频和系统输入的完整验收。

开发程序仍在运行时，未修改原生源码的构建会复用已有辅助程序。修改了 C# 源码后，先退出开发版 PalmDesk 再编译，避免 Windows 的可执行文件占用限制。

打包版的窗口视频和输入烟测不需要后端。在可解析 `playwright` 的环境中，先执行 `pnpm build:desktop:win`，完全退出同一应用身份的 PalmDesk 打包版，然后运行：

```powershell
$env:PALMDESK_NATIVE_SMOKE = 'true'
node test/smoke/electron-window-windows.mjs
Remove-Item Env:PALMDESK_NATIVE_SMOKE
```

该测试创建两个开启输入法的临时测试窗口，验证打包版主进程、原生窗口源、解码像素与尺寸、鼠标点击、中英文混合文字和无效会话拒绝；结束后停止视频并关闭测试进程。Windows 的 Electron 应用配置路径不受测试进程的 `APPDATA` / `LOCALAPPDATA` 环境变量覆盖影响，打包测试沿用该应用身份的配置目录；已有同身份实例会使测试实例因单实例锁而提前退出。可用 `SMOKE_ELECTRON_EXECUTABLE` 指定其他打包版路径；`SMOKE_DESKTOP_DEV=true` 使用已构建的开发版主进程、本地辅助程序和独立的测试应用名。它不覆盖手机浏览器、网络传输或混合缩放的多显示器实机组合。

后端启动后运行信令测试：

```bash
node --test test/smoke/signaling.test.mjs
```

连接已部署的后端时，`SMOKE_BACKEND_URL` 指定信令 origin；API 使用单独路径时，通过 `SMOKE_API_BASE_URL` 指定完整 API 基址：

```powershell
$env:SMOKE_BACKEND_URL = 'https://remote.example.com'
$env:SMOKE_API_BASE_URL = 'https://remote.example.com/api'
node --test test/smoke/signaling.test.mjs
```

该测试使用客户端实际的 `nativeWebRtcOffer`、`nativeWebRtcAnswer` 和 `nativeWebRtcCandidate` 事件。Node.js 测试不验证浏览器或 Electron 的 Origin 限制，仍需使用实际客户端确认连接。

## 浏览器与 Electron 烟测

窗口手势烟测复用图片粘贴测试页中的真实 `RemoteViewport` 和输入 DataChannel，无须后端。按下文安装 Playwright 后，分别启动测试页和测试：

```bash
pnpm exec vite --config test/smoke/image-paste.vite.mjs
NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/viewport-gestures-browser.mjs
```

使用 Chrome 的真实触摸事件验证双指缩放的焦点、连续缩放比例、适合至 300% 的范围、双指及单指平移、缩放后的远程点击坐标、仅观看、取消、横屏和文字草稿保留，并检查手势没有产生远程输入或整页缩放。手势仲裁、拖拽释放、长按取消、指针丢失和三指切换由 `pnpm test:smoke` 覆盖。手机 Safari 和 Android Chrome 仍需真机验收。

图片粘贴的浏览器烟测使用真实 Vue 输入面板和 WebRTC DataChannel，不需要后端；桌面粘贴操作由测试替身记录。按下文安装 Playwright 后，分别启动测试页和测试：

```bash
pnpm exec vite --config test/smoke/image-paste.vite.mjs
NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/image-paste-browser.mjs
```

覆盖 PNG/JPEG 选图、文字框图片粘贴、逐字节传输、文字草稿保留、取消后重试、仅观看和手机布局，截图写入 `.local/image-paste/`。回归场景还包括快速点击输入框后立即粘贴、普通输入通道延迟时保持点击与粘贴顺序、传输中保留文字粘贴、收起输入面板后恢复控制、替换图片时禁止发送旧图，以及图片通道断开后独立重连。不代表 iOS Safari 真机或真实 Codex 附件已经验收。协议校验、大小限制、会话失效、去重、取消排队粘贴、点击与粘贴的主进程执行顺序和修饰键释放由 `pnpm test:smoke` 覆盖。

macOS 上还可在准备隔离开发应用后运行真实图片剪贴板烟测：

```bash
node scripts/dev.mjs --prepare-only
.local/electron-dev/Electron.app/Contents/MacOS/Electron test/smoke/electron-image-paste.cjs
```

该测试用隐藏的临时 Electron 窗口验证原生 PNG/JPEG 解码、macOS 图片剪贴板和粘贴事件；结束时若剪贴板仍是测试图片，会恢复先前的文字、HTML、RTF 和图片。它使用测试窗口的 `webContents.paste()`，不验证系统 `Cmd+V` 或操作真实 Codex，结果写入 `.local/image-paste/electron-result.json`。

Windows 图片粘贴复用相同的手机选图、预览和认证传输，只对进程身份匹配 `codex.exe` 的窗口开放。主进程串行释放按键和鼠标按钮、聚焦选定窗口；原生辅助程序在写入剪贴板前及执行 `Ctrl+V` 前复核 HWND、PID、可执行文件完整路径、进程启动时间、前台焦点和进程权限。粘贴阶段不会重新抢回焦点，排队中的原生请求会在提交前复核取消状态；快捷键已经交给操作系统后无法撤销，结果未确认时必须先检查附件，不自动重放。

在已解锁的 Windows 桌面运行以下 PowerShell 命令验证真实系统剪贴板和快捷键。测试会临时聚焦自己创建的窗口，只在测试目录编译一个名为 `Codex.exe` 的 fixture 来通过生产代码的进程识别，不操作已安装的 Codex，也不发送消息：

```powershell
pnpm build:native
$env:PALMDESK_NATIVE_SMOKE = 'true'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
node --test test/smoke/native-window-windows.test.cjs
node node_modules/electron/cli.js test/smoke/windows-image-paste.cjs
Remove-Item Env:PALMDESK_NATIVE_SMOKE
```

该测试读取剪贴板的 PNG 格式（保留透明度），逐像素比较 PNG/JPEG 解码内容，验证 `Ctrl+V`、中英文混合草稿、按键释放、取消、过期进程身份、焦点变化和关闭目标；不会把 Windows Forms 的旧式 DIB 格式当作 Chromium 的 PNG 附件。测试还让独立进程锁定剪贴板，确认 Electron 静默写入失败时不会发送粘贴快捷键，释放锁后允许显式重试。测试结束且剪贴板仍是测试内容时恢复常用剪贴板格式，结果写入 `.local/image-paste/windows-result.json`。浏览器烟测另覆盖原始字节传输、阅读/仅观看取消和图片通道重连。两者均不能替代手机连接真实 Codex 的附件验收；记录和待验收步骤见 [Windows 图片粘贴验证记录](smoke-artifacts/windows-image-paste-2026-09-24.md)。

Windows 权限错误需要以相同权限级别运行 Codex 与 PalmDesk，通常关闭目标的「以管理员身份运行」即可；前台焦点错误需要关闭阻挡的对话框并切回所选窗口。按键占用错误需释放所有按键和鼠标按钮。处理后手动点击粘贴即可重新校验；其他应用、HEIC/GIF、多图、任意文件、裁剪和标注仍不在本功能范围内。

窗口画质回归测试不需要后端，只捕获测试程序自己创建的文字窗口，验证旧 1080P 约束与新默认画质的实际尺寸、先建立 DataChannel 再添加视频时的编码参数，以及 720P 降档后恢复原始尺寸。macOS 上使用当前工作区的隔离开发应用运行：

```bash
node scripts/dev.mjs --prepare-only
.local/electron-dev/Electron.app/Contents/MacOS/Electron test/smoke/electron-video-quality.cjs
```

Windows 可执行 `pnpm exec electron test/smoke/electron-video-quality.cjs`。测试会短暂显示自己的窗口，结果写入 `.local/video-quality/result.json`，包含实际显示器缩放比例。普通显示器上的结果不代表已经完成 Retina 或手机实机验收。

烟测使用 Playwright 和本机 Chrome。把额外依赖装在被 Git 忽略的目录：

```bash
npm install --prefix .local/smoke --no-package-lock --no-save playwright
NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/business-flow.mjs
```

默认 Chrome 路径为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，可用 `SMOKE_BROWSER_EXECUTABLE` 覆盖。`SMOKE_CLIENT_URL` 默认 `http://localhost:5173`，`SMOKE_BACKEND_URL` 默认 `http://127.0.0.1:4300`。

凭据显示烟测使用生产网页、真实 Pinia 持久化和二维码解码器，自行启动本地 HTTP / Socket.IO 服务；设备 API 和桌面 IPC 使用测试替身，无需部署后端或控制真实窗口：

```bash
npm install --prefix .local/smoke --no-package-lock --no-save playwright socket.io
pnpm build:prod
NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/credential-visibility.mjs
```

覆盖首次启动无明文闪现、旧版显示密码设置、刷新后重新隐藏、密码与二维码独立键盘操作、隐藏截图不可解码／显示截图可解码、复制链接、密码更新、重连和窄屏布局。截图写入 `.local/credential-visibility/`，仅使用测试凭据；不替代实体手机相机验收。

手机后台恢复烟测自行启动本机 HTTP / Socket.IO 服务，使用真实 Vue 页面、会话认证模块和 WebRTC；设备存储、窗口捕获、输入及会话记录使用合成数据，不需要部署后端或控制真实窗口：

```bash
npm install --prefix .local/smoke --no-package-lock --no-save playwright socket.io
pnpm build:prod
NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/mobile-resume.mjs
```

覆盖后台／阅读暂停视频、未送达状态消息后的主机超时暂停、断线重认证、阅读位置与草稿保留、恢复原窗口及关闭窗口后的拒绝恢复。页面可见性由测试事件模拟，不能代替 iOS Safari 切换应用、锁屏以及 Wi-Fi／蜂窝切换的实机验收。

Electron 外壳烟测要求已构建 `electron-dist/`，通过 `pnpm dev:desktop` 生成了独立开发应用，前端及后端仍在运行，并且没有其他 PalmDesk 实例占用单实例锁：

```bash
NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/desktop-shell.mjs
```

macOS 辅助进程回归测试要求已运行 `pnpm build:desktop`、没有其他打包版实例运行，且已有屏幕录制授权：

```bash
NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/native-helper.mjs
```

测试只截取临时测试窗口，验证生成缩略图后和空闲时辅助进程均不出现在 Dock，并检查命令响应、退出和重启。传入 `native-bin/codex-window` 可检查开发版辅助程序。辅助程序启动时显式设置后台策略，避免沿用主应用的前台身份；主应用的名称、标识及权限归属保持原样。

扫码流程使用同一个烟测入口，指定可达的局域网地址（不要用回环地址）：

```bash
pnpm dev:web:lan --port 5187
```

另一个终端运行：

```bash
NODE_PATH="$PWD/.local/smoke/node_modules" \
SMOKE_HOST_URL=http://127.0.0.1:5187 \
SMOKE_CLIENT_URL=http://192.168.1.10:5187 \
SMOKE_QR=true \
SMOKE_ARTIFACT_DIR=.local/qr-artifacts \
node test/smoke/business-flow.mjs
```

将客户端 IP 替换为本机地址。模拟电脑端使用回环地址获得与 Electron 一致的安全上下文，手机端使用局域网 HTTP 验证相机受限时的流程。该测试实际渲染和解码 host 二维码，运行本地 API、Socket.IO 和 WebRTC，覆盖链接直达、图片识码、相机帧识码、密码变更、无效码、设备离线、失败重试和相机释放。相机视频、原生窗口捕获和系统输入使用测试替身，不操作真实应用窗口，也不代表手机相机或微信已实机验收。

测试会写入 `docs/smoke-artifacts/`。提交截图前检查设备代码、密码和窗口内容；合成视频测试不代表真实窗口验收完成。旧报告记录的是当时的本机测试环境，临时目录、容器和进程不属于新克隆的前置条件。

## 应用身份

所有本地构建默认与正式版隔离，包括 `pnpm dev:desktop`、`pnpm build:desktop`、`pnpm dist:mac` 和 `pnpm dist:win`。`NODE_ENV=production` 或生成安装包不会自动选择正式身份。

| 构建                            | Bundle ID                                     | 应用名称                  |
| ------------------------------- | --------------------------------------------- | ------------------------- |
| 主工作区或普通 clone 的本地打包 | `io.github.abreto.palmdesk.local.<id>`        | `PalmDesk Local <id>`     |
| 主工作区或普通 clone 的热开发   | `io.github.abreto.palmdesk.local.<id>.dev`    | `PalmDesk Local <id> Dev` |
| linked worktree 的本地打包      | `io.github.abreto.palmdesk.worktree.<id>`     | `PalmDesk WT <id>`        |
| linked worktree 的热开发        | `io.github.abreto.palmdesk.worktree.<id>.dev` | `PalmDesk WT <id> Dev`    |
| 显式 `--release` 打包           | `io.github.abreto.palmdesk`                   | `PalmDesk`                |

`<id>` 根据各自 Git 管理目录的真实路径生成，不同 clone 和 worktree 不共享身份。重复构建、切换分支和 linked worktree 的 `git worktree move` 不会改变它，符号链接也不会产生新身份。源码压缩包没有 Git 元数据时使用源码目录的真实路径；移动整个仓库或源码目录会产生新身份。已有 linked worktree 的 bundle ID 保持兼容。

构建配置为 `electron-builder.cjs`，会同时设置 bundle ID、应用名称和包内运行时名称。`pnpm dev:desktop` 同样隔离主应用及 Electron Helper 的标识。各身份的配置、浏览器存储和单实例锁位于各自的 `~/Library/Application Support/<应用名称>` 目录。每个新身份需单独授予屏幕录制和辅助功能权限；主工作区迁移到新身份后，需要重新配置连接服务。

`--release` 适用于 `build:desktop` 和 `dist:*`，无论从主工作区、clone 还是 worktree 执行，都使用固定的正式身份。只在准备发行产物时使用，例如 `pnpm dist:mac --release`。发布脚本将选择显式传给打包器；普通构建会覆盖继承的 `PALMDESK_BUILD_CHANNEL`，避免终端环境意外把开发包变成正式身份。直接调用 electron-builder 时默认仍为本地身份，只有 `PALMDESK_BUILD_CHANNEL=release` 才选择正式身份。

`node scripts/dev.mjs --prepare-only` 可只生成开发应用，用于核对 `Info.plist` 和签名，不启动窗口或申请权限。原生及桌面烟测应使用当前 worktree 的开发应用，不能借用主工作区的 Electron，否则权限申请仍会归属被借用的应用。

主工作区的本地打包产物位于 `electron-release/<version>/local-<id>/`，worktree 使用 `electron-release/<version>/worktree-<id>/`，显式发布构建使用 `electron-release/<version>/`。主工作区和 linked worktree 都可在准备开发应用并完成本地打包后，运行 `NODE_PATH="$PWD/.local/smoke/node_modules" node test/smoke/desktop-identity.mjs` 验证两种构建的主应用、Helper 标识、签名和运行时数据目录。测试会短暂注册并清理一个开发版身份的重复包，覆盖 `.app.disabled` 改名场景；只加载空白页面，不申请屏幕录制或辅助功能权限。

隔离规则不会改写已经生成的 `.app`。旧分支即使不再运行，其产物仍可能被 LaunchServices 注册为正式版；仅重置 TCC 不会移除这些副本。`pnpm doctor:desktop` 会检查本仓库所有 Git worktree 的 `electron-release` 和 `.local`，列出身份不匹配的完整路径，macOS 打包也会执行此检查。无 Git 元数据时检查当前源码目录。检查读取 `Contents/Info.plist`，同时覆盖 `.app.disabled` 等改名残留；显式发布构建写入 `PalmDeskBuildChannel=release`，用于与旧的本地正式身份产物区分。

主工作区原有 `.local/electron-dev/Electron.app` 使用共享的 `io.github.abreto.palmdesk.dev`，需合入新规则后在主工作区执行 `node scripts/dev.mjs --prepare-only` 重建。其他旧包保留备份时应先压缩归档，再移除原始目录；仅移动目录、改显示名称或改后缀都无法消除身份冲突。

macOS 启动时通过原生辅助程序读取父进程的真实 bundle ID、可执行文件路径和该 ID 的所有有效注册路径。在加载输入模块、获取单实例锁和创建窗口之前完成检查；发现多个副本时显示具体冲突路径并退出，不继续申请权限。别名和符号链接会按真实路径去重。此检查也覆盖 worktree 之外的旧副本；因此同一身份日常只保留一个可启动的安装位置。

### 重建与权限恢复

隔离 bundle ID 解决不同构建互相覆盖的问题；ad-hoc 签名的 designated requirement 通常包含代码哈希，重建后同一个身份仍可能需要重新授权。日常使用的应用应保持固定安装位置，并使用固定的代码签名证书。已在钥匙串安装 Developer ID 或本机代码签名证书时，可以通过 `CSC_NAME` 指定，打包和开发应用都支持；证书不可用会使构建失败。

```bash
CSC_NAME='证书名称或 SHA-1 指纹' pnpm build:desktop
```

已有权限条目指向错误副本时，先退出相关 PalmDesk 应用，运行 `pnpm doctor:desktop`。归档并移除仍使用正式版 bundle ID 的旧副本，随后针对旧路径取消 LaunchServices 注册，再注册保留的正式版路径：

```bash
lsregister_bin=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$lsregister_bin" -u '/旧路径/PalmDesk.app'
"$lsregister_bin" -f '/保留路径/PalmDesk.app'
```

再次运行 `pnpm doctor:desktop` 应通过。旧分支必须合入身份隔离修复后才能重新构建使用，解压旧备份也会重新引入冲突。在系统设置的“屏幕录制”和“辅助功能”中移除错误的 PalmDesk 条目，再添加保留的正式版并重新授权，最后完全退出并重启。隔离后的 worktree 应单独添加其 `PalmDesk WT <id>` 条目。不要全局重建 LaunchServices 数据库或重置其他应用的权限。

若仍需通过命令清理某个开发版的旧授权，使用其完整 bundle ID，只重置该身份的对应权限，然后重新授权。将以下 `<id>` 替换为实际标识，热开发应用还需加 `.dev`；不要用正式版的 ID 清理开发版权限：

```bash
tccutil reset ScreenCapture 'io.github.abreto.palmdesk.local.<id>'
tccutil reset Accessibility 'io.github.abreto.palmdesk.local.<id>'
```

代码签名身份的说明见 [Apple TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html)。从旧 Codex Remote 版本迁移同样需要重新授予权限，原有连接设置不自动迁移。

macOS 和 Windows 上「会话阅读」默认开启，应用会读取当前用户的 Codex、Claude Code 和 Claude Desktop 本地 Code 会话（含 `Claude-3p` 配置）；读取范围和测试入口见 [会话阅读集成说明](GLASSLINE_INTEGRATION.md)。视频捕获使用窗口源，输入使用操作系统鼠标、键盘和前台焦点。真实窗口和手机验收项目见 [验证报告](CODEX_REMOTE_REPAIR_RESULTS.md)。
