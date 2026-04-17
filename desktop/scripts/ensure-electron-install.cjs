const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function resolveElectronDir() {
  const pkgJsonPath = require.resolve('electron/package.json', { paths: [process.cwd()] });
  return path.dirname(pkgJsonPath);
}

function main() {
  const electronDir = resolveElectronDir();
  const pathTxt = path.join(electronDir, 'path.txt');

  if (fs.existsSync(pathTxt)) {
    return;
  }

  const installJs = path.join(electronDir, 'install.js');
  const result = spawnSync(process.execPath, [installJs], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

main();
