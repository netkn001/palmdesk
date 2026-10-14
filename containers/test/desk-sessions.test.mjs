import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeskSessions } from '../backend/runtime/desk-sessions.cjs';
import { MemoryRedis, TestSocket } from './fixtures.mjs';

async function fixture() {
  const redis = new MemoryRedis();
  const sockets = new Map();
  const users = { login: async ({ uuid, password }) => password === `pw-${uuid}` ? { uuid } : null };
  const sessions = createDeskSessions({ io: { of: () => ({ sockets }) }, redis, users,
    prefixes: { deskUserUuid: 'desk:' } });
  async function socket(id, device) {
    const peer = new TestSocket(id);
    sockets.set(id, peer);
    sessions.attach(peer);
    if (device) await peer.receive('billdDeskJoin', { deskUserUuid: device, deskUserPassword: `pw-${device}`, live_room_id: 'target01' });
    return peer;
  }
  const host = await socket('host-socket', 'target01');
  const phone = await socket('phone-socket', 'phone001');
  const outsider = await socket('outsider-socket', 'stranger');
  const start = {
    deskUserUuid: 'phone001', deskUserPassword: 'pw-phone001', remoteDeskUserUuid: 'target01',
    remoteDeskUserPassword: 'pw-target01', roomId: 'target01', sender: 'forged-sender', receiver: 'outsider-socket',
  };
  return { redis, sessions, socket, host, phone, outsider, start };
}

test('join authenticates devices and heartbeat cannot impersonate another device', async () => {
  const { socket, redis, phone } = await fixture();
  const attacker = await socket('attacker-socket');
  await attacker.receive('billdDeskJoin', { deskUserUuid: 'target01', deskUserPassword: 'wrong', live_room_id: 'target01' });
  assert.ok(attacker.last('billdDeskSessionError'));
  assert.equal(attacker.last('billdDeskJoined'), undefined);
  await phone.receive('billdDeskUpdateUser', { deskUserUuid: 'target01', deskUserPassword: 'fake' });
  assert.equal(JSON.parse(await redis.get('desk:target01')).value.socket_id, 'host-socket');
  assert.ok(!JSON.stringify([...redis.rows.values()]).includes('pw-'));
});

test('successful sessions are private, password-free and bound to actual sockets', async () => {
  const { sessions, host, phone, outsider, start } = await fixture();
  await phone.receive('billdDeskStartRemote', { ...start, remoteDeskUserPassword: 'wrong' });
  assert.equal(phone.last('billdDeskStartRemoteResult').code, 3);
  assert.equal(host.last('billdDeskStartRemoteResult'), undefined);
  await phone.receive('billdDeskStartRemote', start);
  const a = host.last('billdDeskStartRemoteResult');
  const b = phone.last('billdDeskStartRemoteResult');
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  assert.equal(a.data.sender, phone.id);
  assert.equal(a.data.receiver, host.id);
  assert.equal(outsider.last('billdDeskStartRemoteResult'), undefined);
  assert.notEqual(a.session.token, b.session.token);
  assert.equal(a.session.offerer, true);
  assert.equal(b.session.offerer, false);
  assert.ok(!JSON.stringify(a).includes('pw-'));
  assert.equal((await sessions.authorize(a.session.token)).socketId, host.id);
  assert.equal((await sessions.authorize(b.session.token)).socketId, phone.id);
  await assert.rejects(sessions.authorize('unknown-token'), { status: 401 });
  await phone.receive('billdDeskStartRemote', start);
  assert.equal(phone.last('billdDeskStartRemoteResult').session.id, b.session.id);
});

test('signaling cannot cross sessions, spoof senders or start simultaneous offers', async () => {
  const { host, phone, outsider, start } = await fixture();
  await phone.receive('billdDeskStartRemote', start);
  const id = phone.last('billdDeskStartRemoteResult').session.id;
  await outsider.receive('nativeWebRtcOffer', { receiver: phone.id, sessionId: id, sdp: { type: 'offer' } });
  assert.equal(phone.last('nativeWebRtcOffer'), undefined);
  await phone.receive('nativeWebRtcOffer', { receiver: host.id, sessionId: id, sdp: { type: 'offer' } });
  assert.equal(host.last('nativeWebRtcOffer'), undefined);
  await host.receive('nativeWebRtcOffer', { sender: outsider.id, receiver: phone.id, sessionId: id, sdp: { type: 'offer', sdp: 'test' } });
  assert.equal(phone.last('nativeWebRtcOffer').sender, host.id);
  assert.equal(phone.last('nativeWebRtcOffer').sessionId, id);
  await host.receive('nativeWebRtcCandidate', { receiver: phone.id, sessionId: 'old-session', candidate: {} });
  assert.equal(phone.last('nativeWebRtcCandidate'), undefined);
  await phone.receive('nativeWebRtcRestart', { receiver: host.id, sessionId: id });
  assert.equal(host.last('nativeWebRtcRestart').sender, phone.id);
});

test('ending or disconnecting a session invalidates both access tokens immediately', async () => {
  for (const disconnect of [false, true]) {
    const { sessions, host, phone, outsider, start } = await fixture();
    await phone.receive('billdDeskStartRemote', start);
    const a = host.last('billdDeskStartRemoteResult').session;
    const b = phone.last('billdDeskStartRemoteResult').session;
    await outsider.receive('billdDeskEndRemote', { receiver: host.id, sessionId: a.id });
    await sessions.authorize(a.token);
    if (disconnect) await phone.disconnect();
    else await phone.receive('billdDeskEndRemote', { receiver: host.id, sessionId: a.id });
    for (const token of [a.token, b.token]) await assert.rejects(sessions.authorize(token), { status: 401 });
    assert.equal(host.last('billdDeskSessionEnded').sessionId, a.id);
    assert.equal(
      host.last('billdDeskSessionEnded').reason,
      disconnect ? 'disconnect' : 'explicit'
    );
  }
});

test('device presence stays alive on Engine.IO heartbeats, self-heals via updateUser, and cleans up on disconnect', async () => {
  const { socket, redis, host } = await fixture();
  redis.clock += 50_000;
  await host.receiveConn('heartbeat');
  redis.clock += 50_000;
  assert.equal(JSON.parse(await redis.get('desk:target01')).value.socket_id, 'host-socket');

  const unjoined = await socket('unjoined-socket');
  await unjoined.receive('billdDeskUpdateUser', {
    deskUserUuid: 'target02',
    deskUserPassword: 'wrong',
    roomId: 'target02',
  });
  assert.equal(await redis.get('desk:target02'), null);
  await unjoined.receive('billdDeskUpdateUser', {
    deskUserUuid: 'target02',
    deskUserPassword: 'pw-target02',
    roomId: 'target02',
  });
  assert.equal(JSON.parse(await redis.get('desk:target02')).value.socket_id, 'unjoined-socket');

  const replacement = await socket('replacement-socket', 'target01');
  assert.equal(JSON.parse(await redis.get('desk:target01')).value.socket_id, 'replacement-socket');
  await host.disconnect();
  assert.equal(JSON.parse(await redis.get('desk:target01')).value.socket_id, 'replacement-socket');
  await replacement.disconnect();
  assert.equal(await redis.get('desk:target01'), null);
});
