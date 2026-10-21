import { chromium } from 'playwright-core';
import fs from 'node:fs';

const candidates = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome'
].filter(Boolean);

export async function launch() {
  const executablePath = candidates.find((p) => fs.existsSync(p));
  return chromium.launch({ executablePath, args: ['--no-sandbox'] });
}
