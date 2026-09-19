import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// generate-sitemap.mjs is the `prebuild` script (see package.json). These
// tests exercise it as an actual child process — the behaviour under test
// (falling back instead of clobbering public/sitemap.xml, and the strict
// exit code) only exists at that boundary, not inside buildSitemapXml.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, 'generate-sitemap.mjs');
const SITEMAP_PATH = path.join(__dirname, '..', 'public', 'sitemap.xml');

// Port 1 on loopback is reserved and nothing can bind to it, so both fetches
// inside the script fail with ECONNREFUSED immediately — a fast, offline
// stand-in for "no backend running", with no dependency on whatever may or
// may not be listening on the real API's default dev port.
const UNREACHABLE_API_BASE = 'http://127.0.0.1:1/api';

function runScript(extraEnv: Record<string, string>) {
  return spawnSync(process.execPath, [SCRIPT_PATH], {
    env: { ...process.env, VITE_API_BASE_URL: UNREACHABLE_API_BASE, ...extraEnv },
    encoding: 'utf8',
    timeout: 15000,
  });
}

describe('generate-sitemap.mjs', () => {
  it('does not overwrite public/sitemap.xml and exits 0 when the backend is unreachable', () => {
    const before = readFileSync(SITEMAP_PATH, 'utf8');

    const result = runScript({ SITEMAP_STRICT: '0' });

    expect(result.status).toBe(0);
    const after = readFileSync(SITEMAP_PATH, 'utf8');
    expect(after).toBe(before);
  });

  it('exits 1 instead of falling back when SITEMAP_STRICT=1', () => {
    const before = readFileSync(SITEMAP_PATH, 'utf8');

    const result = runScript({ SITEMAP_STRICT: '1' });

    expect(result.status).toBe(1);
    // Still must not have touched the committed file on its way to failing.
    const after = readFileSync(SITEMAP_PATH, 'utf8');
    expect(after).toBe(before);
  });
});
