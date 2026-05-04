import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export function loadEnvironment(): string | null {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.DOTENV_CONFIG_PATH,
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend/.env'),
    path.resolve(currentDir, '../.env'),
    path.resolve(currentDir, '../../.env'),
  ].filter((value): value is string => Boolean(value));

  const envPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (envPath) {
    dotenv.config({ path: envPath });
    return envPath;
  }

  dotenv.config();
  return null;
}
