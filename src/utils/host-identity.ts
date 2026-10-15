// Machine identity for cloned hosts. Images duplicate the cached device
// credentials, so a cloud instance ID decides whether they still belong here.

export const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Sanitizes a Windows username to ensure safe ASCII characters matching INSTANCE_ID_PATTERN.
 * Preserves alphanumeric, '.', '_', '-'.
 * If characters outside [A-Za-z0-9._-] are present, replaces them and appends a 6-character hash
 * of the original username to prevent collisions.
 */
export function sanitizeUsername(username: unknown): string {
  if (typeof username !== 'string') return '';
  const trimmed = username.trim();
  if (!trimmed) return '';
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(trimmed)) {
    return trimmed;
  }
  const hasSpecial = /[^A-Za-z0-9._-]/.test(trimmed);
  let cleaned = trimmed.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_{2,}/g, '_');
  if (!/^[A-Za-z0-9]/.test(cleaned)) {
    cleaned = `u_${cleaned}`.replace(/_{2,}/g, '_');
  }
  if (hasSpecial) {
    const hash = hashString(trimmed).slice(0, 6);
    cleaned = `${cleaned.slice(0, 32)}_${hash}`;
  }
  return cleaned.slice(0, 48);
}

/**
 * Combines cloud instance ID with Windows username on Windows platforms.
 * Returns empty string if instanceId is empty.
 * Returns normalized instanceId unchanged on non-Windows platforms.
 */
export function composeHostInstanceId(
  instanceId: unknown,
  username?: unknown,
  platform = typeof process !== 'undefined' ? process.platform : ''
): string {
  const normalized = normalizeInstanceId(instanceId);
  if (!normalized) return '';
  if (platform !== 'win32') return normalized;
  const user = sanitizeUsername(username);
  if (!user) return normalized;
  const composite = `${normalized}_${user}`;
  return normalizeInstanceId(composite);
}

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
  fullScreen: boolean;
  timeoutMs: number;
  output: string;
  user: string;
}

export const PRINT_LINK_FLAG = '--print-link';
export const DEFAULT_PRINT_LINK_TIMEOUT_MS = 60_000;

export function isPrintLinkInvocation(argv: readonly string[]) {
  return argv.includes(PRINT_LINK_FLAG);
}

export function parsePrintLinkArgs(argv: readonly string[]): PrintLinkOptions {
  const options: PrintLinkOptions = {
    json: false,
    fullScreen: false,
    timeoutMs: DEFAULT_PRINT_LINK_TIMEOUT_MS,
    output: '',
    user: '',
  };
  argv.forEach((arg) => {
    if (arg === '--json') options.json = true;
    else if (arg === '--full-screen') options.fullScreen = true;
    else if (arg.startsWith('--timeout=')) {
      const seconds = Number(arg.slice('--timeout='.length));
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600)
        throw new Error('--timeout 必须是 0 到 3600 之间的秒数');
      options.timeoutMs = Math.round(seconds * 1000);
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      if (!options.output) throw new Error('--output 需要文件路径');
    } else if (arg.startsWith('--user=')) {
      options.user = arg.slice('--user='.length).trim();
      if (!options.user) throw new Error('--user 需要指定用户名');
    }
  });
  return options;
}

export function withFullScreenInvite(url: string): string {
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0) return url;
  const base = url.slice(0, hashIndex);
  const hash = url.slice(hashIndex + 1);
  const [route, query = ''] = hash.split('?');
  const params = new URLSearchParams(query);
  params.set('fullScreen', '1');
  return `${base}#${route}?${params.toString()}`;
}

export function formatConnectionRecord(
  record: ConnectionRecord,
  json: boolean,
  fullScreen = false
) {
  const outputRecord = fullScreen
    ? { ...record, url: withFullScreenInvite(record.url) }
    : record;
  return json ? `${JSON.stringify(outputRecord)}\n` : `${outputRecord.url}\n`;
}

export const PRINT_LINK_EXIT = {
  ok: 0,
  failed: 1,
  timeout: 2,
  mismatch: 3,
  noIdentity: 4,
} as const;

