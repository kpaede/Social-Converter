import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { access, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const candidates = [process.env.SOCIAL_CONVERTER_CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
let chrome;
for (const candidate of candidates) {
 try { await access(candidate); chrome = candidate; break; } catch { /* Try the next installed browser. */ }
}
assert(chrome, 'Set SOCIAL_CONVERTER_CHROME to a Chrome/Chromium executable.');
assert(typeof WebSocket === 'function', 'Browser tests require Node.js 22 or later.');
const directory = await mkdtemp(path.join(tmpdir(), 'social-converter-regressions-'));
let child; let socket; let send;
try {
 await Promise.all([
  copyFile(process.env.SOCIAL_CONVERTER_OBSIDIAN_CSS || path.join(root, 'tests/fixtures/app.css'), path.join(directory, 'app.css')),
  copyFile(path.join(root, 'styles.css'), path.join(directory, 'plugin.css')),
  writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="app.css"><link rel="stylesheet" href="plugin.css"></head><body><script src="test.js"></script></body></html>'),
 ]);
 await build({ entryPoints: [path.join(root, 'tests/fixtures/regressions.mjs')], outfile: path.join(directory, 'test.js'), bundle: true, format: 'iife', plugins: [{ name: 'obsidian-test-host', setup(builder) {
  builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(root, 'tests/fixtures/obsidian.mjs') }));
 } }] });
 child = spawn(chrome, ['--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-background-networking', '--allow-file-access-from-files', `--user-data-dir=${path.join(directory, 'profile')}`, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
 const url = await new Promise((resolve, reject) => {
  let log = ''; const timeout = setTimeout(() => reject(new Error('Chrome startup timeout: ' + log)), 15000);
  child.stderr.on('data', (chunk) => { log += chunk; const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  child.on('error', (error) => { clearTimeout(timeout); reject(error); });
  child.on('exit', (code) => { clearTimeout(timeout); reject(new Error('Chrome exited: ' + code)); });
 });
 socket = new WebSocket(url);
 await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
 let id = 0; const pending = new Map(); const events = new Map();
 socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
   const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timeout);
   if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
  }
  const key = `${message.sessionId}:${message.method}`;
  if (events.has(key)) { events.get(key)(message.params); events.delete(key); }
 };
 send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const requestId = ++id;
  const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error('CDP timeout: ' + method)); }, 60000);
  pending.set(requestId, { resolve, reject, timeout }); socket.send(JSON.stringify({ id: requestId, method, params, sessionId }));
 });
 const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
 const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
 await send('Page.enable', {}, sessionId);
 await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
 const loaded = new Promise((resolve) => events.set(`${sessionId}:Page.loadEventFired`, resolve));
 await send('Page.navigate', { url: new URL('file://' + path.join(directory, 'index.html')).href }, sessionId); await loaded;
 const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
 };
 const results = await evaluate('new Promise(resolve => { const poll = setInterval(() => { if (window.__regressionResults) { clearInterval(poll); resolve(window.__regressionResults); } }, 50); setTimeout(() => { clearInterval(poll); resolve({error:"Browser regression timeout"}); }, 45000); })');
 assert(!results.error, results.error); console.log(results.results.map((label) => 'PASS ' + label).join('\n'));
 await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
 await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
 const committed = await evaluate('(() => { const f=window.__interactionFixture; return {scroll:f.view.contentEl.scrollTop,before:f.beforeTop,focused:document.activeElement===f.input,font:f.font(f.frame),same:f.frame===f.view.contentEl.querySelectorAll("iframe")[4]}; })()');
 assert.equal(committed.scroll, committed.before, 'Enter preserves scroll position on slide 5');
 assert(committed.focused && committed.same && Math.abs(committed.font - 22.4) < 0.01, 'Enter preserves focus and updates slide 5 in place');
 console.log('PASS Native Enter on slide 5 preserves scroll position, focus and iframe');
 const point = await evaluate('new Promise(resolve => { const f=window.__interactionFixture; f.frame.parentElement.scrollIntoView({block:"center"}); setTimeout(() => {const box=f.frame.parentElement.getBoundingClientRect();const x=box.x+box.width/2,y=box.y+box.height/2;resolve({x,y,before:f.view.contentEl.scrollTop,hit:document.elementFromPoint(x,y).tagName});},100); })');
 assert.notEqual(point.hit, 'IFRAME', 'Preview does not capture mouse input');
 await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: 250 }, sessionId);
 const scrolled = await evaluate('new Promise(resolve=>setTimeout(()=>resolve(window.__interactionFixture.view.contentEl.scrollTop),250))');
 assert(scrolled > point.before, 'Native mouse wheel over preview scrolls the list');
 console.log('PASS Native mouse wheel over preview scrolls the list');
 await send('Browser.close');
} finally {
 socket?.close();
 if (child && child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once('exit', resolve)); }
 await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
