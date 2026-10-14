const { randomBytes, randomUUID } = require('node:crypto');
const { failure, hash, rateLimit } = require('./turn.cjs');

const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value);
const password = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;

function createDeskSessions({ io, redis, users, prefixes, ttl = 3600 }) {
  const active = new Map();
  const tokenTtl = ttl + 3600;
  const tokenKey = (token) => `palmdesk:session:${hash(token)}`;
  const socketFor = (id) => io.of('/').sockets.get(id);
  const clientIp = (socket) => socket.handshake.headers?.['x-real-ip'] || socket.handshake.address;

  async function end(id, reason = 'disconnect') {
    const session = active.get(id);
    if (!session) return;
    active.delete(id);
    for (const member of session.members) {
      const socket = socketFor(member.socketId);
      socket?.data.deskPeers?.delete(member.peerId);
      socket?.emit('billdDeskSessionEnded', { sessionId: id, peerId: member.peerId, reason });
    }
    await redis.del(session.members.flatMap((member) => [tokenKey(member.token), `palmdesk:ice:${id}:${member.socketId}`]));
  }

  function current(member) {
    const socket = socketFor(member.socketId);
    return socket?.connected && socket.data.desk?.device === member.device &&
      socket.data.deskPeers?.get(member.peerId) === member.id;
  }

  async function authorize(token) {
    const key = tokenKey(token);
    const value = await redis.get(key);
    const member = value ? JSON.parse(value) : null;
    const session = member && active.get(member.id);
    if (!session || !session.members.every(current) ||
        !session.members.some((entry) => entry.socketId === member.socketId && entry.token === token)) {
      throw failure(401, 'Remote session has ended');
    }
    await redis.expire(key, tokenTtl);
    return member;
  }

  async function publishDevice(socket) {
    if (!socket.connected || !socket.data.desk) return;
    const { device } = socket.data.desk;
    // Preserve the registry format used by the pinned upstream HTTP device routes.
    await redis.set(`${prefixes.deskUserUuid}${device}`, JSON.stringify({
      value: { socket_id: socket.id, deskUserUuid: device },
    }), { EX: 90 });
  }

  async function unpublishDevice(socket) {
    const device = socket.data.desk?.device;
    if (!device) return;
    const key = `${prefixes.deskUserUuid}${device}`;
    const value = await redis.get(key);
    if (!value) return;
    try {
      if (JSON.parse(value)?.value?.socket_id === socket.id) {
        await redis.del(key);
      }
    } catch {
      // Ignore malformed registry entries.
    }
  }

  async function join(socket, data) {
    await rateLimit(redis, 'join-ip', clientIp(socket), 30);
    if (!identifier(data.deskUserUuid) || !identifier(data.live_room_id) || !password(data.deskUserPassword) ||
        !await users.login({ uuid: data.deskUserUuid, password: data.deskUserPassword })) {
      throw failure(401, 'Device authentication failed');
    }
    if (socket.data.desk) throw failure(409, 'Device is already joined');
    if (!socket.connected) return;
    socket.data.desk = { device: data.deskUserUuid, roomId: data.live_room_id };
    socket.data.deskPeers = new Map();
    await publishDevice(socket);
    socket.emit('billdDeskJoined', { live_room_id: data.live_room_id });
  }

  async function start(socket, data) {
    await rateLimit(redis, 'start-ip', clientIp(socket), 30);
    const desk = socket.data.desk;
    if (!desk || data.deskUserUuid !== desk.device || data.roomId !== data.remoteDeskUserUuid ||
        data.roomId !== desk.roomId || !identifier(data.remoteDeskUserUuid) ||
        !password(data.deskUserPassword) || !password(data.remoteDeskUserPassword)) {
      throw failure(401, 'Invalid remote session');
    }
    await rateLimit(redis, 'start-device', desk.device, 12);
    if (!await users.login({ uuid: desk.device, password: data.deskUserPassword })) throw failure(401, 'Controller password is incorrect');
    if (!await users.login({ uuid: data.remoteDeskUserUuid, password: data.remoteDeskUserPassword })) {
      throw failure(403, 'Remote password is incorrect');
    }
    const value = await redis.get(`${prefixes.deskUserUuid}${data.remoteDeskUserUuid}`);
    const target = value && socketFor(JSON.parse(value).value.socket_id);
    if (!target?.connected || target === socket || target.data.desk?.device !== data.remoteDeskUserUuid) {
      throw failure(404, 'Remote device is offline');
    }
    if (!socket.connected) return;
    const previous = socket.data.deskPeers.get(target.id);
    let session = previous && active.get(previous);
    if (!session) {
      if (socket.data.deskPeers.size >= 8 || target.data.deskPeers.size >= 8) throw failure(429, 'Too many remote sessions');
      const id = randomUUID();
      session = {
        id,
        members: [socket, target].map((peer, index) => ({
          id, socketId: peer.id, peerId: index === 0 ? target.id : socket.id,
          device: peer.data.desk.device, offerer: index === 1,
          token: randomBytes(32).toString('base64url'),
        })),
        data: {
          sender: socket.id, receiver: target.id, roomId: data.roomId,
          deskUserUuid: desk.device, remoteDeskUserUuid: target.data.desk.device,
          maxBitrate: data.maxBitrate, maxFramerate: data.maxFramerate,
          resolutionRatio: data.resolutionRatio, audioContentHint: data.audioContentHint,
          videoContentHint: data.videoContentHint,
        },
      };
      await Promise.all(session.members.map(({ token, ...member }) =>
        redis.set(tokenKey(token), JSON.stringify(member), { EX: tokenTtl })
      ));
      if (!socket.connected || !target.connected) {
        await redis.del(session.members.map((member) => tokenKey(member.token)));
        return;
      }
      active.set(id, session);
      socket.data.deskPeers.set(target.id, id);
      target.data.deskPeers.set(socket.id, id);
    }
    for (const member of session.members) {
      socketFor(member.socketId)?.emit('billdDeskStartRemoteResult', {
        code: 0, msg: 'ok', data: session.data,
        session: { id: session.id, token: member.token, socketId: member.socketId, peerId: member.peerId, offerer: member.offerer },
      });
    }
  }

  function relay(socket, event, data) {
    const id = socket.data.deskPeers?.get(data.receiver);
    const session = id && active.get(id);
    if (!session || !session.members.every(current) || (data.sessionId && data.sessionId !== id)) return;
    const member = session.members.find((entry) => entry.socketId === socket.id);
    if ((event === 'nativeWebRtcOffer' && !member.offerer) ||
        (event === 'nativeWebRtcAnswer' && member.offerer) ||
        (event === 'nativeWebRtcRestart' && member.offerer)) return;
    socketFor(member.peerId).emit(event, {
      sender: socket.id, receiver: member.peerId, sessionId: id,
      live_room_id: session.data.roomId, isRemoteDesk: true,
      ...(event === 'nativeWebRtcOffer' || event === 'nativeWebRtcAnswer' ? { sdp: data.sdp, iceRestart: Boolean(data.iceRestart) } : {}),
      ...(event === 'nativeWebRtcCandidate' ? { candidate: data.candidate } : {}),
    });
  }

  function attach(socket) {
    let queue = Promise.resolve();
    const on = (event, action) => socket.on(event, (packet) => {
      queue = queue.then(() => action(packet.data)).catch((error) => {
        const message = error.status ? error.message : 'Remote service is temporarily unavailable';
        if (event === 'billdDeskStartRemote') {
          socket.emit('billdDeskStartRemoteResult', { code: error.status === 403 ? 3 : 1, msg: message });
        } else {
          socket.emit('billdDeskSessionError', { msg: message });
        }
      });
    });
    on('billdDeskJoin', (data) => join(socket, data));
    on('billdDeskStartRemote', (data) => start(socket, data));
    on('billdDeskUpdateUser', async (data) => {
      if (!socket.connected) return;
      if (!socket.data.desk && data?.deskUserUuid && data?.deskUserPassword) {
        await join(socket, {
          deskUserUuid: data.deskUserUuid,
          deskUserPassword: data.deskUserPassword,
          live_room_id: data.roomId || data.deskUserUuid,
        });
        return;
      }
      if (socket.data.desk) await publishDevice(socket);
    });
    on('heartbeat', async () => {
      if (socket.connected && socket.data.desk) await publishDevice(socket);
    });
    socket.conn?.on('heartbeat', () => {
      if (socket.connected && socket.data.desk) {
        queue = queue.then(() => publishDevice(socket)).catch(() => {});
      }
    });
    on('billdDeskEndRemote', (data) => {
      if (socket.data.deskPeers?.get(data.receiver) === data.sessionId) return end(data.sessionId, 'explicit');
    });
    for (const event of ['nativeWebRtcOffer', 'nativeWebRtcAnswer', 'nativeWebRtcCandidate', 'nativeWebRtcRestart']) {
      on(event, (data) => relay(socket, event, data));
    }
    socket.on('disconnect', () => {
      queue = queue.then(() => unpublishDevice(socket)).catch(() => {});
      for (const id of socket.data.deskPeers?.values() || []) {
        void end(id).catch(() => console.error('Session cleanup failed'));
      }
    });
  }
  return { attach, authorize, end };
}

module.exports = { createDeskSessions };
