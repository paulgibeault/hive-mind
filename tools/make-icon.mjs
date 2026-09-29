/* tools/make-icon.mjs — rasterise icon.svg to the 512px icon.png the launcher
 * card and the manifest want. Playwright is borrowed from the launcher repo. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const launcher = process.env.ARCADE_LAUNCHER || path.resolve(root, '../paulgibeault.github.io');
const { chromium } = createRequire(path.join(launcher, 'package.json'))('playwright');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<style>body{margin:0}svg{display:block;width:512px;height:512px}</style>${readFileSync(path.join(root, 'icon.svg'), 'utf8')}`);
await page.screenshot({ path: path.join(root, 'icon.png') });
await browser.close();
