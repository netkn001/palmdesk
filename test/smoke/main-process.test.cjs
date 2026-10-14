const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-source.cjs');
const { CaptureSession, InputUnavailableError, normalizedPoint } = load(
  'electron-main/capture-session.ts'
);
const {
  NativeWindowBridge,
  matchCaptureSources,
  matchDisplaySources,
  disableBackgroundThrottling,
} = load('electron-main/native-window.ts');

const source = (extra = {}) => ({
  id: 'window:10:0',
  captureId: 'window:10:0',
  isOnScreen: true,
  nativeId: 10,
  ownerPid: 42,
  bundleId: 'com.openai.codex',
  name: 'Project notes',
  thumbnail: '',
  appIcon: '',
  isAiTarget: true,
  // Legacy wire alias retained while older controllers are still supported.
  isCodex: true,
  bounds: { x: 100, y: 200, width: 600, height: 400 },
  boundsSource: 'window',
  inputScale: 1,
  ...extra,
});
function harness() {
  const state = { sources: [source()], events: [], focusCalls: 0 };
  const record =
    (name) =>
    async (...args) => {
      state.events.push([name, ...args]);
    };
  const driver = {
    position: record('position'),
    buttonDown: record('down'),
    buttonUp: record('up'),
    click: record('click'),
    scroll: record('scroll'),
    text: (value) => record('text')(value),
    keysDown: record('keysDown'),
    keysUp: record('keysUp'),
    validKey: (key) => Number.isInteger(key) && key >= 0 && key <= 200,
  };
  state.session = new CaptureSession(
    driver,
    async () => {
      if (state.listError) throw state.listError;
      if (state.listWait) await state.listWait;
      if (state.listSequence?.length) return state.listSequence.shift();
      return state.sources;
    },
    async (target) => {
      state.focusCalls += 1;
      if (state.focusWait) await state.focusWait;
      if (state.focusError) throw state.focusError;
      if (state.focusResult) return state.focusResult;
      const current = state.sources.find((item) => item.id === target.id);
      if (!current) throw new Error('Window closed');
      return current;
    }
  );
  return state;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const desktopSource = (id, name) => ({
  id,
  name,
  display_id: '1',
  thumbnail: { isEmpty: () => false, toJPEG: () => Buffer.from('thumbnail') },
  appIcon: null,
});

test('native text injection receives the freshly verified window identity', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  const refreshed = source({
    bounds: { x: 300, y: 100, width: 400, height: 300 },
  });
  h.sources = [refreshed];
  h.session.driver.text = async (value, target) => {
    assert.equal(value, 'literal text');
    assert.deepEqual(target, refreshed);
  };
  await h.session.input(sessionId, { action: 'text', text: 'literal text' });
});

test('native owner identity admits ordinary app windows without trusting their titles', () => {
  const sources = [
    desktopSource('window:10:0', 'Project notes'),
    desktopSource('window:11:0', 'Codex'),
    desktopSource('screen:10:0', 'Codex'),
  ];
  const owners = [
    source(),
    source({ nativeId: 11, ownerPid: 99, bundleId: 'com.google.Chrome' }),
  ];
  const result = matchCaptureSources(sources, owners);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'window:10:0');
  assert.equal(result[0].ownerPid, 42);
  assert.equal(result[1].bundleId, 'com.google.Chrome');
  assert.equal(result[1].isAiTarget, false);
  assert.equal(result[1].isCodex, false);
});
test('AI agent client bundle IDs are preferred and titles do not affect ranking', () => {
  const result = matchCaptureSources(
    [
      desktopSource('window:11:0', 'Codex'),
      desktopSource('window:12:0', 'Claude'),
      desktopSource('window:13:0', 'Kimi'),
      desktopSource('window:14:0', 'ZCode'),
      desktopSource('window:15:0', 'Not an agent'),
    ],
    [
      source({ nativeId: 11, bundleId: 'com.openai.chat' }),
      source({
        nativeId: 12,
        bundleId: 'com.anthropic.claudefordesktop',
      }),
      source({ nativeId: 13, bundleId: 'com.moonshot.kimichat' }),
      source({ nativeId: 14, bundleId: 'dev.zcode.app' }),
      source({ nativeId: 15, bundleId: 'com.apple.Terminal' }),
    ]
  );
  assert.deepEqual(
    result.map((item) => item.nativeId),
    [11, 12, 13, 14, 15]
  );
  assert.deepEqual(
    result.slice(0, 4).map((item) => item.isAiTarget),
    [true, true, true, true]
  );
  assert.equal(result[0].bundleId, 'com.openai.chat');
  assert.equal(result[1].bundleId, 'com.anthropic.claudefordesktop');
  assert.equal(result[2].bundleId, 'com.moonshot.kimichat');
  assert.equal(result[3].bundleId, 'dev.zcode.app');
  assert.equal(result[4].isAiTarget, false);
  assert.equal(result[4].isCodex, false);
  assert.equal(
    matchCaptureSources([desktopSource('window:13:0', 'OpenAI')], []).length,
    0
  );
});
test('all-Spaces catalog includes windows Electron omits and keeps AI targets first', () => {
  const result = matchCaptureSources(
    [
      desktopSource('window:11:7', 'Terminal'),
      desktopSource('window:99:0', 'No owner'),
    ],
    [
      source({ nativeId: 11, bundleId: 'com.apple.Terminal' }),
      source({ nativeId: 12, isOnScreen: false }),
      source({ nativeId: 13, bundleId: 'com.openai.chat', isOnScreen: false }),
      source({
        nativeId: 14,
        bundleId: 'com.anthropic.claudefordesktop',
        isOnScreen: false,
      }),
    ]
  );
  assert.deepEqual(
    result.map((item) => item.nativeId),
    [12, 13, 14, 11]
  );
  assert.equal(result[0].id, 'window:12:0');
  assert.equal(result[0].captureId, undefined);
  assert.equal(result[0].thumbnail, '');
  assert.equal(result[0].isOnScreen, false);
  assert.equal(result[3].id, 'window:11:0');
  assert.equal(result[3].captureId, 'window:11:7');
});
test('offscreen metadata and empty thumbnails do not create usable capture sources', () => {
  const empty = desktopSource('window:10:0', 'Target');
  empty.thumbnail.isEmpty = () => true;
  const [result] = matchCaptureSources(
    [empty],
    [source({ isOnScreen: false })]
  );
  assert.equal(result.captureId, undefined);
  assert.equal(result.thumbnail, '');
});
test('offscreen previews use native images without changing capture eligibility', async () => {
  const bridge = new NativeWindowBridge('unused');
  const [offscreen] = matchCaptureSources([], [source({ isOnScreen: false })]);
  const thumbnail = 'data:image/jpeg;base64,bmF0aXZl';
  bridge.request = (command, request) => {
    assert.equal(command, 'thumbnails');
    assert.deepEqual(request.windows, [
      { nativeId: 10, ownerPid: 42, bundleId: 'com.openai.codex' },
    ]);
    return Promise.resolve([{ ...request.windows[0], thumbnail }]);
  };
  const [preview] = await bridge.addThumbnails([offscreen]);
  assert.equal(preview.thumbnail, thumbnail);
  assert.equal(preview.isOnScreen, false);
  assert.equal(preview.captureId, undefined);
  assert.equal(offscreen.thumbnail, '', 'input catalog is not mutated');
});
test('existing Electron previews are retained even for offscreen windows', async () => {
  const bridge = new NativeWindowBridge('unused');
  bridge.request = () => assert.fail('no native request is needed');
  const sources = matchCaptureSources(
    [desktopSource('window:10:0', 'Target')],
    [source({ isOnScreen: false })]
  );
  assert.ok(sources[0].thumbnail);
  assert.equal(await bridge.addThumbnails(sources), sources);
});
test('native previews are matched by the full window identity and bounded for transport', async () => {
  const original = source({ isOnScreen: false, captureId: undefined });
  await Promise.all(
    [
      { nativeId: 11 },
      { ownerPid: 99 },
      { bundleId: 'com.apple.Terminal' },
      { thumbnail: `data:image/jpeg;base64,${'a'.repeat(40000)}` },
      { thumbnail: 'https://example.com/image.jpg' },
    ].map(async (changed) => {
      const bridge = new NativeWindowBridge('unused');
      bridge.request = () =>
        Promise.resolve([
          {
            ...original,
            thumbnail: 'data:image/jpeg;base64,bmF0aXZl',
            ...changed,
          },
        ]);
      const [result] = await bridge.addThumbnails([original]);
      assert.equal(result, original);
    })
  );
});
test('a failed or partial native preview batch preserves the window list', async () => {
  const bridge = new NativeWindowBridge('unused');
  const sources = [source(), source({ nativeId: 11 })];
  bridge.request = () => Promise.resolve([]);
  assert.deepEqual(await bridge.addThumbnails(sources), sources);
  bridge.request = () =>
    Promise.reject(new Error('ScreenCaptureKit unavailable'));
  assert.equal(await bridge.addThumbnails(sources), sources);
});
test('viewing an available window and refreshing the all-Spaces list do not change focus', async () => {
  const h = harness();
  h.sources.push(
    source({
      id: 'window:11:0',
      nativeId: 11,
      isOnScreen: false,
      captureId: undefined,
    })
  );
  await h.session.refresh();
  await h.session.begin('window:10:0');
  assert.equal(h.focusCalls, 0);
});
test('offscreen selection waits for activation and a verified Electron capture ID', async () => {
  const h = harness();
  const offscreen = source({ isOnScreen: false, captureId: undefined });
  const visible = source({ captureId: 'window:10:7' });
  h.sources = [offscreen];
  h.listSequence = [[offscreen], [offscreen], [visible]];
  const capture = await h.session.begin(offscreen.id, offscreen);
  assert.equal(h.focusCalls, 1);
  assert.equal(capture.source.id, offscreen.id);
  assert.equal(capture.stream.id, visible.captureId);
  assert.deepEqual(h.events, []);
});
test('closed windows or changed identities during activation cannot be captured', async () => {
  for (const replacement of [
    [],
    [source({ ownerPid: 99 })],
    [source({ nativeId: 99 })],
  ]) {
    const h = harness();
    const offscreen = source({ isOnScreen: false, captureId: undefined });
    h.sources = [offscreen];
    h.listSequence = [[offscreen], replacement];
    await assert.rejects(h.session.begin(offscreen.id));
    assert.equal((await h.session.refresh()).sessionId, '');
  }
});
test('activation denial or the wrong focused window cannot start video', async () => {
  for (const failure of ['denied', 'wrong-window']) {
    const h = harness();
    h.sources = [source({ isOnScreen: false, captureId: undefined })];
    if (failure === 'denied') h.focusError = new Error('Accessibility denied');
    else h.focusResult = source({ nativeId: 99 });
    await assert.rejects(h.session.begin('window:10:0'));
    assert.equal((await h.session.refresh()).sessionId, '');
  }
});
test('an activated window missing from Electron eventually fails without a session', async () => {
  const h = harness();
  h.sources = [source({ captureId: undefined })];
  await assert.rejects(h.session.begin('window:10:0'), /无法启动捕获/);
  assert.equal((await h.session.refresh()).sessionId, '');
});
test('disconnect during activation cancels capture and permits a new selection', async () => {
  const h = harness();
  h.sources = [source({ isOnScreen: false, captureId: undefined })];
  let release;
  h.focusWait = new Promise((resolve) => {
    release = resolve;
  });
  const rejected = assert.rejects(h.session.begin('window:10:0'), /已取消/);
  await tick();
  const ended = h.session.end();
  h.sources = [source()];
  const newer = h.session.begin('window:10:0');
  release();
  await rejected;
  await ended;
  const current = await newer;
  assert.equal((await h.session.refresh()).sessionId, current.sessionId);
  assert.deepEqual(h.events, []);
});
test('leaving the capturable Space ends capture even though the window remains listed', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  h.sources = [source({ isOnScreen: false, captureId: undefined })];
  const refreshed = await h.session.refresh();
  assert.equal(refreshed.sources.length, 1);
  assert.equal(refreshed.sessionId, '');
  await assert.rejects(
    h.session.input(sessionId, { action: 'text', text: 'x' })
  );
  assert.equal(h.focusCalls, 0);
});
test('input is rejected when native focus has not made the exact window visible', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  h.sources = [source({ isOnScreen: false })];
  await assert.rejects(
    h.session.input(sessionId, { action: 'text', text: 'x' })
  );
  assert.deepEqual(h.events, []);
});
test('Terminal and Claude can each be captured and controlled using their exact identity', async () => {
  for (const bundleId of [
    'com.apple.Terminal',
    'com.anthropic.claudefordesktop',
  ]) {
    const h = harness();
    h.sources = [source({ bundleId })];
    const { sessionId } = await h.session.begin('window:10:0', {
      ownerPid: 42,
      bundleId,
    });
    await h.session.input(sessionId, { action: 'text', text: 'selected' });
    assert.deepEqual(h.events, [['text', 'selected']]);
  }
});
test('a window identity changed since listing cannot begin capture', async () => {
  for (const change of [{ ownerPid: 99 }, { bundleId: 'com.apple.Terminal' }]) {
    const h = harness();
    h.sources = [source(change)];
    await assert.rejects(
      h.session.begin('window:10:0', source()),
      /身份已变化/
    );
    assert.equal((await h.session.refresh()).sessionId, '');
  }
});
test('corners, center, out-of-range and negative desktop coordinates map to the exact window', () => {
  for (const [x, y, expected] of [
    [0, 0, { x: 100, y: 200 }],
    [1000, 1000, { x: 699, y: 599 }],
    [1000, 0, { x: 699, y: 200 }],
    [0, 1000, { x: 100, y: 599 }],
    [500, 500, { x: 400, y: 400 }],
    [-20, 1200, { x: 100, y: 599 }],
  ])
    assert.deepEqual(normalizedPoint(source(), x, y), expected);
  assert.deepEqual(
    normalizedPoint(
      source({ bounds: { x: -600, y: 50, width: 800, height: 600 } }),
      0,
      1000
    ),
    { x: -600, y: 649 }
  );
});
test('display fallback and non-finite coordinates are rejected', () => {
  assert.throws(() =>
    normalizedPoint(source({ boundsSource: 'display' }), 500, 500)
  );
  for (const value of [NaN, Infinity, '500', undefined])
    assert.throws(() => normalizedPoint(source(), value, 0));
  for (const change of [
    { width: 0 },
    { height: -1 },
    { x: NaN },
    { y: Infinity },
    { width: Infinity },
  ])
    assert.throws(() =>
      normalizedPoint(
        source({ bounds: { ...source().bounds, ...change } }),
        0,
        0
      )
    );
});
for (const action of [
  'move',
  'down',
  'up',
  'click',
  'doubleClick',
  'rightClick',
  'scroll',
  'text',
  'keysDown',
  'keysUp',
]) {
  test(action + ' is rejected without an active capture session', async () => {
    const h = harness();
    await assert.rejects(
      h.session.input('old', {
        action,
        x: 500,
        y: 500,
        text: 'x',
        keys: [1],
        direction: 'up',
        amount: 1,
      })
    );
    assert.equal(h.events.length, 0);
  });
}
test('starting capture requires an explicit existing source ID', async () => {
  const h = harness();
  await assert.rejects(h.session.begin(''));
  await assert.rejects(h.session.begin('screen:0:0'));
});
test('a new capture uses a fresh token and rejects the previous token', async () => {
  const h = harness();
  const first = await h.session.begin('window:10:0');
  const second = await h.session.begin('window:10:0');
  assert.notEqual(first.sessionId, second.sessionId);
  await assert.rejects(
    h.session.input(first.sessionId, { action: 'text', text: 'stale' })
  );
  await h.session.input(second.sessionId, {
    action: 'text',
    text: '你好 Codex',
  });
  assert.deepEqual(h.events, [['text', '你好 Codex']]);
});
test('pointer, scroll and keys each verify focus without an 800 ms bypass', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  await h.session.input(sessionId, { action: 'move', x: 500, y: 500 });
  await h.session.input(sessionId, {
    action: 'scroll',
    x: 0,
    y: 1000,
    direction: 'down',
    amount: 3,
  });
  await h.session.input(sessionId, { action: 'keysDown', keys: [1] });
  assert.equal(h.focusCalls, 3);
  assert.deepEqual(h.events.slice(0, 3), [
    ['position', { x: 400, y: 400 }],
    ['position', { x: 100, y: 599 }],
    ['scroll', 'down', 3],
  ]);
});
test('bounds are read again before each pointer event', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  h.sources = [source({ bounds: { x: -800, y: 20, width: 800, height: 600 } })];
  await h.session.input(sessionId, { action: 'move', x: 1000, y: 0 });
  assert.deepEqual(h.events[0], ['position', { x: -1, y: 20 }]);
});
test('fast touch swipes retain their amplified distance while oversized input stays bounded', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  for (const amount of [144, 600, 100000]) {
    await h.session.input(sessionId, {
      action: 'scroll',
      direction: 'down',
      x: 500,
      y: 500,
      amount,
    });
  }
  assert.deepEqual(
    h.events.filter(([action]) => action === 'scroll'),
    [
      ['scroll', 'down', 144],
      ['scroll', 'down', 600],
      ['scroll', 'down', 1000],
    ]
  );
});
test('same title with a new window ID cannot take over the video target', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  h.sources = [source({ id: 'window:99:0', nativeId: 99 })];
  await h.session.refresh();
  await assert.rejects(
    h.session.input(sessionId, { action: 'text', text: 'x' })
  );
  assert.equal(h.events.length, 0);
});
test('PID reuse or bundle mismatch invalidates input', async () => {
  for (const change of [{ ownerPid: 77 }, { bundleId: 'com.google.Chrome' }]) {
    const h = harness();
    const { sessionId } = await h.session.begin('window:10:0');
    h.sources = [source(change)];
    await assert.rejects(
      h.session.input(sessionId, { action: 'text', text: 'x' })
    );
    assert.equal(h.events.length, 0);
  }
});
test('enumeration error clears the session', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  h.listError = new Error('Capture denied');
  await assert.rejects(h.session.refresh());
  await assert.rejects(
    h.session.input(sessionId, { action: 'text', text: 'x' })
  );
});
test('focus denial blocks system input', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  h.focusError = new Error('Accessibility denied');
  await assert.rejects(
    h.session.input(sessionId, { action: 'move', x: 0, y: 0 })
  );
  assert.equal(h.events.length, 0);
});
test('recoverable focus failure preserves capture and blocks queued input until an explicit retry', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  h.focusError = new InputUnavailableError('Focus unavailable');
  const rejected = [
    h.session.input(sessionId, { action: 'click', x: 500, y: 500 }),
    h.session.input(sessionId, {
      action: 'text',
      text: 'must not be replayed',
    }),
  ];
  await Promise.all(
    rejected.map((input) => assert.rejects(input, InputUnavailableError))
  );
  assert.equal((await h.session.refresh()).sessionId, sessionId);
  assert.equal(h.focusCalls, 1);
  assert.deepEqual(h.events, []);
  h.focusError = undefined;
  await assert.rejects(
    h.session.input(sessionId, { action: 'text', text: 'still blocked' }),
    InputUnavailableError
  );
  await h.session.input(sessionId, { action: 'resume' });
  assert.deepEqual(
    h.events,
    [],
    'retry only verifies focus; it must not click or type'
  );
  await h.session.input(sessionId, { action: 'text', text: 'fresh input' });
  assert.deepEqual(h.events, [['text', 'fresh input']]);
});
test('pausing input releases held keys and buttons, and a failed retry remains paused', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  await h.session.input(sessionId, { action: 'keysDown', keys: [1] });
  await h.session.input(sessionId, { action: 'down', x: 0, y: 0 });
  h.focusError = new InputUnavailableError('Permission revoked');
  await assert.rejects(
    h.session.input(sessionId, { action: 'move', x: 50, y: 50 })
  );
  assert.deepEqual(h.events.slice(-2), [
    ['keysUp', [1]],
    ['up', 'left'],
  ]);
  await h.session.input(sessionId, { action: 'releaseAll' });
  await assert.rejects(
    h.session.input(sessionId, { action: 'resume' }),
    /Permission revoked/
  );
  assert.equal((await h.session.refresh()).sessionId, sessionId);
});
test('a paused capture still ends if its window disappears or changes identity', async () => {
  for (const sources of [[], [source({ ownerPid: 99 })]]) {
    const h = harness();
    const { sessionId } = await h.session.begin('window:10:0');
    h.focusError = new InputUnavailableError('Focus unavailable');
    await assert.rejects(
      h.session.input(sessionId, { action: 'click', x: 0, y: 0 })
    );
    h.sources = sources;
    assert.equal((await h.session.refresh()).sessionId, '');
    h.focusError = undefined;
    await assert.rejects(
      h.session.input(sessionId, { action: 'resume' }),
      /会话已结束/
    );
    assert.deepEqual(h.events, []);
  }
});
test('a retry must verify the original window identity and cannot survive disconnect', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  h.focusError = new InputUnavailableError('Focus unavailable');
  await assert.rejects(
    h.session.input(sessionId, { action: 'click', x: 0, y: 0 })
  );
  h.focusError = undefined;
  let release;
  h.focusWait = new Promise((resolve) => {
    release = resolve;
  });
  const retry = h.session.input(sessionId, { action: 'resume' });
  const rejection = assert.rejects(retry, /目标窗口已失效/);
  await tick();
  const ended = h.session.end(sessionId);
  release();
  await rejection;
  await ended;
  assert.equal((await h.session.refresh()).sessionId, '');
  assert.deepEqual(h.events, []);
});
test('disconnect invalidates input already awaiting focus', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  let release;
  h.focusWait = new Promise((resolve) => {
    release = resolve;
  });
  const input = h.session.input(sessionId, { action: 'text', text: 'late' });
  const rejection = assert.rejects(input);
  await tick();
  const ended = h.session.end(sessionId);
  release();
  await rejection;
  await ended;
  assert.equal(h.events.length, 0);
});
test('down, move and up remain ordered even while focus awaits', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  let release;
  h.focusWait = new Promise((resolve) => {
    release = resolve;
  });
  const pending = [
    h.session.input(sessionId, { action: 'down', x: 0, y: 0 }),
    h.session.input(sessionId, { action: 'move', x: 500, y: 500 }),
    h.session.input(sessionId, { action: 'up', x: 1000, y: 1000 }),
  ];
  await tick();
  assert.equal(h.focusCalls, 1);
  release();
  await Promise.all(pending);
  assert.deepEqual(
    h.events.map(([action]) => action),
    ['position', 'down', 'position', 'position', 'up']
  );
});
test('disconnect releases held modifiers and mouse buttons', async () => {
  const h = harness();
  const { sessionId } = await h.session.begin('window:10:0');
  await h.session.input(sessionId, { action: 'keysDown', keys: [1, 2] });
  await h.session.input(sessionId, { action: 'down', x: 0, y: 0 });
  await h.session.end(sessionId);
  assert.ok(h.events.some(([action]) => action === 'keysUp'));
  assert.ok(h.events.some(([action]) => action === 'up'));
});
test('stopping an obsolete session does not stop a new capture', async () => {
  const h = harness();
  const first = await h.session.begin('window:10:0');
  const second = await h.session.begin('window:10:0');
  await h.session.end(first.sessionId);
  await h.session.input(second.sessionId, { action: 'text', text: 'current' });
  assert.deepEqual(h.events, [['text', 'current']]);
});
test('a cancelled capture lookup cannot create a new session', async () => {
  const h = harness();
  let release;
  h.listWait = new Promise((resolve) => {
    release = resolve;
  });
  const starting = h.session.begin('window:10:0');
  const rejection = assert.rejects(starting);
  await tick();
  const ended = h.session.end();
  release();
  await rejection;
  await ended;
  assert.equal((await h.session.refresh()).sessionId, '');
});
test('obsolete enumeration success or failure cannot end a newer capture', async () => {
  for (const fail of [false, true]) {
    const h = harness();
    await h.session.begin('window:10:0');
    let finish;
    h.session.list = () =>
      new Promise((resolve, reject) => {
        finish = () =>
          fail ? reject(new Error('Old enumeration failed')) : resolve([]);
      });
    const refresh = h.session.refresh();
    const result = fail ? assert.rejects(refresh) : refresh;
    h.session.list = async () => h.sources;
    const current = await h.session.begin('window:10:0');
    finish();
    await result;
    await h.session.input(current.sessionId, {
      action: 'text',
      text: 'current',
    });
    assert.deepEqual(h.events, [['text', 'current']]);
  }
});
test('malformed keys and oversized text never reach the native driver', async () => {
  for (const input of [
    { action: 'keysDown', keys: ['a'] },
    { action: 'keysDown', keys: [9999] },
    { action: 'text', text: 'x'.repeat(4097) },
  ]) {
    const h = harness();
    const { sessionId } = await h.session.begin('window:10:0');
    await assert.rejects(h.session.input(sessionId, input));
    assert.equal(h.events.length, 0);
  }
});
test('matchDisplaySources creates capture sources for displays with screen boundsSource', () => {
  const sources = [
    desktopSource('screen:1:0', 'Screen 1'),
    desktopSource('window:10:0', 'Not a screen'),
  ];
  const displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.25 },
  ];
  const resultWin = matchDisplaySources(sources, displays, 1, 'win32');
  assert.equal(resultWin.length, 1);
  assert.equal(resultWin[0].id, 'screen:1:0');
  assert.equal(resultWin[0].captureId, 'screen:1:0');
  assert.equal(resultWin[0].isOnScreen, true);
  assert.equal(resultWin[0].boundsSource, 'screen');
  assert.equal(resultWin[0].ownerPid, 0);
  assert.equal(resultWin[0].bundleId, 'system.display');
  assert.deepEqual(resultWin[0].bounds, {
    x: 0,
    y: 0,
    width: 2400,
    height: 1350,
  });

  const resultMac = matchDisplaySources(sources, displays, 1, 'darwin');
  assert.deepEqual(resultMac[0].bounds, {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
});
test('entire screen capture session maps coordinates and receives input', async () => {
  const screenSource = {
    id: 'screen:0:0',
    captureId: 'screen:0:0',
    isOnScreen: true,
    nativeId: -1,
    ownerPid: 0,
    bundleId: 'system.display',
    appName: '屏幕',
    name: '整个屏幕（主显示器）',
    displayId: '1',
    thumbnail: '',
    appIcon: '',
    isAiTarget: false,
    isCodex: false,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    boundsSource: 'screen',
    inputScale: 1,
  };
  const h = harness();
  h.sources = [screenSource];
  const { sessionId } = await h.session.begin('screen:0:0');
  assert.ok(sessionId);
  await h.session.input(sessionId, { action: 'move', x: 500, y: 500 });
  await h.session.input(sessionId, { action: 'click', x: 1000, y: 1000 });
  assert.deepEqual(h.events, [
    ['position', { x: 960, y: 540 }],
    ['position', { x: 1919, y: 1079 }],
    ['click', 'left', false],
  ]);
});
test('disableBackgroundThrottling appends Chromium flags to prevent renderer background throttling', () => {
  const switches = [];
  disableBackgroundThrottling({
    appendSwitch: (flag) => switches.push(flag),
  });
  assert.deepEqual(switches, [
    'disable-background-timer-throttling',
    'disable-renderer-backgrounding',
    'disable-backgrounding-occluded-windows',
  ]);
});
