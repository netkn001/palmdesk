# ADR 0001: PalmDesk 客户端 Rust 渐进式改造与打包架构方案

- **状态**: Accepted (已通过)
- **日期**: 2026-10-09
- **决策人**: PalmDesk Core Team
- **技术领域**: Desktop Client, Native Modules, Build & Packaging

---

## 1. 背景与问题描述 (Context)

PalmDesk 作为面向 Agent-ready 工作流的 AI 原生远程控制应用，目前客户端基于 **Electron 33 + Node.js 22 + Vue 3** 架构。随着功能演进，客户端暴露出以下技术挑战与维护痛点：

1. **跨平台原生辅助程序语言割裂**：
   - macOS 端采用 Swift (`electron-main/native/codex-window.swift`)，依赖 `xcrun swiftc`。
   - Windows 端采用 C# (`electron-main/native/palmdesk-window.cs`)，依赖系统 `.NET Framework csc.exe` 动态编译。
   - 双语言并存导致双端特性对齐困难、维护成本高，且无法方便地向 Linux (X11/Wayland) 扩展。
2. **AI 会话大日志解析性能与 GC 压力**：
   - 会话阅读引擎 (`session-core/`) 采用纯 TypeScript 实现，单文件最大需解析 32MiB 的 Codex / Claude JSONL 与 Markdown 标记。在 Node.js 主进程中高频切分字符串与反序列化引发了显著的内存占用波动与 V8 垃圾回收（GC）顿卡。
3. **模拟输入底层库笨重脆弱**：
   - 依赖 `@nut-tree-fork/nut-js` 及其底层 C++ 预编译组件，安装包尺寸大、跨平台编译环境脆弱，且与不同版本的 Electron ABI 兼容风险高。
4. **视频捕获与推流现有优势**：
   - Chromium 渲染进程的 `desktopCapturer` 与 WebRTC 栈在硬件编解码与多网络适应性上高度成熟稳定，全量重构成本与风险极高。

---

## 2. 架构决策 (Decision)

我们决定采用 **渐进式混合改造（Progressive Hybrid Architecture）**，在保持 Electron 外壳与 Chromium WebRTC 视频流优势的同时，将底层系统交互、日志解析与硬件输入逐步用 **Rust** 重构。

### 2.1 集成与通信模式 (Hybrid Integration)
- **Native Window 辅助程序**：保持为**独立 Rust CLI 二进制进程 (`palmdesk-native`)**。
  - 通过 `stdio` JSON-RPC 协议与 Electron 主进程的 `NativeWindowBridge` 通信。
  - 核心考量：macOS 辅助功能 (Accessibility) / 录屏权限与 Windows DWM 调用的异常崩溃隔离，避免阻塞 Electron 主事件循环。
- **Session-Core 与 Input 模块**：采用 **`napi-rs` 原生 Node.js 模块**。
  - 编译为 `.node` 动态扩展，在 Electron 主进程中以纳秒级开销直接函数调用。
  - 会话日志解析采用 `memmap2` 零拷贝内存映射与 `serde_json` 极速流式解析，彻底消除 GC 压力。

### 2.2 代码组织模式 (Cargo Workspace Monorepo)
在仓库根目录下设立 `crates/` 作为统一的 Cargo Workspace：
```text
palmdesk/
├── crates/
│   ├── Cargo.toml                      # Workspace 配置
│   ├── palmdesk-native/                # 独立 CLI: 原生窗口发现/激活/Spaces/缩略图
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs
│   │       ├── macos/
│   │       ├── windows/
│   │       └── common/
│   ├── palmdesk-session-core/          # NAPI-RS: 高性能会话解析引擎
│   │   ├── Cargo.toml
│   │   └── src/
│   └── palmdesk-input/                 # NAPI-RS: 原生鼠标/键盘/剪贴板控制
│       ├── Cargo.toml
│       └── src/
├── native-bin/                         # 存放编译出的独立二进制
│   └── codex-window / palmdesk-window.exe
```

### 2.3 构建与打包流程 (Build & Packaging Pipeline)
- **本地开发**：
  - 更新 `scripts/build-native.mjs`，由其统一驱动 `cargo build --release` 与 `napi build --platform`，将编译产物输出至 `native-bin/` 和对应 node 模块路径。
  - `pnpm dev:desktop` / `pnpm build:desktop` 自动执行 `build:native` 前置检测。
- **安装包分发 (`electron-builder.cjs`)**：
  - 独立 CLI 产物通过 `mac.extraFiles` (打包入 `MacOS/codex-window`) 和 `win.extraResources` (打包入 `native/palmdesk-window.exe`) 注入。
  - NAPI 产物配置 `asarUnpack: ["**/*.node"]`，确保 Electron 动态链接器直接加载。
  - macOS 延续自签名与硬化运行时（Hardened Runtime）签名校验；Windows NSIS 安装包打包 x64 架构。

### 2.4 平台支持范围
- **Phase 1~3** 首发保证 **macOS (arm64 & x64)** 与 **Windows (x64)** 100% 对齐现有特性与稳定性。
- 底层抽象操作系统特征 trait (`WindowManager`, `InputDriver`)，预留 Linux (X11 / Wayland Portal) 扩展槽位。

---

## 3. 落地实施路线图 (Implementation Roadmap)

1. **Phase 1: Native 窗口服务统一化 (palmdesk-native)**
   - 目标：干掉 Swift 与 C# 编译器依赖，实现跨平台单个 Rust 窗口管理 CLI。
   - 实现 `list`、`focus`、`thumbnails`、`text`、`space`、`bounds` 等完整 JSON-RPC 指令。
   - 对接 `electron-main/native-window.ts`，验证完全无缝兼容。
2. **Phase 2: Session-Core NAPI 重构 (palmdesk-session-core)**
   - 目标：将 TypeScript 版本的 32MB 日志解析迁移至 Rust。
   - 跑通 `session-core/test/*.test.mjs` 现有全套自动化测试，确保格式 100% 兼容。
3. **Phase 3: 模拟输入与剪贴板控制 (palmdesk-input)**
   - 目标：剥离 `@nut-tree-fork/nut-js`。
   - 实现跨平台鼠标移动、点击、滚轮、按键与剪贴板图像注入。

---

## 4. 影响与收益评估 (Consequences)

### 正向影响 (Positive)
- **消除技术栈碎片**：原生层统一使用 Rust，不再需要 macOS 的 Swift 工具链与 Windows 的 .NET csc.exe 探测。
- **极限性能与稳定性**：会话日志读取吞吐量提升 10 倍以上，主进程无 GC 顿卡。
- **安装包与构建纯净化**：去除 nut-js 及其庞大预构建 C++ 二进制，降低 node-gyp 兼容风险。

### 潜在风险与缓解对策 (Risks & Mitigation)
- **环境依赖**：开发者与打包机器需安装 Rust 工具链。缓解策略：在 CI 流水线中引入跨平台预构建与构建缓存机制。
- **系统权限继承**：macOS 下辅助进程需要正确的 bundle/签名以正常使用 Accessibility 与 ScreenCaptureKit。缓解策略：保持继承并复用现有 `scripts/sign-macos.cjs` 签名流程。

---

## 5. 当前实施状态 (Implementation Status)

- [x] **Phase 1: Native 窗口服务统一化 (`crates/palmdesk-native`)**：已完成。实现跨平台 stdio JSON-RPC 原生窗口通信协议，全面支持窗口发现、激活、空间切换与缩略图采集，无缝接入 `NativeWindowBridge`。
- [x] **Phase 2: Session-Core NAPI 重构 (`crates/palmdesk-session-core`)**：已完成。基于 `napi-rs` + `memmap2` + `sha2` 实现零拷贝大日志极速读取，经 `test:session-core` 全套 83 项单元测试验证 100% 兼容。
- [x] **Phase 3: 模拟输入核心 (`crates/palmdesk-input`)**：已完成。基于 OS-native（macOS CGEvent / Windows SendInput）实现精确光标、连击、滚轮、按键与组合快捷键映射，接入 Electron `CaptureSession`，具备无缝运行时回退能力并通过 349 项 Smoke 测试。

