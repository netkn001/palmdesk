const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const inputNodePath = path.resolve(
  __dirname,
  '../../native-bin/palmdesk_input.node'
);

test(
  'palmdesk-input native node binding exports expected interfaces',
  { skip: !fs.existsSync(inputNodePath) },
  () => {
    // eslint-disable-next-line global-require
    const nativeInput = require(inputNodePath);

    assert.equal(typeof nativeInput.inputVersion, 'function');
    assert.equal(nativeInput.inputVersion(), 'palmdesk-input-v0.1.0');

    assert.equal(typeof nativeInput.mouseSetPosition, 'function');
    assert.equal(typeof nativeInput.mouseButtonDown, 'function');
    assert.equal(typeof nativeInput.mouseButtonUp, 'function');
    assert.equal(typeof nativeInput.mouseClick, 'function');
    assert.equal(typeof nativeInput.mouseScroll, 'function');

    assert.equal(typeof nativeInput.keyboardType, 'function');
    assert.equal(typeof nativeInput.keyboardKeysDown, 'function');
    assert.equal(typeof nativeInput.keyboardKeysUp, 'function');
    assert.equal(typeof nativeInput.isValidKey, 'function');

    // Verify key validation
    assert.equal(nativeInput.isValidKey(0), true); // Escape
    assert.equal(nativeInput.isValidKey(106), true); // LeftCmd
    assert.equal(nativeInput.isValidKey(90), true); // V
    assert.equal(nativeInput.isValidKey(9999), false);
  }
);
