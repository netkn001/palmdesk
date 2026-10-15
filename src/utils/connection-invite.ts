export interface ConnectionInvite {
  url: string;
  device: string;
  password: string;
  fullScreen?: boolean;
}

function readWebUrl(value: string) {
  if (!value || value.length > 2048) throw new Error('连接地址无效');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请输入完整的 HTTP 或 HTTPS 网页地址');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('请输入不含登录信息的 HTTP 或 HTTPS 网页地址');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^127\./.test(hostname) ||
    ['0.0.0.0', '[::]', '[::1]'].includes(hostname) ||
    hostname.startsWith('[::ffff:7f')
  ) {
    throw new Error('手机无法访问本机回环地址，请填写局域网 IP 或域名');
  }
  return url;
}

export function normalizeClientUrl(value: string) {
  if (value.trim().length > 512) throw new Error('手机网页地址过长');
  const url = readWebUrl(value.trim());
  if (url.search || !['', '#/', '#/remote'].includes(url.hash)) {
    throw new Error('请填写客户端首页地址，不要包含查询参数或连接信息');
  }
  url.hash = '';
  return url.href;
}

function validateCredentials(device: string, password: string) {
  if (!/^[a-zA-Z0-9]{8}$/.test(device)) {
    throw new Error('二维码中的设备代码无效');
  }
  if (password.length < 6 || password.length > 12) {
    throw new Error('二维码中的临时密码无效');
  }
}

export function createConnectionInvite(
  clientUrl: string,
  device: string,
  password: string,
  options?: { fullScreen?: boolean }
) {
  const url = new URL(normalizeClientUrl(clientUrl));
  validateCredentials(device, password);
  const params = new URLSearchParams({
    connect: '1',
    device,
    password,
  });
  if (options?.fullScreen) {
    params.set('fullScreen', '1');
  }
  // Fragments are not sent in HTTP requests or Referer headers.
  url.hash = `/remote?${params}`;
  return url.href;
}

export function parseConnectionInvite(value: string): ConnectionInvite {
  const url = readWebUrl(value.trim());
  const route = new URL(url.hash.slice(1), 'https://route.invalid');
  const params = route.searchParams;
  const fullScreenValues = params.getAll('fullScreen');
  if (
    url.search ||
    route.origin !== 'https://route.invalid' ||
    route.pathname !== '/remote' ||
    route.hash ||
    params.get('connect') !== '1' ||
    fullScreenValues.length > 1 ||
    (fullScreenValues.length === 1 && fullScreenValues[0] !== '1') ||
    [...params.keys()].length !== 3 + fullScreenValues.length ||
    ['connect', 'device', 'password'].some(
      (key) => params.getAll(key).length !== 1
    )
  ) {
    throw new Error('这不是有效的 Codex Remote 连接二维码');
  }
  const fullScreen = fullScreenValues[0] === '1';
  const device = params.get('device')!;
  const password = params.get('password')!;
  validateCredentials(device, password);
  url.hash = '';
  return {
    url: createConnectionInvite(url.href, device, password, { fullScreen }),
    device,
    password,
    ...(fullScreen ? { fullScreen: true } : {}),
  };
}

