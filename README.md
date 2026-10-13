# PalmDesk

English | [简体中文](README.zh-CN.md)

AI-native remote control for desktop apps: read local AI sessions and control one macOS or Windows window from your phone for agent-ready workflows.

PalmDesk is maintained by [Abreto](https://github.com/Abreto) and built on the open-source edition of [BilldDesk](https://github.com/galaxy-s10/billd-desk). Its AI-native design centers on how people use AI agents: discover agent applications, read supported local sessions, and continue working in the original application window. From a phone browser, interact with Codex, ChatGPT, Claude, Kimi, ZCode, WorkBuddy, or a terminal on macOS or Windows. A desktop browser can also act as the controller.

**Status: experimental preview, with no stable release yet.** Packaged desktop builds connect to the official backend at [https://palmdesk-hk-test.ziniaocloud.com](https://palmdesk-hk-test.ziniaocloud.com) by default. After connecting, the controller opens session reading if enabled on the host; otherwise it opens the Agent directory. Window capture starts only after you select a window. Automatically reopening the last selected window is planned. Historical dependency audit results and release prerequisites are recorded in the [open-source readiness notes](docs/OPEN_SOURCE_READINESS.md).

## Session Reading Preview

PalmDesk now embeds the session reader migrated from Glassline; no separate Glassline deployment is needed. It supports **the current user's local Codex, Claude Code, Claude Desktop Code, and WorkBuddy sessions on macOS and Windows**, listed together by last update with a source label.

| Local source | macOS host | Windows host |
| --- | --- | --- |
| Codex | Supported | Supported (native Windows logs) |
| Claude Code | Supported | Supported (native Windows logs) |
| Claude Desktop · Code | Supported | Supported (native local Code logs) |
| WorkBuddy | Supported | Supported (native Windows logs) |
| Desktop Chat/Cowork, cloud/SSH/WSL retrieval | Unsupported | Unsupported |

Codex reads from `CODEX_HOME` or `~/.codex`. Claude Code reads `projects/*/*.jsonl` under `CLAUDE_CONFIG_DIR` or `~/.claude`, including renamed sessions, text replies and tool results. WorkBuddy reads `sessions/*.jsonl` under `WORKBUDDY_HOME`, `WORKBUDDY_DATA_DIR`, or `~/.workbuddy-ai`, with real-time heartbeat status from running processes. On Windows, `~` is the current user's home (normally `%USERPROFILE%`). Claude Desktop uses `~/Library/Application Support/Claude` and `Claude-3p` on macOS; on Windows it checks `%APPDATA%\Claude`, `%LOCALAPPDATA%\Claude-3p`, legacy `%APPDATA%\Claude-3p`, and their packaged-app locations under `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache`. `CLAUDE_USER_DATA_DIR` selects a single custom Desktop directory. This covers global and per-session transcripts, preserves Desktop titles and deduplicates shared logs.

Set custom directories in the environment that launches PalmDesk; spaces and non-ASCII names are supported. Reading stays local and read-only. WSL homes are not automatically searched, Desktop SSH/WSL indexes and nested subagent transcripts are excluded, and no cloud logs are fetched. A readable local transcript must exist. Linux hosts do not support session reading. Windows storage and automated checks are recorded in the [validation notes](docs/smoke-artifacts/windows-session-reading-2026-09-24.md); a physical Windows host + phone run for all three sources is still unvalidated.

Enable **会话阅读** (Session reading) on the desktop home page, then connect from your phone using the QR code or device credentials. The controller opens the **阅读** (Read) tab, which lists searchable sessions and renders Markdown, copyable replies, paginated history and collapsed tool output. Reading works without starting window capture or granting Screen Recording and Accessibility permissions. While visible, the reader checks the selected session for updates every eight seconds and offers a button to view new content without moving your reading position automatically.

Choose **去窗口继续** (Continue in window) to open the window view and select an application window if none is selected. Window associations are navigation hints for the current connection: confirm the active task in the GUI before sending a prompt. Switching between reading and the window retains the connection, reading position and unsent input draft. The Read tab releases held keys, blocks window input and pauses video transmission. Returning to the Agent directory to choose another window reconnects and clears the reading selection and window associations.

Switching to another phone app or locking the screen pauses video transmission; if the browser is suspended before it can notify the host, the desktop pauses video after ten seconds without controller updates. Returning to the same browser page resumes video or reconnects automatically, preserving the reading position and text draft. After a disconnect, the desktop can restore the selected window for five minutes, only for the same authenticated controller and after checking its native identity again. A closed or expired window returns to the picker. Reading mode does not restart capture until you return to Window. Both clients must support this feature. Browser background connections are not guaranteed, and reloading/discarding the page does not preserve this in-memory state. Physical iOS Safari validation is still required.

Reading is disabled by default and enabled per desktop installation. Disabling it revokes subsequent reads and clears connected readers. The result stream uses its own WebRTC DataChannel. Lists show the newest 100 matching sessions; search covers all discovered sessions. Timeline pages contain up to 40 items, with each body/output capped at 16,384 characters and visibly marked when truncated. Detail reads reject logs larger than 32 MiB and direct you to the original window. Logs may be incomplete and task state can be unknown. Attachment previews and automatic GUI task selection are not included. See the [integration notes](docs/GLASSLINE_INTEGRATION.md).

## Features

- Stream a single application window via Electron capture and WebRTC, with input sent over a DataChannel.
- Connect from a mobile page with device history, portrait and landscape layouts, and quality and frame-rate controls.
- Connect using a device code and password, or scan the desktop's QR code with a camera or an image. Connection links authenticate automatically and open reading when enabled, or the Agent directory otherwise.
- Browse application windows across macOS Spaces, search by application name or window title, view thumbnails, and refresh the list. Capture starts only after you select a window.
- Use the Window tab's Agent directory to discover open Codex, Claude, ChatGPT, Kimi, ZCode, and WorkBuddy applications. A single window opens directly; multiple windows expand for selection. Running applications without an available window remain listed.
- Choose **打开 Agent** (Open Agent) to launch an installed, supported application on the connected computer. After launch, one available window opens directly; multiple windows remain a choice. Running apps without windows can be reopened with an explicit retry.
- Pin agents and retain recently used agents per device. Other applications remain accessible, and terminal windows can be manually associated with an agent. Manual associations survive refresh within the current connection and must be recreated after reconnecting.
- Agent discovery uses macOS bundle IDs or Windows executable identities. "Open" describes the application, not task execution. The separate Read tab shows supported local sessions, project paths and states inferred from logs; it does not identify or switch the active task in the GUI.
- Activate windows on other Spaces or restore a selected minimized window before capture begins.
- Return to the Agent directory and choose another window by reconnecting with the existing device credentials. Windows within each agent retain their original order.
- Use tap, double tap, long-press right click, drag, scroll, pinch-to-zoom, pan, and read-only mode.
- Compose text locally, including Chinese text, then send it to the host. Send Enter, common keys, and hardware keyboard input.
- Select or paste a single PNG/JPEG on your phone, preview it, and paste it into a macOS or Windows Codex prompt.
- On macOS, identify the target by application bundle ID, process ID, and native window ID; refresh its bounds and verify focus before sending input.
- On Windows, identify the target by HWND, process ID, executable path, and process start time. Support regular windows on the current virtual desktop, restoring a selected minimized window, and physical coordinates across high-DPI and multiple displays.
- Send literal Unicode text on Windows, preserving Chinese and English text without conversion by the host's input method.
- Stop input and release held keys when the window disappears, capture ends, or the connection closes.
- Configure API and signaling services. Browser clients use the current origin by default. TURN credentials are issued and renewed by the backend unless a manual TURN configuration is supplied.

**Hosts support macOS and Windows.** Linux has no native host adapter and rejects capture and input. This host restriction does not apply to browser controllers. Video uses a window source, but input still relies on system focus and mouse/keyboard APIs; it does not provide operating-system-level input isolation.

### Paste images into Codex from your phone (macOS and Windows)

Connect to a macOS or Windows host and select its Codex window. Use the image picker or clipboard button below the text composer, or paste an image into the text field. The initial version accepts one PNG/JPEG at a time, up to 10 MiB, approximately 25 megapixels, and 16384 pixels per side. HEIC, GIF, and other files are unsupported. Original image bytes are transferred unchanged; the host decodes them for its image clipboard without resizing or lossy recompression. Windows identifies Codex by its executable/process identity, not the window title; other applications do not expose these controls.

Tap the Codex prompt in the remote video first, then choose “粘贴到 Codex” (Paste into Codex). The host verifies the control session and window identity, writes the image to its system clipboard, and presses `Cmd+V` on macOS or `Ctrl+V` on Windows. Existing text drafts are preserved; confirm the attachment and send the message yourself. PalmDesk verifies window focus but does not locate the prompt or select a GUI task automatically. Pasting replaces the computer's clipboard with the image. On Windows, a changed window/process, lost foreground focus, held input, or insufficient permission stops the paste. Release held keys/buttons and return to the selected window before retrying; run Codex and PalmDesk at the same privilege level (normally both without administrator privileges).

Images travel in chunks over a dedicated WebRTC channel on the authenticated connection, without cloud file storage. Switching to reading or watch-only mode, disconnecting, or ending capture cancels pending work. If the image connection closes, choose “重新连接图片” (Reconnect images), then retry manually; your selected image is retained. If the result is unconfirmed, inspect Codex's attachments before retrying to avoid duplicates; input already delivered to the OS cannot be undone. Reading the phone clipboard requires HTTPS and browser paste permission; use the image picker when unavailable. Update both clients to a version supporting this feature. Real Windows clipboard pixels, `Ctrl+V`, mixed Chinese/English draft preservation, cancellation and target rejection are covered by disposable native fixtures. Physical-phone testing with actual Codex attachments, including iOS Safari and elevated-target recovery, remains pending; see the [Windows image-paste validation record](docs/smoke-artifacts/windows-image-paste-2026-09-24.md).

## Getting Started

### Install a Preview

Download an Apple Silicon Mac DMG or Windows x64 installer from [GitHub Releases](https://github.com/Abreto/palmdesk/releases). Installing a packaged client does not require Node.js, pnpm or development tools. Open the DMG and drag PalmDesk into Applications, or run the Windows installer, then connect from the phone web client using the desktop's QR code or device credentials.

Intel Mac installers are not provided. Mac previews are built on macOS 15; earlier versions have not been validated. Windows requires Windows 10 1903 or later / Windows 11 x64 with Windows Graphics Capture available. macOS previews use a fixed self-signed certificate from v0.0.3 onward, without Developer ID signing or notarization; Windows installers are unsigned. See [installation and release details](docs/DESKTOP_RELEASES.md).

### Development Prerequisites

Source development requires Node.js 22.16.0 or later and pnpm 11.19.0, as pinned in `package.json`. macOS desktop development requires Xcode Command Line Tools. On Windows, the helper uses the system .NET Framework 4.x compiler; Visual Studio is not required.

Packaged desktop builds default to `https://palmdesk-hk-test.ziniaocloud.com`, including the phone invitation homepage. Browser builds use their current origin; development uses the local backend proxy. Both clients must connect to the same service. For self-hosting, the [container adapter](containers/README.md) builds the pinned BilldDesk backend with PalmDesk session authentication and Cloudflare/coturn credential issuance; MySQL and Redis are required. See the [local development guide](docs/LOCAL_DEVELOPMENT.md) and [service configuration](docs/SERVICE_CONFIGURATION.md).

### Start the Desktop Client

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev:desktop
```

In Windows PowerShell, copy the environment file with `Copy-Item .env.example .env.local`. The first launch compiles `native-bin/palmdesk-window.exe` and starts Electron. See the [Windows desktop guide](docs/LOCAL_DEVELOPMENT.md#windows-桌面) for development and testing. Use `pnpm dev:desktop:lan` to expose the development page to phones on the local network.

With the default `.env.local`, device registration and connection require a backend on port `4300`; starting the desktop or web client does not start that backend. Configure alternative service addresses in `.env.local` or the client's connection settings. Saved settings take precedence over environment defaults. See the [service configuration guide](docs/SERVICE_CONFIGURATION.md) for API, signaling, HTTPS, and TURN settings.

On macOS, the development script compiles the Swift window helper and creates a separately identified, locally signed Electron application:

```text
.local/electron-dev/Electron.app
name: PalmDesk Local <id> Dev
bundle ID: io.github.abreto.palmdesk.local.<id>.dev
```

Grant **Screen Recording** and **Accessibility** permissions to the current checkout's development app in macOS System Settings (`PalmDesk Local <id> Dev`, or `PalmDesk WT <id> Dev` for a linked worktree):

- Screen Recording is required to view a window that is available for capture on the current desktop.
- Accessibility is required to switch Spaces, restore windows, and send input. Automatic window activation needs this permission even in read-only mode.

You may need to restart the application after granting Screen Recording access. See [Application Identity and Permissions](#macos-application-identity-and-permissions) for worktree builds, migration, and permission recovery.

### Open the Web Client

For browser-only development:

```bash
pnpm dev:web
```

The default URL is `http://localhost:5173/`. Vite proxies `/api` and `/socket.io` to the local backend on port `4300`. If the port is occupied, use the URL printed in the terminal.

For temporary testing from a phone on the same local network:

```bash
pnpm dev:web:lan
```

Open the computer's reachable LAN IP and Vite port on the phone. `localhost` on a phone refers to the phone itself. Use HTTPS for deployed mobile access and in-page camera scanning; on LAN HTTP, use the system camera to open a connection link or select a QR-code image in the web client.

### Connect and Select a Window

1. Install a supported Agent on the computer, or open another application window you want to control. Agent windows can be on any macOS Space, or on the current Windows virtual desktop.
2. Open the PalmDesk web client on your phone. The desktop and web clients must both use this version and connect to the same backend.
3. Enter the device code and password displayed by the desktop client, or use its QR code.
4. After authentication, session reading opens if enabled on the host. To control a window, switch to **窗口** (Window) and select it from the Agent directory. If the Agent is not open, choose **打开 Agent**, then select an installed application. When reading is disabled or unsupported, the directory opens by default. The host activates the selected window and starts capture once it is available.

Both connection entry points start with **Balanced** (均衡): up to **2160p, 20 fps, and a 3000 kbit/s (3 Mbps) bitrate ceiling**, with text detail prioritized. Balanced reduces the previous frame rate and bitrate ceiling while retaining the 3840×2160 capture limit to protect Retina text and pinch-to-zoom readability. Capture preserves the window's aspect ratio and never enlarges small or portrait windows; scrolling may be less smooth on constrained connections.

Choose **High detail** (高细节) for the previous 2160p / 30 fps / 8000 kbit/s settings, or **Low data** (省流量) for 1080p / 10 fps / 1000 kbit/s, which can blur small text. You can override resolution, frame rate, bitrate, and content hint individually. Explicit choices are saved locally in the browser or desktop client and reused across reconnects. Bitrate is a ceiling, not a fixed sending rate or a traffic allowance; actual use depends on screen changes and network conditions. Reading sessions or backgrounding the controller still suspends inactive window video. These presets are starting policies, not measured mobile optima; physical-phone validation is tracked in the [quality validation guide](docs/VIDEO_QUALITY.md).

Pinch with two fingers inside the window view to zoom from fit to 300%, centered on the gesture. Move both fingers to pan; after lifting one finger, the remaining finger can keep panning until lifted. These gestures move only the local video view, leaving the toolbar and text composer in place. For one-finger panning, select **移动画面** (Pan) or **仅观看** (Watch only); other touch modes retain remote control. The zoom selector shows the current scale; choose **适合** (Fit) to reset the view.

To enable QR connections, configure the phone-accessible web client homepage in the desktop's QR connection area, then choose “显示二维码” (Show QR code). The device password and QR code start concealed on every launch and have independent Show/Hide controls. Scan with the web client's scanner, the system camera, or WeChat. The code includes the device code and password. Device passwords are permanent: the desktop offers no password rotation, so links stay valid until the device is reset. See [QR connection configuration](docs/SERVICE_CONFIGURATION.md#扫码连接) for URL requirements, HTTPS, and WeChat compatibility.

### Cloned Windows hosts and `--print-link`

Hosts cloned from one Windows image would otherwise share the template's device code and password. On Alibaba Cloud ECS, PalmDesk reads the instance ID from `http://100.100.100.200/latest/meta-data/instance-id` at startup and records which instance owns the cached credentials. When the ID differs, or credentials predate this check, the host discards them and requests a new device from the backend. If the metadata service does not answer within about a minute and the profile has previously recorded an instance ID, PalmDesk does not go online with the cached credentials and keeps retrying. Hosts without the metadata service, such as local or non-cloud machines, keep their existing credentials.

Once signed in, a Windows host writes its connection link to `C:\ProgramData\PalmDesk\connection.json` (`instanceId`, `device`, `password`, `url`, `updatedAt`), using the configured phone web client homepage. External tooling can then run the following remotely, for example through Cloud Assistant. Adjust the path to match your installation; `C:\app_manager\PalmDesk` is the default used by `scripts/windows/setup-unattended-host.ps1`:

```powershell
& "C:\app_manager\PalmDesk\PalmDesk.exe" --print-link              # one line: the connection URL
& "C:\app_manager\PalmDesk\PalmDesk.exe" --print-link --json       # full record
& "C:\app_manager\PalmDesk\PalmDesk.exe" --print-link --timeout=30 --output=C:\temp\link.txt
```

`--print-link` opens no window and leaves the running instance untouched. It only prints a record whose instance ID matches the current machine, waiting up to `--timeout` seconds (default 60). Exit codes: `0` success, `1` invalid arguments or unsupported platform, `2` link not yet published, `3` record belongs to another instance, `4` instance ID unavailable. PalmDesk is a GUI-subsystem program, so capture its output through redirection, a pipe, or `--output`. An interactive console may show nothing. The file uses default ProgramData permissions and contains the plaintext password; restrict access if the machine has other users. macOS hosts do not publish this file.

### Open an Agent from your phone

The Agent directory offers **打开 Agent** (Open Agent) both when empty and when other Agents are open. It lists installed Codex, Claude, ChatGPT, Kimi and ZCode applications supported by the host. Selecting an app with existing native windows uses the normal window picker; otherwise PalmDesk explicitly launches or reopens it, refreshes the directory, and waits briefly for a window. Manually linked terminals remain accessible from the directory and do not prevent launching the desktop app. A single matching window enters the normal capture flow; multiple windows require selection. Apps can refuse to create a window: errors and timeouts retain refresh/retry and other-application access.

Installed-app discovery runs independently of the window list, so existing windows remain selectable while it loads. The installed list is cached for 30 seconds; newly installed apps may take that long to appear after refreshing. Every explicit launch checks the installation again.

macOS resolves installed `.app` bundles through Launch Services and sends the normal application open/reopen request. Windows discovers known executable names from the current user's installed MSIX packages and Windows App Paths registrations, launching packaged apps through their registered application ID. Unregistered portable/custom installations and CLI agents are not launch targets; open those on the computer first. Windows window selection remains limited to the current virtual desktop. Unsupported hosts and older PalmDesk versions explain why launching is unavailable. Update both host and controller.

Launch requests use the authenticated connection and a known Agent ID; paths and launch arguments are resolved only on the host. No apps are installed, prompts submitted, or tasks orchestrated. Disconnecting prevents pending launch work where it has not reached the operating system; an app already opened stays open. Reconnecting, switching to Read, or backgrounding the controller never replays the launch. Capture and input still require the existing permissions and native window identity checks. See the [launch validation record](docs/smoke-artifacts/agent-launch-2026-10-02.md) for tested behavior and remaining real-device checks.

## Window Selection and Session Behavior

Window lists and session content travel over the authenticated connection's WebRTC DataChannels; the backend handles device authentication, signaling and TURN credentials. Self-hosting requires the PalmDesk-compatible backend described in the [container guide](containers/README.md). The window list includes regular application windows across the current user's macOS Spaces, or on the current Windows virtual desktop, and excludes PalmDesk itself, desktop elements, and entire displays.

Windows on other Spaces, hidden windows, and minimized windows are marked as not visible on the current desktop. They remain selectable and may have thumbnails. On macOS 14 and later, ScreenCaptureKit fills in missing Electron previews using single-window snapshots without activating the window or switching Spaces. If the system cannot provide a preview, the selectable entry remains.

Selecting a window activates it and, on macOS, switches Spaces as needed. If it is minimized, only the selected window is restored. Capture starts only when that window appears in the capture source list. Selection fails if the system or application rejects activation or the target cannot be uniquely identified.

Refreshing the list does not switch Spaces. If the selected window closes, leaves the capturable desktop, or changes identity, the session ends. PalmDesk does not automatically select another window. Use the controller's disconnect-and-reselect action to fetch a new list while keeping the device connection details.

### macOS Implementation Limits

macOS Accessibility APIs may omit windows on other Spaces. When necessary, cross-Space activation dynamically uses private SkyLight APIs to identify Space membership, selects the target Space through Mission Control, and verifies visibility, identity, and focus. The host briefly displays Mission Control during this process.

Native Accessibility window IDs distinguish windows with identical titles and sizes. If those APIs are unavailable, PalmDesk accepts only a unique title-and-bounds match. These APIs depend on the macOS version; selection stops with an error if validation cannot complete. Invisible, untitled windows without Accessibility information are filtered out.

System input depends on foreground focus. Concurrent local use or system shortcuts can still change that focus.

## macOS Application Identity and Permissions

All local builds use an identity specific to their checkout. The main workspace and ordinary clones use `PalmDesk Local <id> Dev` with bundle ID `io.github.abreto.palmdesk.local.<id>.dev` for development. Linked worktrees use `PalmDesk WT <id> Dev` and `io.github.abreto.palmdesk.worktree.<id>.dev`. Local packaged builds omit ` Dev` and `.dev`; only explicit `--release` builds use `PalmDesk` and `io.github.abreto.palmdesk`. Each identity has separate permissions and configuration. See the [application identity guide](docs/LOCAL_DEVELOPMENT.md#应用身份) for details and migration from older builds.

Use `pnpm doctor:desktop` to check for older builds with conflicting identities. The macOS startup check also detects multiple registered copies of the same identity and reports their paths before exiting. Keep one runnable installation per identity; renaming an old `.app` alone does not remove the conflict.

Starting with v0.0.3, macOS previews use a fixed self-signed certificate and a stable native helper signing identifier. Release builds fail if that certificate is missing or mismatched; ordinary local builds can still use ad-hoc signing. Self-signing does not replace Developer ID signing or notarization. See the [signing setup](docs/DESKTOP_RELEASES.md#固定-macos-签名).

Rebuilding an ad-hoc signed application can invalidate existing permissions. Check both Accessibility and Screen Recording, then fully quit and restart PalmDesk after changing permissions. Closing the window or refreshing the window list may leave the old process and its permission state running. If access still fails, remove the old entry from the relevant permission list, add and authorize the current application bundle for that identity, then fully quit and restart again.

When migrating from the former Codex Remote development build, the application identity and local data directory have changed. Grant permissions again and reconfigure the connection services.

## Build and Test

Run the source checks and web build:

```bash
pnpm test:smoke
pnpm typecheck
pnpm build:prod
```

Build the native helper and desktop application on macOS or Windows:

```bash
pnpm build:native
pnpm build:desktop
```

`build:native` and `build:desktop` select the current host platform. Local desktop artifacts are written to `electron-release/<version>/local-<id>/`, or `electron-release/<version>/worktree-<id>/` for linked worktrees; Windows executables are under `win-unpacked/`. On Windows, `pnpm build:desktop:win` explicitly builds the Windows version. These commands do not publish a GitHub Release. Stable distribution still requires resolving dependency warnings, confirming icon provenance and third-party licenses, macOS Developer ID signing and notarization, and Windows code signing.

Use `pnpm dist:mac` on an Apple Silicon Mac or `pnpm dist:win` on Windows to create a local installer. Local builds isolate each checkout's app identity, permissions and data from the release; add `--release` only when preparing an installer with the fixed release identity. The manually triggered **Desktop Prerelease** workflow builds Apple Silicon Mac and Windows x64 installers and publishes them together as a GitHub Prerelease with SHA256 checksums. Intel Mac installers are not currently supported. These test packages are not distribution-signed or notarized. See [desktop releases](docs/DESKTOP_RELEASES.md) for version rules, triggering the workflow and installation limits.

`pnpm test:smoke` includes the session-reader tests; use `pnpm test:session-core` to run only the parser and reading-module tests. The [session reading guide](docs/GLASSLINE_INTEGRATION.md#验证) also provides a browser fixture for checking mixed session sources, pagination, updates and switching views over real WebRTC with synthetic content.

With the backend running, run the signaling integration test:

```bash
node --test test/smoke/signaling.test.mjs
```

GitHub Actions runs unit tests, type checking, and the web build on Linux, macOS, and Windows, plus native helper compilation on macOS and Windows. It does not cover live remote control or public deployment. Additional browser and Electron smoke-test setup is documented in the [development guide](docs/LOCAL_DEVELOPMENT.md).

GitHub Actions in the main repository can build the web client and the backend with its deployment adapter as Docker images and publish them to GHCR. See [Container Images](containers/README.md) for image names, the pinned backend version, and build instructions. Production credentials, databases, and the tunnel are managed by the deployment environment.

### Validation Coverage

The separate browser integration smoke tests exercise real Vue pages, a running backend, Socket.IO, WebRTC video decoding, and the input DataChannel. Native video sources and system input use test doubles in those tests. They require the setup in the [development guide](docs/LOCAL_DEVELOPMENT.md#浏览器与-electron-烟测) and are not run by `pnpm test:smoke` or the source-check CI. Historical results are in the [validation report](docs/CODEX_REMOTE_REPAIR_RESULTS.md); references to Codex Remote in reports and screenshots use the project's former name.

Separate Windows native tests verify real window capture and input. The [public backend verification](docs/smoke-artifacts/public-backend-2026-09-08.md) records a packaged Windows host with real WGC video and Win32 input, followed by user-confirmed testing from a physical phone. Cross-network TURN behavior remains unverified.

Window-picker smoke tests cover deferred capture, selection across applications, search and refresh, permission errors, empty lists, windows closing before selection, disconnecting and reselecting, video pixel checks, and mobile portrait and landscape layouts. Unit tests cover selection identifier isolation, invalid identifiers, and window identity checks before capture.

The native macOS Spaces smoke test creates two temporary windows and verifies switching between regular and full-screen Spaces, restoring minimized windows, exact focus, and captured thumbnail pixels. It briefly switches the host's desktop and closes the temporary windows afterward. Prepare the development application and native helper first:

```bash
node scripts/dev.mjs --prepare-only
```

Grant that checkout's development app Screen Recording and Accessibility permissions, then run:

```bash
.local/electron-dev/Electron.app/Contents/MacOS/Electron test/smoke/native-window-spaces.cjs
```

Set `SMOKE_PREVIEWS_ONLY=true` to check only previews from other Spaces and content refresh, including that the desktop and focus remain unchanged during snapshots.

### Remaining Work

- Complete end-to-end acceptance of real window video streams and system input, including permission recovery.
- Validate on physical iOS Safari devices and across NAT / TURN connections.
- Save the selected target for direct access on the next connection.
- Preserve reading state across browser reloads or discarded tabs; automatic recovery currently retains state only in the same live page.

## Documentation

The detailed guides are currently in Chinese.

| Guide                                                    | Contents                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Chinese README](README.zh-CN.md)                        | Chinese project overview and usage instructions                                                |
| [Use cases](docs/USE_CASES.md)                           | Product positioning, pain points, and agent workflows                                          |
| [Local development](docs/LOCAL_DEVELOPMENT.md)           | Backend setup, browser and Electron smoke tests, application identity, and permission recovery |
| [Service configuration](docs/SERVICE_CONFIGURATION.md)   | API and signaling addresses, QR connections, HTTPS deployment, and TURN                        |
| [Server deployment & testbed](docs/DEPLOYMENT.md)        | Docker compose setup, database init, Nginx proxy, and ssh-hk test environment                  |
| [Desktop releases](docs/DESKTOP_RELEASES.md)             | Preview installers, signing, version rules and release workflow                                |
| [Session reading](docs/GLASSLINE_INTEGRATION.md)         | Supported sources, reading limits, window associations and test setup                          |
| [Stream mode](docs/STREAM_MODE.md)                       | Single-window capture, text-first encoding, Rust evaluation & unattended Windows (RDP) fixes |
| [Unattended Windows host](docs/WINDOWS_UNATTENDED_HOST.md) | New-machine runbook (Chinese): auto-logon, autostart, keep capture working after RDP closes, virtual display |
| [Agent detection](docs/AGENT_DETECTION.md)               | Native window matching, app discovery, and session discovery                                   |
| [Container images](containers/README.md)                 | Web and backend images, pinned backend source and deployment adapter                           |
| [TURN testing](docs/TURN_TESTING.md)                     | Forced-relay and credential-renewal verification                                               |
| [Validation report](docs/CODEX_REMOTE_REPAIR_RESULTS.md) | Historical test results and remaining acceptance work                                          |
| [Open-source readiness](docs/OPEN_SOURCE_READINESS.md)   | Historical dependency audit and release prerequisites                                          |

## Contributing and License

Report bugs and suggestions through [PalmDesk Issues](https://github.com/Abreto/palmdesk/issues) and read the [contributing guide](.github/CONTRIBUTING.md). For security reports, follow [SECURITY.md](SECURITY.md). Do not publish device passwords, TURN credentials, or window screenshots containing sensitive information.

PalmDesk uses the [MIT license](LICENSE.txt), retaining upstream shuisheng's copyright notice and adding attribution to Abreto. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream attribution and dependency notices.

The preserved [upstream open-source README](README_OpenSource.md) describes upstream products, services, and Pro features; those are not PalmDesk's feature set. PalmDesk is an independent project and is not affiliated with OpenAI, Anthropic, or the BilldDesk maintainers.
