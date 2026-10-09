import { copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));

async function buildRust() {
  const cargoToml = path.join(root, 'crates/Cargo.toml');
  if (!existsSync(cargoToml)) {
    return false;
  }
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return true;
  }
  const isWindows = process.platform === 'win32';
  const targetBinary = isWindows
    ? path.join(root, 'crates/target/release/palmdesk-native.exe')
    : path.join(root, 'crates/target/release/palmdesk-native');
  const output = isWindows
    ? path.join(root, 'native-bin/palmdesk-window.exe')
    : path.join(root, 'native-bin/codex-window');

  try {
    execFileSync('cargo', ['--version'], { stdio: 'ignore' });
  } catch {
    return false;
  }

  await mkdir(path.dirname(output), { recursive: true });
  execFileSync(
    'cargo',
    [
      'build',
      '--release',
      '-p',
      'palmdesk-native',
      '-p',
      'palmdesk-session-core',
      '-p',
      'palmdesk-input',
      '--manifest-path',
      cargoToml,
    ],
    { stdio: 'inherit', cwd: root }
  );

  if (existsSync(targetBinary)) {
    await copyFile(targetBinary, output);
  }

  const sessionCoreLib = isWindows
    ? path.join(root, 'crates/target/release/palmdesk_session_core.dll')
    : path.join(root, 'crates/target/release/libpalmdesk_session_core.dylib');
  const sessionCoreNode = path.join(
    root,
    'session-core/palmdesk_session_core.node'
  );
  if (existsSync(sessionCoreLib)) {
    await copyFile(sessionCoreLib, sessionCoreNode);
  }

  const inputLib = isWindows
    ? path.join(root, 'crates/target/release/palmdesk_input.dll')
    : path.join(root, 'crates/target/release/libpalmdesk_input.dylib');
  const inputNode = path.join(root, 'native-bin/palmdesk_input.node');
  if (existsSync(inputLib)) {
    await copyFile(inputLib, inputNode);
  }
  return true;
}

const rustBuilt = await buildRust();
if (!rustBuilt) {
  if (process.platform === 'darwin') {
    const source = path.join(root, 'electron-main/native/codex-window.swift');
    const output = path.join(root, 'native-bin/codex-window');
    const existing = await stat(output).catch(() => null);
    if (!existing || existing.mtimeMs < (await stat(source)).mtimeMs) {
      await mkdir(path.dirname(output), { recursive: true });
      await mkdir(path.join(root, '.local/swift-cache'), { recursive: true });
      execFileSync(
        'xcrun',
        [
          'swiftc',
          '-O',
          '-module-cache-path',
          path.join(root, '.local/swift-cache'),
          source,
          '-o',
          output,
        ],
        { stdio: 'inherit' }
      );
    }
  } else if (process.platform === 'win32') {
    const source = path.join(root, 'electron-main/native/palmdesk-window.cs');
    const output = path.join(root, 'native-bin/palmdesk-window.exe');
    const existing = await stat(output).catch(() => null);
    if (!existing || existing.mtimeMs < (await stat(source)).mtimeMs) {
      const windows =
        process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
      const compiler = ['Framework64', 'Framework']
        .map((framework) =>
          path.join(windows, 'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe')
        )
        .find((candidate) => existsSync(candidate));
      if (!compiler) {
        throw new Error(
          'Cannot find the Windows .NET Framework v4.0.30319 csc.exe compiler.'
        );
      }
      await mkdir(path.dirname(output), { recursive: true });
      execFileSync(
        compiler,
        [
          '/nologo',
          '/optimize+',
          '/target:exe',
          '/platform:anycpu',
          '/reference:System.Web.Extensions.dll',
          `/out:${output}`,
          source,
        ],
        { stdio: 'inherit', windowsHide: true }
      );
    }
  }
}
