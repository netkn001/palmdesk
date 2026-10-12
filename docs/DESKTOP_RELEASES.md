# 桌面安装包与预发布

当前发行流程用于测试版：从 v0.0.3 起，macOS 使用固定自签名证书，不包含 Developer ID 签名和 Apple 公证；Windows 安装包未签名。系统可能提示或阻止打开。自动更新和真实远控验收不包含在此流程中。

当前使用 `0.0.x` 迭代 Preview；`0.1.0` 保留给完成打磨、可正式分发的里程碑。

## 手动触发 GitHub Actions

1. 将待发布代码及工作流合并到 `main`，确认 `package.json` 中的版本号。
2. 打开仓库 **Actions → Desktop Prerelease → Run workflow**。
3. 选择 `main`，输入与版本号完全对应的标签，例如版本 `0.0.3` 输入 `v0.0.3`，然后运行。
4. 等待两个平台的测试、编译和打包全部成功。最后一个任务会创建公开的 GitHub Prerelease，上传两个安装包及 `SHA256SUMS.txt`，并在运行摘要提供下载页面链接。

也可通过 GitHub CLI 手动触发：

```bash
gh workflow run desktop-release.yml --repo Abreto/palmdesk --ref main -f tag=v0.0.3
```

| 平台                | Runner         | 安装包                               |
| ------------------- | -------------- | ------------------------------------ |
| macOS Apple Silicon | `macos-15`     | `PalmDesk-<version>-mac-arm64.dmg`   |
| Windows x64         | `windows-2022` | `PalmDesk-<version>-windows-x64.exe` |

当前预发布仅支持 Apple Silicon Mac 和 Windows x64，不提供 Intel Mac 安装包。Mac 包在 macOS 15 构建，较早系统尚未验收。Windows 运行时要求 Windows 10 1903 及以上或 Windows 11 x64，并具有可用的 Windows Graphics Capture。

普通 push 和 pull request 不触发此发布流程。工作流固定构建触发时的提交；输入标签必须匹配该提交的版本，已有标签必须指向同一提交。标签不存在时，发布步骤为该提交创建标签。已存在的 Release 不覆盖；发布阶段失败若留下草稿，需先检查和处理该草稿再重跑，或者使用新版本。

构建任务仅有仓库读取权限，发布任务使用 `contents: write` 的内置 `GITHUB_TOKEN`，不需要额外 PAT。macOS 签名需要下面两项 Actions Secrets。所有构建成功后才进入发布任务；临时安装包也会在 Actions Artifacts 中保留 14 天。预发布不会标记为 Latest。

发布前会检查两份安装包的名称、版本和非空文件状态，并生成 SHA256 校验和。macOS 还校验主程序及 Swift 辅助程序架构、签名完整性、主应用及各辅助进程的固定证书和稳定 designated requirement；Windows 检查原生辅助程序已包含在包内。签名烟测会编译并签署两个内容不同的测试应用，验证新版主程序和原生辅助程序仍满足旧版签名身份。

## 固定 macOS 签名

`build/macos-signing.json` 只保存公开证书名称及 SHA-1 / SHA-256 指纹。正式身份的 `--release` 构建必须使用这一证书，不允许退回 ad-hoc 或自动选择其他证书。原生窗口辅助程序固定使用 `<应用 bundle ID>.window-helper`，避免编译器生成的 UUID 改变签名标识。

在仓库 Actions Secrets 中配置：

| Secret                      | 内容                                         |
| --------------------------- | -------------------------------------------- |
| `PALMDESK_SIGNING_P12`      | 含原始证书和私钥的 `.p12` 文件的 Base64 编码 |
| `PALMDESK_SIGNING_PASSWORD` | `.p12` 导出密码                              |

Base64 只是编码，必须存为 Secret。原始 `.p12`、密码和到期日保存在 1Password；不要提交私钥或密码。换构建机时恢复原证书，不重新生成同名证书。若确需更换证书，同时更新固定指纹并说明用户可能需要重新授权。

工作流仅在 macOS 源码检查通过后读取 Secrets，导入随机密码保护的临时钥匙串，只信任该证书的代码签名用途。CI 仅支持一次性 GitHub 托管 runner：通过非交互管理员命令配置公开证书信任，随虚拟机销毁清除，避免 macOS 移除信任时等待 GUI 授权。签名结束或构建失败后，清理步骤恢复钥匙串搜索列表、删除含私钥的临时钥匙串和文件；自托管 runner 会在导入前被拒绝。证书与密码不进入构建产物，也不提供给 Windows 构建。

本机发布构建前，将同一证书及私钥导入钥匙串，并在证书信任设置中允许代码签名。`pnpm dist:mac --release` 会按固定指纹选取它；使用独立钥匙串时可指定 `CSC_KEYCHAIN`。自签名不使用 Apple 团队标识自动填充、公证或时间戳服务。

从 v0.0.2 及更早 ad-hoc 版本升级到固定证书时，可能需要重新授予屏幕录制及辅助功能权限一次。后续签名身份保持稳定，但 CI 校验不能替代真实 macOS 升级授权测试。自签名仍不满足 Gatekeeper 的 Developer ID 和公证要求。

## 本地构建

开发机需要 Node.js 22.16.0 及以上、pnpm 11.19.0。macOS 需要 Xcode Command Line Tools，Windows 使用系统 .NET Framework 4.x 编译器。正常安装依赖，不使用源码检查流水线的 `--ignore-scripts`，以便下载 Electron 并准备运行依赖。

```bash
pnpm install --frozen-lockfile
pnpm dist:mac --release
```

Windows PowerShell：

```powershell
pnpm install --frozen-lockfile
pnpm dist:win --release
```

命令会先构建桌面页面与 Electron 主进程，再编译原生辅助程序并生成安装包，本地构建不会上传 GitHub。macOS 请在 Apple Silicon Mac 上构建；Intel Mac 安装包暂不支持。Windows 输出 x64 安装包。

`--release` 显式选择固定的正式身份 `io.github.abreto.palmdesk`（PalmDesk），产物位于 `electron-release/<version>/`；从主工作区、clone 或 linked worktree 执行结果一致。GitHub Actions 同样显式传入该参数，并检查 macOS 包的正式 bundle ID。

本地开发测试请省略 `--release`。`pnpm dist:mac`、`pnpm dist:win` 和 `pnpm build:desktop` 默认使用当前工作区独立的应用名称及 bundle ID：主工作区或普通 clone 的产物位于 `electron-release/<version>/local-<id>/`，linked worktree 位于 `electron-release/<version>/worktree-<id>/`，权限及配置与正式版隔离。`build:desktop` 和 `build:desktop:win` 只生成本地应用目录。身份规则及旧开发包的迁移步骤见 [本地开发](LOCAL_DEVELOPMENT.md#应用身份)。

## 用户安装与后续发行

用户打开 DMG 并将应用拖入 Applications，或运行 Windows 安装向导，无需安装 Node.js、pnpm 或开发工具。macOS 远控需要屏幕录制和辅助功能权限。默认连接 `https://palmdesk-hk-test.ziniaocloud.com`；手机网页和桌面端必须使用同一服务，安装包不包含服务端。

CI 的源码检查和打包验证不能替代真实屏幕捕获、键鼠输入、权限恢复、手机及跨网络 TURN 验收。稳定分发前继续处理 [发行前提](OPEN_SOURCE_READINESS.md)，并接入 macOS Developer ID 签名与公证及 Windows 代码签名。证书和私钥只通过 CI 的安全配置提供，不写入仓库或 `VITE_*` 变量。
