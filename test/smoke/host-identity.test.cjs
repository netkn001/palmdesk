const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const loadSource = require('./load-source.cjs');

const {
  decideCredentialAction,
  normalizeInstanceId,
  parsePrintLinkArgs,
  readConnectionRecord,
  formatConnectionRecord,
  isPrintLinkInvocation,
  PRINT_LINK_EXIT,
} = loadSource('src/utils/host-identity.ts');

const record = (extra = {}) => ({
  instanceId: 'i-bp1abc',
  device: 'AB1234cd',
  password: 'secret99',
  url: 'https://remote.example.com/#/remote?connect=1&device=AB1234cd&password=secret99',
  updatedAt: '2026-10-09T10:00:00.000Z',
  ...extra,
});

test('cloned credentials are replaced when the cloud instance changes', () => {
  const decide = (
    currentInstanceId,
    recordedInstanceId,
    hasCredentials = true
  ) =>
    decideCredentialAction({
      currentInstanceId,
      recordedInstanceId,
      hasCredentials,
    });
  assert.equal(decide('i-1', 'i-1'), 'reuse');
  assert.equal(decide('i-2', 'i-1'), 'recreate');
  // Profiles from before identities were recorded may come from an image.
  assert.equal(decide('i-1', ''), 'recreate');
  assert.equal(decide('i-1', 'i-1', false), 'recreate');
  // A cloud host that cannot prove its identity must not reuse credentials.
  assert.equal(decide('', 'i-1'), 'wait');
  // Non-cloud hosts and development builds keep today's behaviour.
  assert.equal(decide('', ''), 'reuse');
  assert.equal(decide('', '', false), 'reuse');
});

test('instance IDs reject metadata error pages and whitespace', () => {
  assert.equal(normalizeInstanceId(' i-bp1abc\n'), 'i-bp1abc');
  assert.equal(normalizeInstanceId('<html>404</html>'), '');
  assert.equal(normalizeInstanceId(''), '');
  assert.equal(normalizeInstanceId(42), '');
});

test('print-link arguments', () => {
  assert.equal(isPrintLinkInvocation(['PalmDesk.exe', '--print-link']), true);
  assert.equal(isPrintLinkInvocation(['PalmDesk.exe']), false);
  assert.deepEqual(parsePrintLinkArgs(['x', '--print-link']), {
    json: false,
    timeoutMs: 60000,
    output: '',
  });
  assert.deepEqual(
    parsePrintLinkArgs([
      '--print-link',
      '--json',
      '--timeout=5',
      '--output=C:\\a.txt',
    ]),
    { json: true, timeoutMs: 5000, output: 'C:\\a.txt' }
  );
  assert.throws(() => parsePrintLinkArgs(['--timeout=abc']));
  assert.throws(() => parsePrintLinkArgs(['--timeout=-1']));
  assert.throws(() => parsePrintLinkArgs(['--output=']));
});

test('connection records are validated and formatted', () => {
  assert.deepEqual(readConnectionRecord(record()), record());
  assert.equal(readConnectionRecord(record({ instanceId: '' })), null);
  assert.equal(readConnectionRecord(record({ password: 1 })), null);
  assert.equal(readConnectionRecord(null), null);
  assert.equal(formatConnectionRecord(record(), false), `${record().url}\n`);
  assert.deepEqual(
    JSON.parse(formatConnectionRecord(record(), true)),
    record()
  );
});

async function withMetadata(instanceId, run) {
  const server = http.createServer((_req, res) => {
    if (!instanceId) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.end(instanceId);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palmdesk-link-'));
  const previous = {
    url: process.env.PALMDESK_INSTANCE_ID_URL,
    file: process.env.PALMDESK_CONNECTION_FILE,
  };
  process.env.PALMDESK_INSTANCE_ID_URL = `http://127.0.0.1:${server.address().port}/`;
  process.env.PALMDESK_CONNECTION_FILE = path.join(
    dir,
    'PalmDesk',
    'connection.json'
  );
  try {
    const hostLink = loadSource('electron-main/host-link.ts');
    await run(hostLink, dir);
  } finally {
    process.env.PALMDESK_INSTANCE_ID_URL = previous.url;
    process.env.PALMDESK_CONNECTION_FILE = previous.file;
    if (previous.url === undefined) delete process.env.PALMDESK_INSTANCE_ID_URL;
    if (previous.file === undefined)
      delete process.env.PALMDESK_CONNECTION_FILE;
    fs.rmSync(dir, { recursive: true, force: true });
    server.close();
  }
}

function sink() {
  const chunks = [];
  return {
    write(text, callback) {
      chunks.push(String(text));
      if (typeof callback === 'function') callback();
      return true;
    },
    text: () => chunks.join(''),
  };
}

const io = () => ({ stdout: sink(), stderr: sink() });

test('print-link prints the published link for this instance', async () => {
  await withMetadata('i-bp1abc', async (hostLink, dir) => {
    hostLink.writeConnectionRecord(record());
    const out = io();
    let code = await hostLink.runPrintLink(
      ['--print-link', '--timeout=1'],
      'win32',
      out
    );
    assert.equal(code, PRINT_LINK_EXIT.ok);
    assert.equal(out.stdout.text(), `${record().url}\n`);

    const output = path.join(dir, 'out.json');
    const json = io();
    code = await hostLink.runPrintLink(
      ['--print-link', '--json', '--timeout=1', `--output=${output}`],
      'win32',
      json
    );
    assert.deepEqual(JSON.parse(json.stdout.text()), record());
    assert.equal(code, PRINT_LINK_EXIT.ok);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), record());
  });
});

test('print-link refuses records copied from another instance', async () => {
  await withMetadata('i-clone', async (hostLink) => {
    hostLink.writeConnectionRecord(record());
    const code = await hostLink.runPrintLink(
      ['--print-link', '--timeout=0.2'],
      'win32',
      io()
    );
    assert.equal(code, PRINT_LINK_EXIT.mismatch);
  });
});

test('print-link reports missing records and identity', async () => {
  await withMetadata('i-bp1abc', async (hostLink) => {
    const code = await hostLink.runPrintLink(
      ['--print-link', '--timeout=0.2'],
      'win32',
      io()
    );
    assert.equal(code, PRINT_LINK_EXIT.timeout);
  });
  await withMetadata('', async (hostLink) => {
    const code = await hostLink.runPrintLink(
      ['--print-link', '--timeout=0'],
      'win32',
      io()
    );
    assert.equal(code, PRINT_LINK_EXIT.noIdentity);
  });
  await withMetadata('i-bp1abc', async (hostLink) => {
    const code = await hostLink.runPrintLink(['--print-link'], 'darwin', io());
    assert.equal(code, PRINT_LINK_EXIT.failed);
  });
});
