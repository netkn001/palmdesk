export function serviceDefaults(protocol: string, origin: string) {
  const publicOrigin = 'https://palmdesk-hk-test.ziniaocloud.com';
  return {
    api: protocol === 'file:' ? `${publicOrigin}/api` : '/api',
    signaling: protocol === 'file:' ? publicOrigin : origin,
    client: protocol === 'file:' ? `${publicOrigin}/` : '',
  };
}
