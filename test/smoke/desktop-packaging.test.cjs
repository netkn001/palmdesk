const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

function harness(
  t,
  platform,
  { compiler = 'Framework64', failure, args = [] } = {}
) {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'palmdesk packaging '))
  );
  const calls = [];
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalExec = childProcess.execFileSync;
  const originalArgv = process.argv;
  const originalWindir = process.env.WINDIR;
  const originalSystemRoot = process.env.SystemRoot;

  t.after(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    childProcess.execFileSync = originalExec;
    process.argv = originalArgv;
    syncBuiltinESMExports();
    if (originalWindir === undefined) delete process.env.WINDIR;
    else process.env.WINDIR = originalWindir;
    if (originalSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = originalSystemRoot;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function write(relative, content = '') {
    const filename = path.join(directory, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
    return filename;
  }

  for (const name of [
    'build-native.mjs',
    'before-pack.cjs',
    'build-desktop.mjs',
    'check-desktop-identity.cjs',
    'desktop-identity.cjs',
  ]) {
    const filename = path.join(root, 'scripts', name);
    if (fs.existsSync(filename)) {
      write(`scripts/${name}`, fs.readFileSync(filename));
    }
  }
  write('electron-main/native/codex-window.swift');
  write('electron-main/native/palmdesk-window.cs');
  for (const [name, bin] of [
    ['vite', 'bin/vite.js'],
    ['electron-builder', 'cli.js'],
  ]) {
    write(`node_modules/${name}/package.json`, JSON.stringify({ name, bin }));
    write(`node_modules/${name}/${bin}`);
  }
  process.env.WINDIR = path.join(directory, 'Windows');
  process.env.SystemRoot = process.env.WINDIR;
  if (compiler) {
    write(`Windows/Microsoft.NET/${compiler}/v4.0.30319/csc.exe`);
  }
  Object.defineProperty(process, 'platform', { value: platform });
  process.argv = [
    process.execPath,
    path.join(directory, 'scripts/build-desktop.mjs'),
    ...args,
  ];
  childProcess.execFileSync = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    if (failure) throw failure;
    return '';
  };
  syncBuiltinESMExports();

  return {
    directory,
    calls,
    write,
    run: (name = 'build-native.mjs') =>
      import(pathToFileURL(path.join(directory, 'scripts', name)).href),
    beforePack: require(path.join(directory, 'scripts/before-pack.cjs')),
  };
}

test('Windows compiles the helper with Framework64, AnyCPU and Framework JSON', async (t) => {
  const { directory, calls, write, run } = harness(t, 'win32');
  write('Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe');
  await run();
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].command,
    path.join(directory, 'Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  );
  for (const argument of [
    '/target:exe',
    '/platform:anycpu',
    '/reference:System.Web.Extensions.dll',
    `/out:${path.join(directory, 'native-bin/palmdesk-window.exe')}`,
    path.join(directory, 'electron-main/native/palmdesk-window.cs'),
  ]) {
    assert.ok(calls[0].args.includes(argument), `Missing ${argument}`);
  }
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.stdio, 'inherit');
  assert.ok(fs.statSync(path.join(directory, 'native-bin')).isDirectory());
});

test('Windows falls back to the 32-bit Framework compiler', async (t) => {
  const { calls, run } = harness(t, 'win32', { compiler: 'Framework' });
  await run();
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].command,
    /Microsoft\.NET[/\\]Framework[/\\]v4\.0\.30319[/\\]csc\.exe$/
  );
});

test('Windows finds the compiler through SystemRoot when WINDIR is absent', async (t) => {
  const { calls, run } = harness(t, 'win32');
  delete process.env.WINDIR;
  await run();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].command.startsWith(process.env.SystemRoot));
});

test('Windows reports a missing Framework compiler before invoking a command', async (t) => {
  const { calls, run } = harness(t, 'win32', { compiler: null });
  await assert.rejects(run(), /\.NET Framework.*csc\.exe/i);
  assert.equal(calls.length, 0);
});

test('Windows propagates native compilation failures', async (t) => {
  const failure = new Error('C# compilation failed');
  const { run } = harness(t, 'win32', { failure });
  await assert.rejects(run(), (error) => error === failure);
});

for (const difference of [0, 60_000]) {
  test(`Windows skips the compiler when the helper is ${difference}ms newer than its source`, async (t) => {
    const { directory, calls, write, run } = harness(t, 'win32');
    const source = path.join(
      directory,
      'electron-main/native/palmdesk-window.cs'
    );
    const output = write('native-bin/palmdesk-window.exe', 'current helper');
    const sourceTime = new Date(Date.now() - 120_000);
    const outputTime = new Date(sourceTime.getTime() + difference);
    fs.utimesSync(source, sourceTime, sourceTime);
    fs.utimesSync(output, outputTime, outputTime);
    const before = fs.statSync(output).mtimeMs;

    await run();

    assert.equal(calls.length, 0);
    assert.equal(fs.readFileSync(output, 'utf8'), 'current helper');
    assert.equal(fs.statSync(output).mtimeMs, before);
  });
}

test('Windows reuses a current helper without requiring an installed compiler', async (t) => {
  const { calls, write, run } = harness(t, 'win32', { compiler: null });
  const output = write('native-bin/palmdesk-window.exe');
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(output, future, future);

  await run();

  assert.equal(calls.length, 0);
});

test('Windows recompiles the helper when its source is newer', async (t) => {
  const { calls, write, run } = harness(t, 'win32');
  const output = write('native-bin/palmdesk-window.exe');
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(output, past, past);

  await run();

  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes(`/out:${output}`));
});

test('macOS retains the optimized Swift build and module cache', async (t) => {
  const { directory, calls, run } = harness(t, 'darwin');
  await run();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'xcrun');
  assert.deepEqual(calls[0].args, [
    'swiftc',
    '-O',
    '-module-cache-path',
    path.join(directory, '.local/swift-cache'),
    path.join(directory, 'electron-main/native/codex-window.swift'),
    '-o',
    path.join(directory, 'native-bin/codex-window'),
  ]);
});

test('macOS skips recompilation when the helper is current', async (t) => {
  const { calls, write, run } = harness(t, 'darwin');
  const output = write('native-bin/codex-window');
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(output, future, future);
  await run();
  assert.equal(calls.length, 0);
});

test('Linux source builds do not try to compile a desktop helper', async (t) => {
  const { calls, run } = harness(t, 'linux');
  await run();
  assert.equal(calls.length, 0);
});

for (const platform of ['win32', 'darwin']) {
  test(`beforePack compiles the helper when packaging on ${platform}`, async (t) => {
    const { directory, calls, beforePack } = harness(t, platform);
    await beforePack({ electronPlatformName: platform });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(calls[0].args, [
      path.join(directory, 'scripts/build-native.mjs'),
    ]);
  });
}

for (const [host, target, label] of [
  ['linux', 'win32', 'Windows'],
  ['darwin', 'win32', 'Windows'],
  ['win32', 'darwin', 'macOS'],
]) {
  test(`beforePack rejects ${target} helpers on ${host} hosts`, async (t) => {
    const { calls, beforePack } = harness(t, host);
    await assert.rejects(
      beforePack({ electronPlatformName: target }),
      new RegExp(`Build the ${label} native window helper on ${label}`)
    );
    assert.equal(calls.length, 0);
  });
}

test('beforePack propagates native build failures', async (t) => {
  const failure = new Error('native build failed');
  const { beforePack } = harness(t, 'win32', { failure });
  await assert.rejects(
    beforePack({ electronPlatformName: 'win32' }),
    (error) => error === failure
  );
});

for (const [platform, target] of [
  ['win32', ['--win', '--x64']],
  ['darwin', ['--mac']],
]) {
  test(`desktop build selects the supported ${platform} host`, async (t) => {
    assert.ok(fs.existsSync(path.join(root, 'scripts/build-desktop.mjs')));
    const { directory, calls, run } = harness(t, platform);
    await run('build-desktop.mjs');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(calls[0].args, [
      path.join(directory, 'node_modules/vite/bin/vite.js'),
      'build',
    ]);
    assert.equal(calls[1].command, process.execPath);
    assert.deepEqual(calls[1].args, [
      path.join(directory, 'node_modules/electron-builder/cli.js'),
      ...target,
      '--dir',
      '--publish',
      'never',
    ]);
    assert.equal(calls[0].options.cwd, directory + path.sep);
    assert.equal(calls[1].options.cwd, directory + path.sep);
    assert.equal(calls[1].options.env.PALMDESK_BUILD_CHANNEL, 'local');
  });
}

test('desktop build rejects unsupported hosts before building', async (t) => {
  assert.ok(fs.existsSync(path.join(root, 'scripts/build-desktop.mjs')));
  const { calls, run } = harness(t, 'linux');
  await assert.rejects(run('build-desktop.mjs'), /supported.*macOS.*Windows/i);
  assert.equal(calls.length, 0);
});

test('desktop build stops if the renderer build fails', async (t) => {
  assert.ok(fs.existsSync(path.join(root, 'scripts/build-desktop.mjs')));
  const failure = new Error('Vite build failed');
  const { calls, run } = harness(t, 'win32', { failure });
  await assert.rejects(run('build-desktop.mjs'), (error) => error === failure);
  assert.equal(calls.length, 1);
});

test('an explicit Windows desktop build produces an unpublished x64 directory', async (t) => {
  const { calls, run } = harness(t, 'win32', { args: ['--win'] });
  await run('build-desktop.mjs');
  assert.deepEqual(calls[1].args.slice(1), [
    '--win',
    '--x64',
    '--dir',
    '--publish',
    'never',
  ]);
});

test('an explicit Windows desktop build rejects a macOS host before building', async (t) => {
  const { calls, run } = harness(t, 'darwin', { args: ['--win'] });
  await assert.rejects(run('build-desktop.mjs'), /matching.*host/i);
  assert.equal(calls.length, 0);
});

test('desktop build rejects unsupported arguments before invoking build tools', async (t) => {
  const { calls, run } = harness(t, 'win32', { args: ['--publish', 'always'] });
  await assert.rejects(run('build-desktop.mjs'), /Usage:/);
  assert.equal(calls.length, 0);
});

for (const [platform, requested, target] of [
  ['darwin', '--mac', ['--mac']],
  ['win32', '--win', ['--win', '--x64']],
]) {
  test(`installer build on ${platform} builds desktop code and leaves publishing to the caller`, async (t) => {
    const { calls, run } = harness(t, platform, {
      args: [requested, '--installer'],
    });
    await run('build-desktop.mjs');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.env.VITE_APP_RELEASE_PROJECT_ISWEB, 'false');
    assert.equal(calls[1].options.env.PALMDESK_BUILD_CHANNEL, 'local');
    assert.deepEqual(calls[1].args.slice(1), [...target, '--publish', 'never']);
  });
}

for (const installer of [false, true]) {
  test(`explicit release ${installer ? 'installers' : 'directories'} select the release identity`, async (t) => {
    const { calls, run } = harness(t, 'darwin', {
      args: ['--release', ...(installer ? ['--installer'] : [])],
    });
    await run('build-desktop.mjs');
    assert.equal(calls[1].options.env.PALMDESK_BUILD_CHANNEL, 'release');
    assert.equal(calls[1].args.includes('--dir'), !installer);
  });
}

test('local builds ignore an inherited release channel unless --release is passed', async (t) => {
  const previous = process.env.PALMDESK_BUILD_CHANNEL;
  t.after(() => {
    if (previous === undefined) delete process.env.PALMDESK_BUILD_CHANNEL;
    else process.env.PALMDESK_BUILD_CHANNEL = previous;
  });
  process.env.PALMDESK_BUILD_CHANNEL = 'release';
  const { calls, run } = harness(t, 'win32', { args: ['--installer'] });
  await run('build-desktop.mjs');
  assert.equal(calls[1].options.env.PALMDESK_BUILD_CHANNEL, 'local');
});

test('installer builds reject conflicting platforms before invoking build tools', async (t) => {
  const { calls, run } = harness(t, 'darwin', {
    args: ['--mac', '--win', '--installer'],
  });
  await assert.rejects(run('build-desktop.mjs'), /Usage:/);
  assert.equal(calls.length, 0);
});

test('installer builds reject a mismatched host before invoking build tools', async (t) => {
  const { calls, run } = harness(t, 'darwin', {
    args: ['--win', '--installer'],
  });
  await assert.rejects(run('build-desktop.mjs'), /matching.*host/i);
  assert.equal(calls.length, 0);
});

test('packaging includes the Windows helper as a resource without elevation', () => {
  const config = require('../../electron-builder.cjs');
  assert.deepEqual(config.win.extraFiles, [
    {
      from: 'native-bin/win-redist',
      to: '.',
      filter: ['*.dll'],
    },
  ]);
  assert.deepEqual(config.win.extraResources, [
    {
      from: 'native-bin/palmdesk-window.exe',
      to: 'native/palmdesk-window.exe',
    },
    {
      from: 'native-bin/win-redist',
      to: 'native',
      filter: ['*.dll'],
    },
  ]);
  assert.equal(config.win.requestedExecutionLevel, 'asInvoker');
  assert.deepEqual(config.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(config.nsis.perMachine, false);
  assert.deepEqual(config.mac.extraFiles, [
    { from: 'native-bin/codex-window', to: 'MacOS/codex-window' },
  ]);
});

test('the desktop package command delegates to host selection', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  assert.equal(
    manifest.scripts['build:desktop'],
    'node scripts/build-desktop.mjs'
  );
  assert.equal(
    manifest.scripts['build:desktop:win'],
    'node scripts/build-desktop.mjs --win'
  );
  assert.equal(
    manifest.scripts['dist:mac'],
    'node scripts/build-desktop.mjs --mac --installer'
  );
  assert.equal(
    manifest.scripts['dist:win'],
    'node scripts/build-desktop.mjs --win --installer'
  );
});

test(
  'the real Windows Framework compiler builds and runs a JSON helper from a path with spaces',
  { skip: process.platform !== 'win32' },
  (t) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'palmdesk compiler ')
    );
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.mkdirSync(path.join(directory, 'scripts'));
    fs.mkdirSync(path.join(directory, 'electron-main/native'), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(root, 'scripts/build-native.mjs'),
      path.join(directory, 'scripts/build-native.mjs')
    );
    fs.writeFileSync(
      path.join(directory, 'electron-main/native/palmdesk-window.cs'),
      `using System;
using System.Web.Script.Serialization;
class PackagingFixture {
  static void Main() {
    Console.WriteLine(new JavaScriptSerializer().Serialize(new { ready = true }));
  }
}
`
    );
    const options = {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 30_000,
    };
    childProcess.execFileSync(
      process.execPath,
      [path.join(directory, 'scripts/build-native.mjs')],
      options
    );
    const output = childProcess.execFileSync(
      path.join(directory, 'native-bin/palmdesk-window.exe'),
      [],
      options
    );
    assert.deepEqual(JSON.parse(output), { ready: true });
  }
);
