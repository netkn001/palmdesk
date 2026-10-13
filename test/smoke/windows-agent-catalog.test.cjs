const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdir, mkdtemp, realpath, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const load = require('./load-source.cjs');

const { WINDOWS_AGENT_CATALOG_SCRIPT, windowsAgentTargets } = load(
  'electron-main/agent-launcher.ts'
);

function catalog(fixture) {
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe'
  );
  const stdout = execFileSync(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(fixture + WINDOWS_AGENT_CATALOG_SCRIPT, 'utf16le').toString(
        'base64'
      ),
    ],
    { encoding: 'utf8', timeout: 15000, windowsHide: true }
  );
  return windowsAgentTargets(JSON.parse(stdout.replace(/^\uFEFF/, '').trim()));
}

test(
  'real Windows PowerShell preserves App Paths targets when AppX enumeration throws',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'palmdesk-app-paths-'))
    );
    const executable = path.join(directory, 'Codex.exe');
    try {
      await writeFile(executable, 'fixture only: never executed');
      const literal = executable.replace(/'/g, "''");
      // Run the production script in the real interpreter. Replace only discovery
      // providers, without creating registry entries or launching any application.
      const fixture = `
$script:fixtureExecutable = '${literal}'
function Get-Item {
  [CmdletBinding()] param([string]$LiteralPath)
  if ($LiteralPath -eq 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\codex.exe') {
    $entry = New-Object PSObject
    $entry | Add-Member ScriptMethod GetValue { param($name) return $script:fixtureExecutable }
    return $entry
  }
}
function Get-AppxPackage {
  [CmdletBinding()] param()
  throw 'AppX unavailable in fixture'
}
`;
      const targets = catalog(fixture);
      assert.deepEqual(targets, [
        { id: 'codex', executable, appId: undefined },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

test(
  'real Windows PowerShell reads local MSIX manifests and skips invalid packages',
  { skip: process.platform !== 'win32' },
  async () => {
    // Windows CI's TEMP may use an 8.3 alias; PowerShell resolves the long path.
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'palmdesk-msix-'))
    );
    const packageDirectory = path.join(directory, 'Claude 测试');
    const executable = path.join(packageDirectory, 'app', 'Claude.exe');
    try {
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, 'fixture only: never executed');
      await writeFile(path.join(directory, 'Codex.exe'), 'outside package');
      await writeFile(
        path.join(packageDirectory, 'AppxManifest.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Applications>
    <Application Id="Claude" Executable="app\\Claude.exe" />
    <Application Id="Escape" Executable="..\\Codex.exe" />
    <Application Id="Missing" Executable="ChatGPT.exe" />
  </Applications>
</Package>`
      );
      const literal = packageDirectory.replace(/'/g, "''");
      const targets = catalog(`
function Get-Item { [CmdletBinding()] param([string]$LiteralPath) }
function Get-AppxPackage {
  [CmdletBinding()] param()
  [pscustomobject]@{ IsFramework = $false; InstallLocation = '${literal}\\missing'; PackageFamilyName = 'Missing_123' }
  [pscustomobject]@{ IsFramework = $false; InstallLocation = '${literal}'; PackageFamilyName = 'Claude_123' }
}
`);
      assert.deepEqual(targets, [
        { id: 'claude', executable, appId: 'Claude_123!Claude' },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

test(
  'real Windows PowerShell discovers WorkBuddy through Classes Applications registry',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'palmdesk-workbuddy-'))
    );
    const executable = path.join(directory, 'WorkBuddyAI.exe');
    try {
      await writeFile(executable, 'fixture only: never executed');
      const literal = executable.replace(/'/g, "''");
      const fixture = `
$script:fixtureExecutable = '${literal}'
function Get-Item {
  [CmdletBinding()] param([string]$LiteralPath)
  if ($LiteralPath -ieq 'HKCU:\\Software\\Classes\\Applications\\workbuddyai.exe\\shell\\open\\command') {
    $entry = New-Object PSObject
    $entry | Add-Member ScriptMethod GetValue { param($name) return '"' + $script:fixtureExecutable + '" "%1"' }
    return $entry
  }
}
function Get-AppxPackage {
  [CmdletBinding()] param()
  throw 'AppX unavailable in fixture'
}
`;
      const targets = catalog(fixture);
      assert.deepEqual(targets, [
        { id: 'workbuddy', executable, appId: undefined },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

