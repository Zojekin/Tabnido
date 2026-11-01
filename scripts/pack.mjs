import { readFile, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version || '1.0.0';
const zipName = `tabnido-${version}.zip`;
const zipPath = resolve(root, zipName);
const distDir = resolve(root, 'dist');

// 确认 dist 目录存在且包含 manifest.json
try {
  await stat(join(distDir, 'manifest.json'));
} catch {
  console.error('Error: dist/manifest.json not found. Run "npm run build" first.');
  process.exit(1);
}

// 若已存在旧的 zip 则删除
try {
  await unlink(zipPath);
} catch {
  // 文件不存在忽略
}

console.log(`Packaging ${zipName} from dist/...`);

if (process.platform === 'win32') {
  // Windows 下调用原生 PowerShell Compress-Archive
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${join(distDir, '*')}' -DestinationPath '${zipPath}' -Force"`,
    { stdio: 'inherit' },
  );
} else {
  // Linux / macOS 下调用原生 zip 命令
  execSync(`cd "${distDir}" && zip -r "${zipPath}" ./*`, { stdio: 'inherit' });
}

const zipStat = await stat(zipPath);
console.log(`Successfully created ${zipName} (${(zipStat.size / 1024).toFixed(1)} KB) at project root.`);
