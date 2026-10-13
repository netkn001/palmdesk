# ADR 0004: Windows 多用户设备唯一标识与凭据隔离 (Windows Multi-User Host Identity & Credential Isolation)

* **状态 (Status)**: 已接受 (Accepted)
* **日期 (Date)**: 2026-10-13
* **领域 (Domain)**: 主机身份标识 (Host Identity) / 多用户隔离 (Multi-User Isolation) / 无人值守运维 (Unattended Operations)
* **关联 (Related)**: [Windows 无人值守主机部署手册](../WINDOWS_UNATTENDED_HOST.md), [ADR 0001](0001-session-reader-modernization.md)

---

## 1. 背景与上下文 (Context)

PalmDesk 面向 **AI-native remote control** 与 **agent-ready workflows**，支持 Windows 云主机（如阿里云 ECS）从镜像模版批量克隆部署，并通过 `PalmDesk.exe --print-link` 配合自动化运维工具（如云助手）实现无人值守连接。

在此前的实现中：
1. **云实例设备标识未区分系统用户**：主机启动时通过网络请求查询云元数据服务（`http://100.100.100.200/latest/meta-data/instance-id`）获取 `instanceId`。但在 Windows 多用户会话环境（如 Windows Server 多用户登录、切换本地账号或多用户克隆 Profile）中，所有用户获取到的云实例 ID 完全相同。这导致凭据判定逻辑将不同系统用户误判为同一设备，引发设备代码（`deskUserUuid`）和连接密码复用冲突，在信令服务端相互顶号。
2. **连接凭据全局文件相互覆盖**：连接信息以往统一写入全局路径 `C:\ProgramData\PalmDesk\connection.json`。多用户先后启动 PalmDesk 时，后启动的用户会直接覆盖该文件。
3. **外部脚本无法指定用户**：`--print-link` 依赖单一全局文件，无法区分并输出指定 Windows 用户的连接凭据。

---

## 2. 决策记录 (Decisions)

经与产品与运维场景对齐，确定以下技术决策：

### 2.1 平台作用域限制
* **仅限 Windows 生效**：本多用户拼接与用户目录存储逻辑严格限制在 Windows 平台（`process.platform === 'win32'`），macOS / Linux 等其他平台保持现有行为不变。

### 2.2 复合设备标识 (`<instanceId>_<username>`)
* **网络云实例标识拼接**：在 Windows 平台下，当且仅当成功通过网络获取到云实例 ID（`instanceId`）时，读取当前 Windows 用户名（`process.env.USERNAME || os.userInfo().username`），组合为 `<instanceId>_<sanitized_username>`。
* **非云环境平滑保持**：若网络请求未能获取到云实例 ID（例如本地物理机、脱机环境或本地开发调试），唯一标识保持为空字符串 `''`，不改变现有非云环境的设备凭据复用与判断逻辑。
* **用户名字符清洗与 ASCII 规范**：
  * 保留英文字母、数字及 `._-`；
  * 中文、空格、斜杠等非标准字符统一转换为安全字符，并在含有特殊字符时附加基于完整用户名的短哈希（如 6 位短哈希），避免同名与拼音碰撞；
  * 确保复合标识严格落在 `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` 安全字符集范围内，保证网络传输与文件命名兼容性。

### 2.3 用户级配置文件隔离 (`~/.palmdesk/`)
* **存储路径迁移至用户根目录**：将 Windows 平台的连接凭据文件写入当前登录用户的根目录 `~/.palmdesk/connection.json`（即 `C:\Users\<username>\.palmdesk\connection.json`）。
* **天然隔离与权限安全**：利用 Windows 用户主目录的 ACL 权限控制，避免以往 `ProgramData` 下明文密码被单机其他非提权用户随意读取，同时杜绝多用户启动相互覆盖。
* **存量文件兼容**：新版本启动时不主动删除旧的 `C:\ProgramData\PalmDesk\connection.json` 全局文件，避免破坏单机外部已有脚本的旧硬编码依赖，但内部逻辑全面重定向至用户目录。

### 2.4 `--print-link` 多用户命令行扩展
* **默认行为**：默认读取当前命令执行上下文所在用户的 `~/.palmdesk/connection.json`。
* **指定用户参数 `--user=<username>`**：支持可选参数 `--user=<username>`。当管理员或以 `SYSTEM` 权限运行的云助手远程执行时，可显式指定目标 Windows 用户账号，从 `C:\Users\<username>\.palmdesk\connection.json` 读取并校验匹配该用户的复合实例标识。

---

## 3. 影响与收益 (Consequences)

### 正向影响 (Positive)
* **解决多用户串号与互斥问题**：同一物理机/虚拟机上的多个 Windows 用户各拥有独立的设备唯一标识和设备代码，互不干扰。
* **收紧凭据安全边界**：连接信息由全局共享目录收归至用户私有目录，避免跨用户明文泄露。
* **运维脚本精准可控**：云助手及自动化运维支持通过 `--user` 获取指定账号下的连接 URL。

### 代价与权衡 (Trade-offs & Mitigations)
* **存量云主机凭据更新**：升级新版本后，由于 `recordedInstanceId` 由单纯的 `i-xxx` 变为 `i-xxx_<user>`，实例判定会自动触发一次 `recreate`，重新注册一对专属设备凭据并刷新 `~/.palmdesk/connection.json`，确保彻底解耦旧冲突。
* **运维脚本参数调整**：若云助手以往以 SYSTEM 身份执行 `--print-link` 依赖全局 `ProgramData`，需在自动化命令中补充 `--user=<用户名>` 参数以指向具体桌面用户。
