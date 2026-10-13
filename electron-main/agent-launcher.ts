import { execFile, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { AGENT_DEFINITIONS, getAgent } from '../src/utils/agent-registry';

import type { NativeWindowBridge } from './native-window';

const execute = promisify(execFile);

interface InstalledTarget {
  id: string;
  bundleId?: string;
  executable?: string;
  appId?: string;
}

// Read only the current user's registered packages and App Paths. Neither the
// controller nor a window title supplies executable paths, arguments or scripts.
export const WINDOWS_AGENT_CATALOG_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$result = New-Object System.Collections.Generic.List[object]
$names = @('codex.exe','claude.exe','chatgpt.exe','kimi.exe','kimi desktop.exe','kimi work.exe','kimi-work.exe','zcode.exe','workbuddyai.exe','workbuddy.exe')
foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths','HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths','HKCU:\Software\Classes\Applications','HKLM:\Software\Classes\Applications')) {
  foreach ($name in $names) {
    $path = if ($root.EndsWith('Applications')) { $root + '\' + $name + '\shell\open\command' } else { $root + '\' + $name }
    $key = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
    if ($key) {
      $raw = [string]$key.GetValue('')
      $file = if ($raw.StartsWith('"')) { $raw.Substring(1).Split('"')[0] } else { $raw.Split(' ')[0] }
      $file = [Environment]::ExpandEnvironmentVariables($file).Trim('"')
      if ($file -and (Test-Path -LiteralPath $file -PathType Leaf) -and [IO.Path]::GetFileName($file) -ieq $name) {
        $result.Add(@{ executable = $file })
      }
    }
  }
}
if ((Get-Command Get-Item -ErrorAction SilentlyContinue).CommandType -eq 'Cmdlet') {
  $localPrograms = [Environment]::GetFolderPath('LocalApplicationData') + '\Programs'
  foreach ($name in $names) {
    $candidate = Join-Path $localPrograms ([IO.Path]::GetFileNameWithoutExtension($name) + '\' + $name)
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $result.Add(@{ executable = $candidate })
    }
  }
}
$packages = @()
try { $packages = @(Get-AppxPackage -ErrorAction Stop) } catch {
  # AppX discovery is optional; preserve desktop targets already found above.
}
foreach ($package in $packages) {
  if ($package.IsFramework -or !$package.InstallLocation) { continue }
  try {
    # Read the registered package's local manifest without a deployment cmdlet
    # round trip for every installed application.
    $manifest = New-Object System.Xml.XmlDocument
    $manifest.XmlResolver = $null
    $manifest.Load((Join-Path $package.InstallLocation 'AppxManifest.xml'))
    foreach ($application in @($manifest.Package.Applications.Application)) {
      $relative = [string]$application.Executable
      if (!$relative -or !($names -contains [IO.Path]::GetFileName($relative))) { continue }
      $file = [IO.Path]::GetFullPath((Join-Path $package.InstallLocation $relative))
      $root = [IO.Path]::GetFullPath($package.InstallLocation).TrimEnd('\') + '\'
      if (!$file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file -PathType Leaf)) { continue }
      $result.Add(@{ executable = $file; appId = $package.PackageFamilyName + '!' + $application.Id })
    }
  } catch { continue }
}
ConvertTo-Json -InputObject @($result.ToArray()) -Compress
`;

export function windowsAgentTargets(value: unknown): InstalledTarget[] {
  if (!Array.isArray(value)) throw new Error('无法读取 Windows 已安装的 Agent');
  return AGENT_DEFINITIONS.flatMap((agent) => {
    const target = value.find((candidate) => {
      if (!candidate || typeof candidate.executable !== 'string') return false;
      const executable = candidate.executable;
      return (
        /^[a-z]:\\/i.test(executable) &&
        !executable.includes('\0') &&
        (agent.executables as readonly string[]).includes(
          path.win32.basename(executable).toLowerCase()
        ) &&
        (candidate.appId === undefined ||
          (typeof candidate.appId === 'string' &&
            /^[a-z0-9._-]+![a-z0-9._-]+$/i.test(candidate.appId)))
      );
    });
    return target
      ? [{ id: agent.id, executable: target.executable, appId: target.appId }]
      : [];
  });
}

async function startWindowsTarget(
  target: InstalledTarget,
  current: () => boolean
) {
  // Resolve again on every explicit launch; no saved client path is trusted.
  if (!(await stat(target.executable!)).isFile())
    throw new Error('Agent 已移除，请刷新后重试');
  if (!current()) throw new Error('连接已中断，打开 Agent 已取消');
  const executable = target.appId
    ? path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe')
    : target.executable!;
  const args = target.appId ? [`shell:AppsFolder\\${target.appId}`] : [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      detached: true,
      stdio: 'ignore',
      cwd: path.win32.dirname(target.executable!),
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export class AgentLauncher {
  private operation?: { id: string; cancelled: boolean };
  private catalog?: { targets: InstalledTarget[]; expiresAt: number };
  private catalogRequest?: Promise<InstalledTarget[]>;

  constructor(
    private native: Pick<NativeWindowBridge, 'request'>,
    private platform: NodeJS.Platform = process.platform,
    private readWindows: () => Promise<unknown> = async () => {
      const powershell = path.win32.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe'
      );
      const { stdout } = await execute(
        powershell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(WINDOWS_AGENT_CATALOG_SCRIPT, 'utf16le').toString(
            'base64'
          ),
        ],
        { timeout: 10000, maxBuffer: 256 * 1024, windowsHide: true }
      );
      return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    },
    private startWindows = startWindowsTarget,
    private now = Date.now
  ) {}

  private async targets(): Promise<InstalledTarget[]> {
    if (this.platform === 'darwin') {
      const bundles = await this.native.request<string[]>('installedAgents', {
        bundles: AGENT_DEFINITIONS.flatMap((agent) => [...agent.bundles]),
      });
      return AGENT_DEFINITIONS.flatMap((agent) => {
        const bundleId = agent.bundles.find((bundle) =>
          bundles.includes(bundle)
        );
        return bundleId ? [{ id: agent.id, bundleId }] : [];
      });
    }
    if (this.platform === 'win32')
      return windowsAgentTargets(await this.readWindows());
    return [];
  }

  async list() {
    const supported = this.platform === 'darwin' || this.platform === 'win32';
    if (!this.catalog || this.catalog.expiresAt <= this.now()) {
      // Share slow discovery across peers. Only the picker uses this cache;
      // an explicit launch always resolves the installed target again.
      if (!this.catalogRequest) {
        this.catalogRequest = this.targets()
          .then((targets) => {
            this.catalog = { targets, expiresAt: this.now() + 30000 };
            return targets;
          })
          .finally(() => {
            this.catalogRequest = undefined;
          });
      }
      await this.catalogRequest;
    }
    return {
      supported,
      agents: this.catalog!.targets.map(({ id }) => {
        const agent = getAgent(id)!;
        return { id: agent.id, name: agent.name };
      }),
      message: supported ? '' : '当前电脑平台尚不支持打开 Agent',
    };
  }

  cancel(id: unknown) {
    if (this.operation && this.operation.id === id)
      this.operation.cancelled = true;
  }

  async launch(id: unknown, operationId: unknown) {
    const agent = getAgent(id);
    if (
      !agent ||
      typeof operationId !== 'string' ||
      !/^[a-z0-9-]{1,64}$/i.test(operationId)
    )
      throw new Error('无效的 Agent 打开请求');
    if (this.operation) throw new Error('已有 Agent 正在打开，请稍后重试');
    const operation = { id: operationId, cancelled: false };
    this.operation = operation;
    const current = () => this.operation === operation && !operation.cancelled;
    try {
      const target = (await this.targets()).find(
        (item) => item.id === agent.id
      );
      if (!current()) throw new Error('连接已中断，打开 Agent 已取消');
      if (!target)
        throw new Error('未找到可启动的已安装 Agent，请刷新或在电脑上打开');
      if (this.platform === 'darwin') {
        await this.native.request(
          'launchAgent',
          { bundleId: target.bundleId },
          current
        );
      } else {
        await this.startWindows(target, current);
      }
      return { id: agent.id };
    } finally {
      if (this.operation === operation) this.operation = undefined;
    }
  }
}
