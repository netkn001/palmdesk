import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import {
  PRINT_LINK_EXIT,
  formatConnectionRecord,
  normalizeInstanceId,
  parsePrintLinkArgs,
  readConnectionRecord,
} from '../src/utils/host-identity';

import type { ConnectionRecord } from '../src/utils/host-identity';

// Aliyun ECS metadata; every cloned instance reports a distinct ID.
const DEFAULT_INSTANCE_ID_URL =
  'http://100.100.100.200/latest/meta-data/instance-id';

export function hostLinkSupported(platform: NodeJS.Platform) {
  return platform === 'win32';
}

export function connectionFilePath(env: NodeJS.ProcessEnv = process.env) {
  if (env.PALMDESK_CONNECTION_FILE) return env.PALMDESK_CONNECTION_FILE;
  const root = env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData';
  return path.join(root, 'PalmDesk', 'connection.json');
}

export function requestInstanceId(
  timeoutMs = 2000,
  url = process.env.PALMDESK_INSTANCE_ID_URL || DEFAULT_INSTANCE_ID_URL
) {
  return new Promise<string>((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        resolve('');
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 256) request.destroy();
      });
      response.on('end', () => resolve(normalizeInstanceId(body)));
      response.on('error', () => resolve(''));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(''));
  });
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Retries until the metadata service answers or the deadline passes. */
export async function resolveInstanceId(waitMs: number) {
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    const id = await requestInstanceId();
    if (id || Date.now() >= deadline) return id;
    await sleep(Math.min(2000, Math.max(0, deadline - Date.now())));
  }
}

export function writeConnectionRecord(
  record: ConnectionRecord,
  file = connectionFilePath()
) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}

export function loadConnectionRecord(file = connectionFilePath()) {
  try {
    return readConnectionRecord(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

function emit(stream: Pick<NodeJS.WritableStream, 'write'>, text: string) {
  return new Promise<void>((resolve) => {
    try {
      // GUI-subsystem builds may have no console attached; never throw here.
      stream.write(text, () => resolve());
    } catch {
      resolve();
    }
  });
}

type PrintLinkIo = Record<
  'stdout' | 'stderr',
  Pick<NodeJS.WritableStream, 'write'>
>;

/** `PalmDesk.exe --print-link [--json] [--timeout=秒] [--output=文件]` */
export async function runPrintLink(
  argv: readonly string[],
  platform: NodeJS.Platform,
  io: PrintLinkIo = { stdout: process.stdout, stderr: process.stderr }
) {
  let options: ReturnType<typeof parsePrintLinkArgs>;
  try {
    options = parsePrintLinkArgs(argv);
  } catch (error) {
    await emit(io.stderr, `${(error as Error).message}\n`);
    return PRINT_LINK_EXIT.failed;
  }
  if (!hostLinkSupported(platform)) {
    await emit(io.stderr, '--print-link 仅支持 Windows 主机\n');
    return PRINT_LINK_EXIT.failed;
  }
  const deadline = Date.now() + options.timeoutMs;
  const instanceId = await resolveInstanceId(options.timeoutMs);
  if (!instanceId) {
    await emit(io.stderr, '无法获取云实例 instance-id\n');
    return PRINT_LINK_EXIT.noIdentity;
  }
  let mismatched = false;
  for (;;) {
    const record = loadConnectionRecord();
    if (record?.instanceId === instanceId) {
      const text = formatConnectionRecord(record, options.json);
      if (options.output) {
        try {
          writeFileSync(options.output, text, 'utf8');
        } catch (error) {
          await emit(io.stderr, `${(error as Error).message}\n`);
          return PRINT_LINK_EXIT.failed;
        }
      }
      await emit(io.stdout, text);
      return PRINT_LINK_EXIT.ok;
    }
    // A record copied from the image template belongs to another instance.
    mismatched = Boolean(record);
    if (Date.now() >= deadline) break;
    await sleep(Math.min(1000, Math.max(0, deadline - Date.now())));
  }
  await emit(
    io.stderr,
    mismatched
      ? '连接信息属于其他实例，请确认本机 PalmDesk 已启动并完成登录\n'
      : '连接信息尚未就绪，请确认本机 PalmDesk 已启动并完成登录\n'
  );
  return mismatched ? PRINT_LINK_EXIT.mismatch : PRINT_LINK_EXIT.timeout;
}
