// Machine identity for cloned hosts. Images duplicate the cached device
// credentials, so a cloud instance ID decides whether they still belong here.

export const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function normalizeInstanceId(value: unknown) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  return INSTANCE_ID_PATTERN.test(id) ? id : '';
}

export type CredentialAction =
  /** Keep the cached credentials. */
  | 'reuse'
  /** Discard cached credentials and request new ones. */
  | 'recreate'
  /** A cloud host cannot prove its identity yet; do not go online. */
  | 'wait';

export function decideCredentialAction(input: {
  currentInstanceId: string;
  recordedInstanceId: string;
  hasCredentials: boolean;
}): CredentialAction {
  const current = normalizeInstanceId(input.currentInstanceId);
  const recorded = normalizeInstanceId(input.recordedInstanceId);
  if (!current) return recorded ? 'wait' : 'reuse';
  if (!input.hasCredentials) return 'recreate';
  // Credentials cached before identities were recorded may come from an image.
  return recorded === current ? 'reuse' : 'recreate';
}

export interface ConnectionRecord {
  instanceId: string;
  device: string;
  password: string;
  url: string;
  updatedAt: string;
}

export function readConnectionRecord(value: unknown): ConnectionRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const fields = ['instanceId', 'device', 'password', 'url', 'updatedAt'];
  if (fields.some((key) => typeof record[key] !== 'string' || !record[key]))
    return null;
  if (!normalizeInstanceId(record.instanceId)) return null;
  return {
    instanceId: record.instanceId as string,
    device: record.device as string,
    password: record.password as string,
    url: record.url as string,
    updatedAt: record.updatedAt as string,
  };
}

export interface PrintLinkOptions {
  json: boolean;
  timeoutMs: number;
  output: string;
}

export const PRINT_LINK_FLAG = '--print-link';
export const DEFAULT_PRINT_LINK_TIMEOUT_MS = 60_000;

export function isPrintLinkInvocation(argv: readonly string[]) {
  return argv.includes(PRINT_LINK_FLAG);
}

export function parsePrintLinkArgs(argv: readonly string[]): PrintLinkOptions {
  const options: PrintLinkOptions = {
    json: false,
    timeoutMs: DEFAULT_PRINT_LINK_TIMEOUT_MS,
    output: '',
  };
  argv.forEach((arg) => {
    if (arg === '--json') options.json = true;
    else if (arg.startsWith('--timeout=')) {
      const seconds = Number(arg.slice('--timeout='.length));
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600)
        throw new Error('--timeout 必须是 0 到 3600 之间的秒数');
      options.timeoutMs = Math.round(seconds * 1000);
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      if (!options.output) throw new Error('--output 需要文件路径');
    }
  });
  return options;
}

export function formatConnectionRecord(
  record: ConnectionRecord,
  json: boolean
) {
  return json ? `${JSON.stringify(record)}\n` : `${record.url}\n`;
}

export const PRINT_LINK_EXIT = {
  ok: 0,
  failed: 1,
  timeout: 2,
  mismatch: 3,
  noIdentity: 4,
} as const;
