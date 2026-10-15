const assert = require('node:assert/strict');
const { test } = require('node:test');
const loadSource = require('./load-source.cjs');

const { createConnectionInvite, normalizeClientUrl, parseConnectionInvite } =
  loadSource('src/utils/connection-invite.ts');

test('invitations round-trip reserved characters through fragments', () => {
  const link = createConnectionInvite(
    'https://remote.example.com/client/#/remote',
    'AB1234cd',
    'a+&#?= 9'
  );
  const url = new URL(link);
  assert.equal(url.search, '');
  assert.equal(url.pathname, '/client/');
  assert.deepEqual(parseConnectionInvite(link), {
    url: link,
    device: 'AB1234cd',
    password: 'a+&#?= 9',
  });

  const fullScreenLink = createConnectionInvite(
    'https://remote.example.com/client/#/remote',
    'AB1234cd',
    'a+&#?= 9',
    { fullScreen: true }
  );
  assert.ok(fullScreenLink.includes('fullScreen=1'));
  assert.deepEqual(parseConnectionInvite(fullScreenLink), {
    url: fullScreenLink,
    device: 'AB1234cd',
    password: 'a+&#?= 9',
    fullScreen: true,
  });
});

test('host addresses accept deployed and LAN clients without inventing an address', () => {
  assert.equal(
    normalizeClientUrl(' http://192.168.1.8:5173/ '),
    'http://192.168.1.8:5173/'
  );
  assert.equal(
    normalizeClientUrl('https://remote.example.com/#/'),
    'https://remote.example.com/'
  );
  for (const value of [
    '',
    '/client/',
    'file:///app/index.html',
    'javascript:alert(1)',
    'http://localhost:5173',
    'http://localhost.:5173',
    'http://client.localhost',
    'http://127.2.3.4:5173',
    'http://2130706433',
    'http://0.0.0.0:5173',
    'http://[::1]:5173',
    'http://[::]:5173',
    'http://[::ffff:127.0.0.1]',
    'https://user:secret@remote.example.com',
    'https://remote.example.com/?password=secret',
    'https://remote.example.com/#/webrtc',
    `https://remote.example.com/${'a'.repeat(512)}`,
  ])
    assert.throws(() => normalizeClientUrl(value), value);
});

test('scanner rejects unrelated codes, malformed payloads and ambiguous credentials', () => {
  const valid = createConnectionInvite(
    'https://remote.example.com/',
    '12345678',
    'secret99'
  );
  const invalid = [
    'random QR data',
    'https://example.com/',
    'javascript:alert(1)',
    valid.replace('/remote?', '/webrtc?'),
    valid.replace('connect=1', 'connect=2'),
    valid.replace('device=12345678', 'device=short'),
    valid.replace('password=secret99', 'password=short'),
    valid.replace('password=secret99', 'password=' + 'a'.repeat(13)),
    valid.replace('password=secret99', ''),
    valid + '&password=another9',
    valid + '&device=87654321',
    valid + '&redirect=https://example.com',
    valid + '#unexpected',
    valid.replace('/#/remote', '/?password=secret99#/remote'),
    valid.replace('#/remote', '#//example.com/remote'),
  ];
  for (const value of invalid)
    assert.throws(() => parseConnectionInvite(value), value);
});

test('changing credentials replaces the invitation', () => {
  const oldLink = createConnectionInvite(
    'https://remote.example.com',
    '12345678',
    'oldpass9'
  );
  const newLink = createConnectionInvite(
    'https://remote.example.com',
    '87654321',
    'newpass9'
  );
  assert.notEqual(oldLink, newLink);
  assert.equal(parseConnectionInvite(newLink).device, '87654321');
  assert.equal(parseConnectionInvite(newLink).password, 'newpass9');
  assert.ok(!newLink.includes('oldpass9'));
});
