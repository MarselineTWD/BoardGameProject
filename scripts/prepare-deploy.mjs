import { access, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const outDir = join(root, '.deploy');
const includeData = process.argv.includes('--with-data');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(relativePath) {
  const source = join(root, relativePath);
  if (!(await exists(source))) {
    return false;
  }
  const target = join(outDir, relativePath);
  await mkdir(join(target, '..'), { recursive: true });
  await cp(source, target, { recursive: true });
  return true;
}

async function main() {
  const distDir = join(root, 'dist');
  if (!(await exists(distDir))) {
    throw new Error(
      'Не найден dist/. Сначала выполните: npm run build',
    );
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const required = ['dist', 'server', 'package.json', 'package-lock.json'];
  for (const item of required) {
    const copied = await copyIfExists(item);
    if (!copied) {
      throw new Error(`Не найден обязательный путь: ${item}`);
    }
  }

  await copyIfExists('README.md');
  await copyIfExists('docker-compose.yml');
  await copyIfExists('.env.example');

  if (includeData) {
    await copyIfExists('data');
  }

  const envTemplate = [
    'PORT=3001',
    'DATABASE_URL=postgresql://user:password@localhost:5432/boardgame',
    'DEEPSEEK_API_KEY=',
    'DEEPSEEK_MODEL=deepseek-chat',
    'DEEPSEEK_BASE_URL=https://api.deepseek.com',
    'GAME_MASTER_ADMIN_TOKEN=',
    'BGG_API_TOKEN=',
    'OLLAMA_HOST=http://127.0.0.1:11434',
    'OLLAMA_MODEL=qwen2.5:1.5b',
  ].join('\n');

  if (!(await exists(join(outDir, '.env.example')))) {
    await writeFile(join(outDir, '.env.example'), `${envTemplate}\n`, 'utf8');
  }

  const notes = [
    'Подготовленный деплой-пакет:',
    '- без node_modules',
    '- без .git и локальных логов',
    '- без исходников фронтенда (только dist)',
    '',
    'Дальше на сервере:',
    '1) cd /path/to/project',
    '2) npm ci --omit=dev',
    '3) cp .env.example .env (и заполнить реальные значения)',
    '4) npm run api',
  ].join('\n');

  await writeFile(join(outDir, 'DEPLOY_NOTES.txt'), `${notes}\n`, 'utf8');
  console.log('Готово: создана папка .deploy');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

