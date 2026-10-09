/* eslint-disable no-restricted-syntax, require-await */
// Run after pnpm build:prod. Real Vue, persisted state, Socket.IO and QR decoder;
// device APIs and the desktop IPC bridge use disposable fixtures.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { Server } = require('socket.io');

const artifacts = path.resolve('.local/credential-visibility');
await mkdir(artifacts, { recursive: true });
const device = { uuid: '12345678', password: 'fixture9' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname.endsWith('/desk_user/update_by_uuid')) {
        let body = '';
        for await (const part of req) body += part;
        device.password = JSON.parse(body).new_password;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ code: 200, data: device }));
      return;
    }
    const root = path.resolve(
      url.pathname.startsWith('/__qr/') ? 'node_modules/qr-scanner' : 'dist'
    );
    let relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (url.pathname.startsWith('/__qr/'))
      relative = url.pathname.slice('/__qr/'.length);
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Invalid path');
    const types = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.svg': 'image/svg+xml',
    };
    res.setHeader(
      'Content-Type',
      types[path.extname(file)] || 'application/octet-stream'
    );
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
const io = new Server(server);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];
try {
  browser = await chromium.launch({
    executablePath:
      process.env.SMOKE_BROWSER_EXECUTABLE ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(() => {
    window.electronAPI = {
      ipcRenderer: {
        send() {},
        on() {},
        removeListener() {},
        async invoke() {
          return {
            code: 0,
            data: {
              supported: true,
              enabled: false,
              platform: 'darwin',
              width: 1280,
              height: 900,
              scaleFactor: 1,
              sources: [],
            },
          };
        },
      },
    };
    // Observe the initial render as well as the final ready state for flashes.
    window.credentialFlashes = [];
    const observer = new MutationObserver(() => {
      const password = document.querySelector('.info-right .code');
      if (password && password.textContent.trim() !== '********')
        window.credentialFlashes.push('password');
      if (document.querySelector('.connection-qr canvas'))
        window.credentialFlashes.push('qr');
    });
    observer.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.stopCredentialObservation = () => observer.disconnect();
  });
  const host = await context.newPage();
  host.on('pageerror', (error) => errors.push(error.message));
  const password = host.locator('.info-right .code');
  const qr = host.locator('.connection-qr canvas');
  const button = (name) => host.getByRole('button', { name, exact: true });
  const ready = async () => {
    await host.waitForFunction(() => {
      const toggle = document.querySelector('.qr-toggle');
      return toggle && !toggle.disabled;
    });
  };
  const concealed = async () => {
    assert.equal((await password.textContent()).trim(), '********');
    assert.equal(await qr.count(), 0);
    assert.equal(
      await button('显示临时密码').getAttribute('aria-pressed'),
      'false'
    );
    assert.equal(
      await button('显示二维码').getAttribute('aria-pressed'),
      'false'
    );
  };
  const noFlash = async () => {
    assert.deepEqual(await host.evaluate(() => window.credentialFlashes), []);
    await host.evaluate(() => window.stopCredentialObservation());
  };
  const decodeScreenshot = async () => {
    const png = await host.locator('.qr-image').screenshot();
    return host.evaluate(
      async (image) => {
        const { default: QrScanner } = await import('/__qr/qr-scanner.min.js');
        try {
          const result = await QrScanner.scanImage(image, {
            returnDetailedScanResult: true,
          });
          return result.data;
        } catch (error) {
          if (error === QrScanner.NO_QR_CODE_FOUND) return null;
          throw error;
        }
      },
      `data:image/png;base64,${png.toString('base64')}`
    );
  };

  await host.goto(`${base}/#/remote`);
  await button('显示临时密码').waitFor();
  await concealed();
  assert.equal(await button('显示二维码').isDisabled(), true);
  await noFlash();
  await button('设置手机网页地址').click();
  await host
    .getByLabel('手机网页地址', { exact: true })
    .fill('https://remote.example.test/');
  await Promise.all([
    host.waitForNavigation(),
    button('保存并重新连接').click(),
  ]);
  await ready();
  await concealed();
  await noFlash();
  assert.equal(await decodeScreenshot(), null);
  await host.screenshot({ path: path.join(artifacts, 'concealed.png') });
  console.log(
    'PASS first launch and delayed QR readiness never expose credentials'
  );

  await button('显示临时密码').focus();
  await host.keyboard.press('Enter');
  assert.equal((await password.textContent()).trim(), device.password);
  assert.equal(await qr.count(), 0);
  await button('隐藏临时密码').focus();
  await host.keyboard.press('Space');
  await concealed();
  await button('显示二维码').focus();
  await host.keyboard.press('Enter');
  await qr.waitFor();
  assert.equal(await button('隐藏二维码').getAttribute('aria-pressed'), 'true');
  assert.equal((await password.textContent()).trim(), '********');
  const link = await decodeScreenshot();
  assert.ok(link);
  assert.equal(
    new URLSearchParams(new URL(link).hash.split('?')[1]).get('password'),
    device.password
  );
  await button('隐藏二维码').focus();
  await host.keyboard.press('Space');
  await concealed();
  assert.equal(await decodeScreenshot(), null);
  await button('复制连接链接').click();
  assert.equal(await host.evaluate(() => navigator.clipboard.readText()), link);
  console.log(
    'PASS independent keyboard reveal/hide controls, screenshot decoding and copy'
  );

  await button('显示临时密码').click();
  await button('显示二维码').click();
  // Upgrade an existing profile that explicitly persisted the old reveal flag.
  await host.evaluate(() => {
    const key = 'billd_desk___pinia-cache';
    const cached = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...cached, hidePwd: false }));
  });
  await host.reload();
  await ready();
  await concealed();
  await noFlash();
  console.log(
    'PASS reload ignores a legacy persisted show-password preference'
  );

  assert.equal(await button('更新临时密码').count(), 0);
  console.log('PASS permanent device passwords offer no rotation control');

  for (const socket of io.sockets.sockets.values()) socket.conn.close();
  await host.locator('.qr-concealed').waitFor();
  await ready();
  await concealed();
  console.log('PASS reconnect requires a fresh QR reveal');

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await host.setViewportSize(viewport);
    await button('显示二维码').scrollIntoViewIfNeeded();
    const box = await button('显示二维码').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width);
    await host.screenshot({
      path: path.join(artifacts, `concealed-${viewport.width}.png`),
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS reveal controls fit narrow and landscape layouts; no page errors'
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => io.close(resolve));
}
