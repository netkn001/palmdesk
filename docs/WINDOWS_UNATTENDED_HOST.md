# Windows 无人值守主机部署手册

本文是在**新的 Windows 电脑**上部署 PalmDesk 被控端的操作清单，目标是：

- 开机后**无人登录**也能用手机通过 PalmDesk 操作；
- 用 RDP 维护后**直接点 `X` 关闭**，PalmDesk 仍可继续捕获窗口；
- 没接显示器时也有一块分辨率合适的屏幕。

原理和排查方法见 [流模式实现方案 · 第 5 节](STREAM_MODE.md#5-常见问题排查与无人值守-windowsrdp-断开--无显示器适配指南)。本文只讲怎么做。

> [!IMPORTANT]
> 这些步骤会让 Windows 开机后自动登录并保持桌面解锁。接在这台电脑上的显示器会直接显示桌面，只适合放在可信环境（机房、个人工位）中的机器。

---

## 0. 准备

| 项目 | 要求 |
| --- | --- |
| 系统 | Windows 10 / 11 x64（专业版及以上），或 Windows Server |
| 账号 | 一个本地管理员账号，PalmDesk 和 Agent 应用都运行在这个账号下 |
| 网络 | 若手机和电脑不在同一网络，服务端需已部署 TURN，见 [DEPLOYMENT.md](DEPLOYMENT.md) |
| 脚本 | 仓库中的 [`scripts/windows/setup-unattended-host.ps1`](../scripts/windows/setup-unattended-host.ps1) |

把下面两个目录**原样拷贝**到新机器（路径固定，脚本默认读取这两个位置）：

| 目录 | 内容 | 说明 |
| --- | --- | --- |
| `C:\app_manager\PalmDesk\` | PalmDesk 桌面客户端，至少包含 `PalmDesk.exe` 及其 `resources\` 等文件 | 免安装目录即可；也可用 `-PalmDeskDir` 指定其他位置 |
| `C:\VirtualDisplayDriver\` | `MttVDD.inf`、`MttVDD.dll`、`mttvdd.cat`、`Virtual_Display_Driver.cer`、`vdd_settings.xml` | 来自 [Virtual-Display-Driver Releases](https://github.com/VirtualDrivers/Virtual-Display-Driver/releases)。**必须是这个路径**：驱动源码写死只读取 `C:\VirtualDisplayDriver\vdd_settings.xml`，不能通过注册表修改 |

> [!NOTE]
> 虚拟显示器只解决“没有屏幕 / 分辨率太低”，**不能**解决 RDP 断开后的“窗口视频已结束”，后者靠脚本第 3 步的计划任务。电脑接了显示器或 HDMI 假负载、不想多一块屏时，可加 `-SkipVdd` 跳过，此时不需要准备 `C:\VirtualDisplayDriver\`。

---

## 1. 运行一键配置脚本

用**要自动登录的那个账号**登录新机器（本地或 RDP 均可），以**管理员身份**打开 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-unattended-host.ps1
```

脚本先检查两个目录是否齐全（缺文件会直接报错退出），然后提示输入该账号的密码，依次完成：

| 步骤 | 内容 | 作用 |
| --- | --- | --- |
| 1 | 写入 Winlogon 自动登录 | 开机即登录，PalmDesk 才能启动 |
| 2 | 在“启动”文件夹创建指向 `C:\app_manager\PalmDesk\PalmDesk.exe` 的快捷方式（已有指向 `PalmDesk.exe` 的自启项则跳过） | 登录后自动运行 PalmDesk |
| 3 | 创建 SYSTEM 计划任务 `PalmDesk\ReturnToConsole` | RDP 断开（事件 24）约 3 秒后执行 `tscon`，把会话交回物理控制台 |
| 4 | 交流电源下不睡眠、不关屏、不休眠 | 防止网络和信令断开 |
| 5 | 虚拟显示器：把目标分辨率设为 `vdd_settings.xml` 首选项 → 导入证书到“受信任的根”和“受信任的发布者” → 创建 `Root\MttVDD` 设备并安装驱动（已安装则重启驱动） → 每次登录时应用分辨率 | 无显示器时有一块 1920×1080 的屏幕 |
| 6 | PalmDesk 未运行时启动它 | — |

常用参数：

| 参数 | 说明 |
| --- | --- |
| `-UserName` / `-Password` | 自动登录账号，默认当前账号；不传密码会交互输入 |
| `-PalmDeskDir` | PalmDesk 目录，默认 `C:\app_manager\PalmDesk` |
| `-VddDir` | 驱动包目录，默认 `C:\VirtualDisplayDriver`（配置文件仍须在此路径才会被驱动读取，一般不要改） |
| `-VddWidth` / `-VddHeight` / `-VddRefresh` | 虚拟屏分辨率，默认 `1920` / `1080` / `60` |
| `-SkipAutoLogon` / `-SkipVdd` | 跳过对应步骤 |
| `-CheckOnly` | 只打印当前状态，不做修改 |
| `-Uninstall` | 撤销计划任务、启动项和自动登录（不卸载驱动） |

脚本可重复运行。自动登录密码以明文保存在注册表 `HKLM\...\Winlogon\DefaultPassword` 中；如介意，可加 `-SkipAutoLogon`，改用微软 [Sysinternals Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon)，它会把密码加密保存。

> [!TIP]
> 驱动安装或重启后，Windows 往往沿用旧分辨率，必须在**用户的控制台会话**内调用 `ChangeDisplaySettingsEx` 才能改过来；在 RDP 里看不到虚拟屏（“设置 ➔ 显示”会提示“无法从远程会话更改显示器设置”）。所以脚本生成 `C:\ProgramData\PalmDesk\vdd-setmode.ps1` 并放进“启动”文件夹，每次登录自动执行，结果记录在 `C:\ProgramData\PalmDesk\vdd-setmode.log`。设置会写入注册表 `HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers\Configuration`，同一套显示器组合重启后会自动沿用。

<details>
<summary>不用脚本，手动配置</summary>

```powershell
# 1. 自动登录
$p = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty $p AutoAdminLogon '1'
Set-ItemProperty $p DefaultUserName '<用户名>'
Set-ItemProperty $p DefaultPassword '<密码>'
Set-ItemProperty $p DefaultDomainName '.'

# 2. 开机自启：Win+R 输入 shell:startup，放入指向 C:\app_manager\PalmDesk\PalmDesk.exe 的快捷方式

# 3. RDP 断开后自动交回控制台：脚本内容见 STREAM_MODE.md 5.3 方案 B 第 3 步

# 4. 电源
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

# 5. 虚拟显示器：先信任证书，再在“设备管理器 ➔ 操作 ➔ 添加过时硬件”中
#    选择“从磁盘安装”，指向 C:\VirtualDisplayDriver\MttVDD.inf
certutil -addstore -f root C:\VirtualDisplayDriver\Virtual_Display_Driver.cer
certutil -addstore -f TrustedPublisher C:\VirtualDisplayDriver\Virtual_Display_Driver.cer
```
</details>

---

## 2. 登录 PalmDesk 并验证

1. 脚本结束时 PalmDesk 已启动。首次使用需在 PalmDesk 中确认服务端地址并完成设备登录。
2. 用手机扫码连接，选一个窗口，确认画面正常。
3. 打开需要远程操作的 Agent 应用（Codex、Claude、ChatGPT 等），**不要最小化**。

---

## 3. 验证清单

按顺序完成，全部通过才算部署成功：

| # | 操作 | 预期结果 |
| --- | --- | --- |
| 1 | 重启电脑，**不要**登录 RDP，等待 1～2 分钟 | — |
| 2 | 手机打开 PalmDesk 连接这台设备 | 设备在线，能进入阅读页或 Agent 目录 |
| 3 | 选择 Agent 窗口 | 画面正常显示，可点击、输入 |
| 4 | 从另一台电脑 RDP 登录，随后直接点 `X` 关闭 | — |
| 5 | 约 5 秒后，手机重新连接并选择窗口 | 画面正常，**没有**“窗口视频已结束” |
| 6 | 在管理员 PowerShell 中执行 `.\setup-unattended-host.ps1 -CheckOnly` | 自动登录=1、自启项存在、计划任务 Ready、PalmDesk 所在会话为 `console` + `Active` |

如需远程检查（RDP 已断开时），可通过 SSH 执行：
```powershell
query session                                             # 用户应为 console + Active
Get-Content C:\ProgramData\PalmDesk\return-to-console.log -Tail 5
Get-CimInstance Win32_VideoController | Select Name, CurrentHorizontalResolution, CurrentVerticalResolution
```

---

## 4. 日常使用规范

| 可以 | 不要 |
| --- | --- |
| 用 RDP 维护，结束时直接点 `X` 关闭 | 在 RDP 中**注销**（会话结束，PalmDesk 随之退出） |
| 让 Agent 窗口被其他窗口遮挡 | **最小化**要捕获的窗口 |
| 关闭本地显示器电源 | 关闭 RDP 前**锁屏**（Win+L），交回控制台后仍是锁屏，无法捕获 |
| 手机串流中途有人 RDP 进来 | 期待 RDP 期间手机继续看到画面：会话被 RDP 占用时以 RDP 显示为准，关闭 RDP 后重新连接即可 |

---

## 5. 故障排查

| 现象 | 检查 | 处理 |
| --- | --- | --- |
| 手机显示设备离线 | 是否已自动登录：`query session` 中有无该用户 | 检查 Winlogon 配置和密码；确认 PalmDesk 自启 |
| 选窗后立刻“窗口视频已结束” | `query session` 中用户状态为 `Disc` | 查看 `return-to-console.log`；手动执行 `schtasks /run /tn "PalmDesk\ReturnToConsole"` |
| 日志中出现 `an active session exists, skip` 但手机仍不可用 | 是否有其他账号的 RDP 会话处于 `Active` | 关闭该会话，或改用同一账号登录 RDP |
| 画面很小或模糊 | `Win32_VideoController` 中虚拟屏分辨率 | 确认 `C:\VirtualDisplayDriver\vdd_settings.xml` 存在；重跑脚本第 5 步 |
| 脚本报“安装虚拟显示器失败” | 错误码；`Get-ChildItem Cert:\LocalMachine\TrustedPublisher` 中有无 `CN=Virtual Display Driver` | 确认以管理员运行、系统为 x64、驱动包五个文件齐全；也可按“手动配置”中的“添加过时硬件”安装后重跑脚本 |
| 窗口跑到看不见的屏幕上 | 多屏位置：在控制台会话执行 `[System.Windows.Forms.Screen]::AllScreens` | 在 PalmDesk 中把窗口拖回主屏，或在“设置 ➔ 显示”中调整 |
| 重启后 PalmDesk 启动两次 | 启动文件夹和 `Run` 注册表是否都有自启项 | 删除其中一个 |

---

## 6. 撤销

```powershell
.\setup-unattended-host.ps1 -Uninstall
```

会删除计划任务和启动项，关闭自动登录并清除保存的密码。电源设置、虚拟显示器驱动和 `C:\VirtualDisplayDriver\` 保持不变，如需移除：

```powershell
pnputil /remove-device "ROOT\DISPLAY\0000"     # 以实际 InstanceId 为准
Remove-Item C:\ProgramData\PalmDesk -Recurse
```
