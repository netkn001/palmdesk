import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function exerciseQrConnection({
  host,
  phone,
  device,
  base,
  artifacts,
  pass,
}) {
  await host.getByLabel('设置手机网页地址').click();
  await host
    .getByLabel('手机网页地址', { exact: true })
    .fill('http://localhost:5173/');
  await host.getByRole('button', { name: '保存并重新连接' }).click();
  await host.getByRole('alert').filter({ hasText: '回环地址' }).waitFor();
  await host.getByLabel('手机网页地址', { exact: true }).fill(base);
  await Promise.all([
    host.waitForNavigation(),
    host.getByRole('button', { name: '保存并重新连接' }).click(),
  ]);
  await host.getByRole('button', { name: '显示二维码', exact: true }).click();
  await host.locator('.connection-qr canvas').waitFor();
  await host.screenshot({ path: path.join(artifacts, 'host-qr.png') });
  const readQr = () =>
    host.evaluate(async () => {
      const { default: QrScanner } = await import(
        '/node_modules/qr-scanner/qr-scanner.min.js'
      );
      return (
        await QrScanner.scanImage(
          document.querySelector('.connection-qr canvas'),
          {
            returnDetailedScanResult: true,
          }
        )
      ).data;
    });
  const originalLink = await readQr();
  assert.ok(originalLink.includes('connect=1'));
  assert.equal(new URL(originalLink).search, '');
  pass('host validates phone addresses and renders a decodable QR invitation');

  const waitConnected = async () => {
    await phone.waitForURL('**/webrtc');
    const windowOption = phone.getByRole('button', {
      name: '打开 Codex',
      exact: true,
    });
    await windowOption.waitFor({ timeout: 25000 });
    assert.equal(await phone.locator('video').count(), 0);
    assert.equal(await host.evaluate(() => !!window.__smoke.sessionId), false);
    await windowOption.click();
    await phone.waitForFunction(
      () =>
        document.querySelector('video')?.readyState >= 2 &&
        document.querySelector('.status.online'),
      undefined,
      { timeout: 25000 }
    );
    assert.ok(!phone.url().includes('password'));
  };
  const disconnect = async () => {
    await phone.getByLabel('断开并返回').click();
    await host.waitForFunction(() =>
      window.__smoke.streams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === 'ended')
      )
    );
    await phone.getByLabel('扫码连接', { exact: true }).waitFor();
  };
  const verifyRequests = [];
  const listener = (request) => {
    if (request.url().endsWith('/desk_user/link_verify'))
      verifyRequests.push(request);
  };
  phone.on('request', listener);
  const invalidLink = `${originalLink}&password=duplicate`;
  await phone.goto(invalidLink);
  await phone.locator('.connection-error').waitFor();
  await phone.waitForFunction(() => !location.hash.includes('password'));
  assert.equal(verifyRequests.length, 0);
  pass('malformed invitations are rejected and removed from browser history');

  await phone.goto(originalLink);
  await waitConnected();
  assert.equal(verifyRequests.length, 1);
  await disconnect();
  await phone.reload();
  await phone.getByLabel('扫码连接', { exact: true }).waitFor();
  assert.equal(verifyRequests.length, 1);
  pass(
    'opening a QR link automatically connects once and does not reconnect on return or reload'
  );

  // Device passwords are permanent; there is no rotation control.
  assert.equal(await host.locator('.info-right .edit').count(), 0);
  await host.getByRole('button', { name: '显示二维码', exact: true }).click();
  await host.locator('.connection-qr canvas').waitFor();
  const currentLink = await readQr();
  assert.equal(currentLink, originalLink);
  pass('the host offers no password rotation and keeps a stable QR link');

  await phone.route('**/desk_user/find_receiver_by_uuid*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 200, data: { receiver: '' } }),
    })
  );
  await phone.goto(currentLink);
  await phone.getByRole('alert').filter({ hasText: '不在线' }).waitFor();
  assert.equal(await phone.locator('.remote-device .btn').isDisabled(), false);
  await phone.unroute('**/desk_user/find_receiver_by_uuid*');
  await phone.route('**/desk_user/link_verify', (route) => route.abort());
  await phone.goto(currentLink);
  await phone
    .locator('.connection-error')
    .filter({ hasText: '连接失败' })
    .waitFor();
  assert.equal(await phone.locator('.remote-device .btn').isDisabled(), false);
  await phone.unroute('**/desk_user/link_verify');
  pass(
    'offline devices and verification failures release the connection controls for retry'
  );

  await phone.getByLabel('扫码连接', { exact: true }).click();
  await phone.getByRole('alert').filter({ hasText: 'HTTPS' }).waitFor();
  const blankImage = await phone.evaluate(() =>
    document.createElement('canvas').toDataURL()
  );
  await phone.getByLabel('二维码图片', { exact: true }).setInputFiles({
    name: 'blank.png',
    mimeType: 'image/png',
    buffer: Buffer.from(blankImage.split(',')[1], 'base64'),
  });
  await phone
    .getByRole('alert')
    .filter({ hasText: '未识别到二维码' })
    .waitFor();
  const qrImage = await host.locator('.qr-image').screenshot();
  await writeFile(path.join(artifacts, 'connection-code.png'), qrImage);
  await phone.screenshot({
    path: path.join(artifacts, 'mobile-qr-fallback.png'),
  });
  await phone.getByLabel('二维码图片', { exact: true }).setInputFiles({
    name: 'connection.png',
    mimeType: 'image/png',
    buffer: qrImage,
  });
  await waitConnected();
  await disconnect();
  pass(
    'HTTP clients provide image decoding, reject empty images, and connect from the host QR screenshot'
  );

  // The camera alone is synthetic; production scanning, decoding and networking run normally.
  const qrData = `data:image/png;base64,${qrImage.toString('base64')}`;
  await phone.evaluate(() => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('Denied fixture', 'NotAllowedError');
        },
        enumerateDevices: async () => [],
      },
    });
  });
  await phone.getByLabel('扫码连接', { exact: true }).click();
  await phone.getByRole('alert').filter({ hasText: '无法打开相机' }).waitFor();
  await phone.getByLabel('关闭扫码', { exact: true }).click();
  pass('denied camera access presents a recoverable scanner state');

  await phone.evaluate(async (imageData) => {
    const source = new Image();
    source.src = imageData;
    await source.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    window.__camera = { streams: [], enabled: false, ready: false };
    let frame = 0;
    const draw = () => {
      ctx.fillStyle = '#ced8d2';
      ctx.fillRect(0, 0, 720, 720);
      ctx.fillStyle = '#167c65';
      ctx.fillRect(30 + (frame++ % 30), 30, 140, 80);
      ctx.fillStyle = '#b43e4e';
      ctx.fillRect(540, 540, 140, 80);
      if (window.__camera.enabled) ctx.drawImage(source, 150, 150, 420, 420);
    };
    const timer = setInterval(draw, 80);
    addEventListener('beforeunload', () => clearInterval(timer), {
      once: true,
    });
    navigator.mediaDevices.getUserMedia = async () => {
      draw();
      const stream = canvas.captureStream(12);
      window.__camera.streams.push(stream);
      return stream;
    };
    window.__camera.ready = true;
  }, qrData);
  await phone.getByLabel('扫码连接', { exact: true }).click();
  await phone.waitForFunction(
    () => document.querySelector('.camera-preview video')?.readyState >= 2
  );
  await phone.getByLabel('关闭扫码', { exact: true }).click();
  await phone.waitForFunction(() =>
    window.__camera.streams.every((stream) =>
      stream.getTracks().every((track) => track.readyState === 'ended')
    )
  );
  await phone.getByLabel('扫码连接', { exact: true }).click();
  await phone.waitForFunction(
    () => document.querySelector('.camera-preview video')?.readyState >= 2
  );
  await phone.locator('.n-message-wrapper').waitFor({ state: 'hidden' });
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await phone.setViewportSize(viewport);
    const box = await phone.locator('.scan-dialog').boundingBox();
    assert.ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width + 1 &&
        box.y + box.height <= viewport.height + 1
    );
    const action = await phone
      .getByRole('button', { name: '选择二维码图片' })
      .boundingBox();
    assert.ok(
      action.y >= box.y && action.y + action.height <= box.y + box.height,
      'scanner actions remain visible'
    );
    await phone.screenshot({
      path: path.join(artifacts, `camera-${viewport.width}.png`),
    });
  }
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.evaluate(() => {
    window.__camera.enabled = true;
  });
  const beforeScan = verifyRequests.length;
  await waitConnected();
  assert.equal(verifyRequests.length, beforeScan + 1);
  assert.equal(
    await phone.evaluate(() =>
      window.__camera.streams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === 'ended')
      )
    ),
    true
  );
  await disconnect();
  pass(
    'live camera frames decode once, camera tracks stop on close and success, and scanner fits portrait and landscape'
  );
  phone.off('request', listener);
}
