<#
.SYNOPSIS
  把一台 Windows 电脑配置成 PalmDesk 无人值守主机：关闭 RDP 或开机无人登录时，手机仍可通过 PalmDesk 捕获窗口。

.DESCRIPTION
  运行前先准备好两个目录：
    C:\app_manager\PalmDesk\        PalmDesk 桌面客户端（含 PalmDesk.exe）
    C:\VirtualDisplayDriver\        Virtual-Display-Driver 驱动包（MttVDD.inf/.dll/.cat、Virtual_Display_Driver.cer、vdd_settings.xml）

  脚本依次执行（均可重复运行，已完成的步骤会跳过）：
    1. 开机自动登录（Winlogon 注册表）
    2. 开机自启 PalmDesk（当前用户“启动”文件夹；已有指向 PalmDesk.exe 的自启项则跳过）
    3. 计划任务 PalmDesk\ReturnToConsole：RDP 断开后自动把会话交回物理控制台
    4. 交流电源下禁止睡眠、关闭显示器、休眠
    5. 虚拟显示器：导入证书、创建 Root\MttVDD 设备并安装驱动、设置首选分辨率、登录时自动应用
  详细说明见 docs/WINDOWS_UNATTENDED_HOST.md。

.EXAMPLE
  # 用要自动登录的账号登录，以管理员身份运行
  powershell -ExecutionPolicy Bypass -File .\setup-unattended-host.ps1

.EXAMPLE
  .\setup-unattended-host.ps1 -CheckOnly     # 只检查当前状态，不做修改
  .\setup-unattended-host.ps1 -Uninstall     # 撤销本脚本做的配置（不卸载驱动）
#>
[CmdletBinding()]
param(
  [string]$UserName = $env:USERNAME,
  [string]$Password,
  [string]$PalmDeskDir = 'C:\app_manager\PalmDesk',
  [string]$VddDir = 'C:\VirtualDisplayDriver',
  [int]$VddWidth = 1920,
  [int]$VddHeight = 1080,
  [int]$VddRefresh = 60,
  [switch]$SkipAutoLogon,
  [switch]$SkipVdd,
  [switch]$CheckOnly,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$Dir = 'C:\ProgramData\PalmDesk'
$TaskName = 'PalmDesk\ReturnToConsole'
$Winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$PalmExe = Join-Path $PalmDeskDir 'PalmDesk.exe'
$VddInf = Join-Path $VddDir 'MttVDD.inf'
$VddCer = Join-Path $VddDir 'Virtual_Display_Driver.cer'
$VddXml = Join-Path $VddDir 'vdd_settings.xml'
$VddHwId = 'Root\MttVDD'
$StartupDir = [Environment]::GetFolderPath('Startup')
$CommonStartupDir = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"
$PalmLnk = Join-Path $StartupDir 'PalmDesk.lnk'
$VddLnk = Join-Path $StartupDir 'PalmDesk-VddSetMode.lnk'

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!] $m" -ForegroundColor Yellow }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $CheckOnly) { throw '请以管理员身份运行 PowerShell。' }

# 所有指向 PalmDesk.exe 的自启项（启动文件夹快捷方式 + Run 注册表），排除本脚本的分辨率快捷方式
function Get-PalmAutostart {
  $ws = New-Object -ComObject WScript.Shell
  $items = @()
  foreach ($d in @($StartupDir, $CommonStartupDir)) {
    Get-ChildItem $d -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
      $target = $ws.CreateShortcut($_.FullName).TargetPath
      if ($target -match 'PalmDesk\.exe$') { $items += "$($_.FullName) -> $target" }
    }
  }
  foreach ($k in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run')) {
    (Get-ItemProperty $k -ErrorAction SilentlyContinue).PSObject.Properties | Where-Object { "$($_.Value)" -match 'PalmDesk\.exe' } | ForEach-Object { $items += "$k\$($_.Name) -> $($_.Value)" }
  }
  , $items
}

function Get-VddDevice {
  Get-PnpDevice -Class Display -ErrorAction SilentlyContinue | Where-Object {
    $_.FriendlyName -match 'Virtual Display Driver' -or $_.HardwareID -contains $VddHwId
  } | Select-Object -First 1
}

function Show-Status {
  Step '当前状态'
  $w = Get-ItemProperty $Winlogon
  "  自动登录: AutoAdminLogon=$($w.AutoAdminLogon) DefaultUserName=$($w.DefaultUserName)"
  "  PalmDesk: " + $(if (Test-Path $PalmExe) { $PalmExe } else { "未找到 $PalmExe" })
  "  开机自启: " + ((Get-PalmAutostart) -join '; ')
  $t = schtasks /query /tn $TaskName /fo csv 2>$null | ConvertFrom-Csv
  "  断开交回控制台任务: " + $(if ($t) { $t.Status } else { '未安装' })
  "  睡眠(交流): " + ((powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String '当前交流|Current AC') -replace '.*:\s*', '')
  $v = Get-VddDevice
  "  虚拟显示器: " + $(if ($v) { "$($v.Status) $($v.InstanceId)" } else { '未安装' })
  "  PalmDesk 进程所在会话: " + ((Get-Process PalmDesk -ErrorAction SilentlyContinue | Select-Object -ExpandProperty SessionId -Unique) -join ',')
  Get-CimInstance Win32_VideoController | ForEach-Object { "  显卡: {0} {1}x{2}@{3}Hz" -f $_.Name, $_.CurrentHorizontalResolution, $_.CurrentVerticalResolution, $_.CurrentRefreshRate }
  "  会话:"; query session | ForEach-Object { "    $_" }
}

if ($CheckOnly) { Show-Status; return }

if ($Uninstall) {
  Step '撤销配置'
  schtasks /delete /tn $TaskName /f 2>$null | Out-Null; Ok "已删除计划任务 $TaskName"
  Remove-Item $PalmLnk, $VddLnk -ErrorAction SilentlyContinue; Ok '已删除本脚本创建的启动项'
  Set-ItemProperty $Winlogon AutoAdminLogon '0'
  Remove-ItemProperty $Winlogon DefaultPassword -ErrorAction SilentlyContinue; Ok '已关闭自动登录并清除保存的密码'
  $v = Get-VddDevice
  if ($v) { Warn "虚拟显示器驱动未卸载；如需移除：pnputil /remove-device `"$($v.InstanceId)`"" }
  Warn "电源设置未改动；$Dir 中的脚本可手动删除。"
  return
}

New-Item -ItemType Directory -Force -Path $Dir | Out-Null

# ---------- 0. 检查目录 ----------
Step '0. 检查准备好的目录'
if (Test-Path $PalmExe) { Ok "PalmDesk: $PalmExe" } else { throw "未找到 $PalmExe，请先把 PalmDesk 放到 $PalmDeskDir，或用 -PalmDeskDir 指定" }
if (-not $SkipVdd) {
  $missing = @($VddInf, $VddCer, $VddXml, (Join-Path $VddDir 'MttVDD.dll'), (Join-Path $VddDir 'mttvdd.cat')) | Where-Object { -not (Test-Path $_) }
  if ($missing) { throw ("虚拟显示器驱动包不完整，缺少：`n  " + ($missing -join "`n  ") + "`n或加 -SkipVdd 跳过虚拟显示器") }
  Ok "驱动包: $VddDir"
}

# ---------- 1. 自动登录 ----------
if (-not $SkipAutoLogon) {
  Step "1. 开机自动登录 ($UserName)"
  if (-not $Password) {
    $sec = Read-Host "输入 $UserName 的登录密码" -AsSecureString
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  }
  Set-ItemProperty $Winlogon AutoAdminLogon '1'
  Set-ItemProperty $Winlogon DefaultUserName $UserName
  Set-ItemProperty $Winlogon DefaultPassword $Password
  Set-ItemProperty $Winlogon DefaultDomainName '.'
  Remove-ItemProperty $Winlogon AutoLogonCount -ErrorAction SilentlyContinue
  Ok '已写入 Winlogon（密码为明文存储；如介意请改用 Sysinternals Autologon 并加 -SkipAutoLogon）'
}

# ---------- 2. 开机自启 PalmDesk ----------
Step '2. 开机自启 PalmDesk'
$existing = Get-PalmAutostart
if ($existing.Count -gt 0) {
  Ok ('已有自启项，跳过：' + ($existing -join '; '))
} else {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut($PalmLnk); $lnk.TargetPath = $PalmExe; $lnk.WorkingDirectory = $PalmDeskDir; $lnk.Save()
  Ok "已创建 $PalmLnk -> $PalmExe"
}

# ---------- 3. RDP 断开后自动交回控制台 ----------
Step "3. 计划任务 $TaskName"
$returnScript = @'
# 把自动登录用户已断开的会话交回物理控制台，让 DWM 继续渲染，保证 PalmDesk 可以捕获。
$log = 'C:\ProgramData\PalmDesk\return-to-console.log'
function Log($m) { Add-Content -Path $log -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $m) -Encoding UTF8 }
Start-Sleep -Seconds 3
$user = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon').DefaultUserName
if (-not $user) { Log 'no DefaultUserName, skip'; exit 0 }
$rows = @()
foreach ($line in (query user 2>$null | Select-Object -Skip 1)) {
  if ($line -match '^\s*>?(\S+)\s+(?:(\S+)\s+)?(\d+)\s+(\S+)') {
    $rows += [pscustomobject]@{ User = $Matches[1]; Id = [int]$Matches[3]; State = $Matches[4] }
  }
}
Log ('sessions: ' + (($rows | ForEach-Object { "$($_.User)#$($_.Id)=$($_.State)" }) -join ', '))
if ($rows | Where-Object { $_.State -match '^(Active|运行中)$' }) { Log 'an active session exists, skip'; exit 0 }
$target = $rows | Where-Object { $_.User -ieq $user -and $_.State -match '^(Disc|断开)' } | Select-Object -First 1
if (-not $target) { Log "no disconnected session for $user, skip"; exit 0 }
& "$env:windir\System32\tscon.exe" $target.Id /dest:console 2>&1 | ForEach-Object { Log "tscon: $_" }
Log ("tscon $($target.Id) /dest:console exit=$LASTEXITCODE")
'@
Set-Content -Path "$Dir\return-to-console.ps1" -Value $returnScript -Encoding UTF8
schtasks /create /tn $TaskName /ru SYSTEM /rl HIGHEST /sc onevent `
  /ec 'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational' `
  /mo '*[System[(EventID=24)]]' `
  /tr "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $Dir\return-to-console.ps1" /f | Out-Null
Ok "已创建（日志：$Dir\return-to-console.log）"

# ---------- 4. 电源 ----------
Step '4. 电源：交流电源下不睡眠、不关屏、不休眠'
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
Ok '已设置'

# ---------- 5. 虚拟显示器 ----------
Step '5. 虚拟显示器 Virtual-Display-Driver'
if ($SkipVdd) { Ok '已按参数跳过' }
else {
  # 5.1 首选分辨率：驱动只读取 C:\VirtualDisplayDriver\vdd_settings.xml，列表第一项作为默认模式
  Copy-Item $VddXml "$VddXml.bak-$(Get-Date -Format yyyyMMddHHmmss)"
  [xml]$x = Get-Content $VddXml -Raw -Encoding UTF8
  $res = $x.vdd_settings.resolutions
  $want = $res.resolution | Where-Object { [int]$_.width -eq $VddWidth -and [int]$_.height -eq $VddHeight } | Select-Object -First 1
  if (-not $want) {
    $want = $x.CreateElement('resolution')
    foreach ($kv in @(@('width', $VddWidth), @('height', $VddHeight), @('refresh_rate', $VddRefresh))) { $e = $x.CreateElement($kv[0]); $e.InnerText = "$($kv[1])"; [void]$want.AppendChild($e) }
  } else { [void]$res.RemoveChild($want) }
  [void]$res.PrependChild($want)
  $x.Save($VddXml)
  Ok "首选分辨率 ${VddWidth}x${VddHeight}（原配置已备份）"

  # 5.2 证书：驱动为自签名，需信任后才能静默安装
  $cert = New-Object Security.Cryptography.X509Certificates.X509Certificate2 $VddCer
  foreach ($store in 'Root', 'TrustedPublisher') {
    if (Get-ChildItem "Cert:\LocalMachine\$store" | Where-Object Thumbprint -eq $cert.Thumbprint) { Ok "证书已在 $store" }
    else { certutil -addstore -f $store $VddCer | Out-Null; Ok "已导入证书到 $store" }
  }

  # 5.3 设备：没有则创建 Root\MttVDD 设备并安装驱动（等同 devcon install），已有则重启使配置生效
  $vdd = Get-VddDevice
  if ($vdd) {
    pnputil /restart-device "$($vdd.InstanceId)" | Out-Null
    Ok "驱动已安装，已重启 $($vdd.InstanceId)"
  } else {
    Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class RootDevice {
  [StructLayout(LayoutKind.Sequential)] struct SP_DEVINFO_DATA { public uint cbSize; public Guid ClassGuid; public uint DevInst; public IntPtr Reserved; }
  [DllImport("setupapi.dll", SetLastError=true)] static extern IntPtr SetupDiCreateDeviceInfoList(ref Guid cls, IntPtr hwnd);
  [DllImport("setupapi.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool SetupDiCreateDeviceInfoW(IntPtr set, string name, ref Guid cls, string desc, IntPtr hwnd, uint flags, ref SP_DEVINFO_DATA data);
  [DllImport("setupapi.dll", SetLastError=true)] static extern bool SetupDiSetDeviceRegistryPropertyW(IntPtr set, ref SP_DEVINFO_DATA data, uint prop, byte[] buf, uint size);
  [DllImport("setupapi.dll", SetLastError=true)] static extern bool SetupDiCallClassInstaller(uint fn, IntPtr set, ref SP_DEVINFO_DATA data);
  [DllImport("setupapi.dll", SetLastError=true)] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
  [DllImport("newdev.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool UpdateDriverForPlugAndPlayDevicesW(IntPtr hwnd, string hwid, string inf, uint flags, out bool reboot);
  public static string Install(string hwid, string inf) {
    Guid cls = new Guid("4d36e968-e325-11ce-bfc1-08002be10318"); // Display
    IntPtr set = SetupDiCreateDeviceInfoList(ref cls, IntPtr.Zero);
    if (set == new IntPtr(-1)) return "CreateDeviceInfoList failed " + Marshal.GetLastWin32Error();
    try {
      var d = new SP_DEVINFO_DATA(); d.cbSize = (uint)Marshal.SizeOf(typeof(SP_DEVINFO_DATA));
      if (!SetupDiCreateDeviceInfoW(set, "Display", ref cls, null, IntPtr.Zero, 1 /*DICD_GENERATE_ID*/, ref d)) return "CreateDeviceInfo failed " + Marshal.GetLastWin32Error();
      byte[] ids = System.Text.Encoding.Unicode.GetBytes(hwid + "\0\0");
      if (!SetupDiSetDeviceRegistryPropertyW(set, ref d, 1 /*SPDRP_HARDWAREID*/, ids, (uint)ids.Length)) return "SetHardwareId failed " + Marshal.GetLastWin32Error();
      if (!SetupDiCallClassInstaller(0x19 /*DIF_REGISTERDEVICE*/, set, ref d)) return "RegisterDevice failed " + Marshal.GetLastWin32Error();
    } finally { SetupDiDestroyDeviceInfoList(set); }
    bool reboot;
    if (!UpdateDriverForPlugAndPlayDevicesW(IntPtr.Zero, hwid, inf, 1 /*INSTALLFLAG_FORCE*/, out reboot)) return "UpdateDriver failed " + Marshal.GetLastWin32Error();
    return reboot ? "OK (reboot required)" : "OK";
  }
}
'@
    $r = [RootDevice]::Install($VddHwId, (Resolve-Path $VddInf).Path)
    if ($r -notmatch '^OK') { throw "安装虚拟显示器失败：$r" }
    Start-Sleep -Seconds 5
    $vdd = Get-VddDevice
    Ok "已安装虚拟显示器 $($vdd.InstanceId)（$r）"
  }

  # 5.4 登录时应用分辨率：驱动重启后 Windows 常沿用旧模式，必须在用户控制台会话内调用 ChangeDisplaySettingsEx
  $setMode = @"
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class VddMode {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct DISPLAY_DEVICE { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string DeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceString; public int StateFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceID; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceKey; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra; public int dmFields;
    public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="EnumDisplayDevicesW")] static extern bool EnumDisplayDevices(string dev, uint i, ref DISPLAY_DEVICE dd, uint f);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="EnumDisplaySettingsW")] static extern bool EnumDisplaySettings(string dev, int mode, ref DEVMODE dm);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="ChangeDisplaySettingsExW")] static extern int ChangeDisplaySettingsEx(string dev, ref DEVMODE dm, IntPtr h, uint f, IntPtr p);
  public static string Run(int w, int h, int hz) {
    var log = "";
    for (uint i = 0; i < 16; i++) {
      var dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
      if (!EnumDisplayDevices(null, i, ref dd, 0)) break;
      if ((dd.StateFlags & 1) == 0 || !dd.DeviceString.Contains("Virtual Display")) continue;
      var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
      EnumDisplaySettings(dd.DeviceName, -1, ref dm);
      if (dm.dmPelsWidth == w && dm.dmPelsHeight == h && dm.dmDisplayFrequency == hz) { log += dd.DeviceName + " already " + w + "x" + h + "@" + hz + "; "; continue; }
      dm.dmPelsWidth = w; dm.dmPelsHeight = h; dm.dmDisplayFrequency = hz; dm.dmFields = 0x80000 | 0x100000 | 0x400000;
      log += dd.DeviceName + " set " + w + "x" + h + "@" + hz + " result=" + ChangeDisplaySettingsEx(dd.DeviceName, ref dm, IntPtr.Zero, 0x1, IntPtr.Zero) + "; ";
    }
    return log == "" ? "no attached virtual display in this session" : log;
  }
}
'@
`$r = [VddMode]::Run($VddWidth, $VddHeight, $VddRefresh)
Add-Content -Path '$Dir\vdd-setmode.log' -Value ('{0:yyyy-MM-dd HH:mm:ss}  session={1}  {2}' -f (Get-Date), (Get-Process -Id `$PID).SessionId, `$r) -Encoding UTF8
"@
  Set-Content -Path "$Dir\vdd-setmode.ps1" -Value $setMode -Encoding UTF8
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut($VddLnk)
  $lnk.TargetPath = 'powershell.exe'
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $Dir\vdd-setmode.ps1"
  $lnk.WindowStyle = 7
  $lnk.Save()
  Ok "登录时自动应用 ${VddWidth}x${VddHeight}@${VddRefresh}（$VddLnk）"
  Start-Sleep -Seconds 3
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$Dir\vdd-setmode.ps1"
  Ok ('立即应用：' + (Get-Content "$Dir\vdd-setmode.log" -Tail 1))
}

# ---------- 6. 启动 PalmDesk ----------
if (-not (Get-Process PalmDesk -ErrorAction SilentlyContinue)) {
  Step '6. 启动 PalmDesk'
  Start-Process -FilePath $PalmExe -WorkingDirectory $PalmDeskDir
  Ok '已启动'
}

Show-Status
Write-Host "`n完成。请重启一次，按 docs/WINDOWS_UNATTENDED_HOST.md 第 3 节验证；之后关闭 RDP 时直接点 X，不要注销、不要先锁屏。" -ForegroundColor Green
