const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

module.exports = function loadSource(relative, overrides = {}) {
  const filename = path.resolve(__dirname, '../..', relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = instance.require.bind(instance);
  instance.require = (id) => {
    if (id.endsWith('.css')) return {};
    if (id in overrides) return overrides[id];
    const candidate = id.startsWith('@/')
      ? path.resolve(__dirname, '../../src', id.slice(2))
      : id.startsWith('.')
        ? path.resolve(path.dirname(filename), id)
        : '';
    if (candidate && fs.existsSync(`${candidate}.ts`))
      return loadSource(`${candidate}.ts`, overrides);
    return originalRequire(id);
  };
  instance._compile(compiled, filename);
  return instance.exports;
};
