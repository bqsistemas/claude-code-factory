import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { AVATARS, OCTOPUS } from '../factory/avatars.js';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

let server;
let baseUrl;
let port;

before(async () => {
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  ({ port } = server.address());
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// Sends a request with the path left exactly as written. `fetch` normalizes
// `/../x` to `/x`, which would hide a traversal attempt from the server.
function rawRequest(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function assertSecurityHeaders(headers, label) {
  assert.equal(headers['x-content-type-options'], 'nosniff', `${label}: nosniff`);
  assert.match(headers['content-security-policy'] ?? '', /default-src 'self'/, `${label}: CSP`);
}

test('AC-1: GET / returns 200 HTML with the welcome heading', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  const body = await res.text();
  assert.match(body, /<h1 id="welcome"[^>]*>\s*Welcome, Player One!\s*<\/h1>/);
});

test('AC-2: GET / contains the HUD, XP bar, stylesheet link and quest log', async () => {
  const body = await (await fetch(`${baseUrl}/`)).text();
  assert.match(body, /<html lang="en">/);
  assert.match(body, /<link rel="stylesheet" href="\/styles.css">/);
  assert.match(body, /<progress id="xp"[^>]*aria-label="[^"]+"/);
  assert.match(body, /id="level"/);
  const questLog = body.match(/<section id="quest-log"[\s\S]*?<\/section>/);
  assert.ok(questLog, 'quest-log section exists');
  assert.match(questLog[0], /<li class="quest/);
  assert.doesNotMatch(body, /<script/i, 'no scripts');
  assert.doesNotMatch(body, /\sstyle="/i, 'no inline style attributes');
});

test('AC-3: GET /styles.css returns CSS with :root custom properties and reduced-motion block', async () => {
  const res = await fetch(`${baseUrl}/styles.css`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/css/);
  const body = await res.text();
  assert.match(body, /:root\s*\{[^}]*--[\w-]+\s*:/);
  assert.match(body, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('AC-4: unknown paths and traversal attempts return 404 without file contents', async () => {
  const pkg = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  for (const path of ['/nope', '/../package.json', '/%2e%2e/package.json', '/package.json', '/public/index.html', '/index.html']) {
    const res = await rawRequest('GET', path);
    assert.equal(res.status, 404, `${path} status`);
    assert.match(res.headers['content-type'], /^text\/plain/, `${path} content-type`);
    assert.equal(res.body, 'Not found', `${path} body`);
    assert.ok(!res.body.includes(pkg.trim().slice(0, 20)), `${path} leaks no file contents`);
  }
});

test('AC-5: POST / returns 405 with Allow: GET, HEAD', async () => {
  for (const path of ['/', '/styles.css']) {
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST' });
    assert.equal(res.status, 405, `${path} status`);
    assert.equal(res.headers.get('allow'), 'GET, HEAD', `${path} Allow`);
    await res.arrayBuffer();
  }
});

test('AC-6: every response sets nosniff and a default-src self CSP', async () => {
  const cases = [
    ['GET', '/'],
    ['HEAD', '/'],
    ['GET', '/styles.css'],
    ['HEAD', '/styles.css'],
    ['GET', '/nope'],
    ['GET', '/../package.json'],
    ['POST', '/'],
  ];
  for (const [method, path] of cases) {
    const res = await rawRequest(method, path);
    assertSecurityHeaders(res.headers, `${method} ${path}`);
  }
});

test('AC-7: importing src/app.js does not listen, so the process exits on its own', async () => {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', "await import('./src/app.js');"],
      { cwd: rootDir, stdio: 'ignore' },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('process did not exit: importing app.js keeps the event loop alive'));
    }, 5000);
    child.on('error', reject);
    child.on('exit', (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  assert.equal(code, 0);
  assert.equal(createApp().listening, false, 'createApp() returns a server that is not listening');
});

test('AC-8: package.json is an ES module with no dependencies and runs node --test test/', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts?.test, 'node --test test/');
  assert.equal(pkg.scripts?.start, 'node src/server.js');
  assert.equal(pkg.engines?.node, '>=20');
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'no dependencies');
});

test('HEAD / and HEAD /styles.css return headers with an empty body', async () => {
  for (const [path, type] of [['/', /^text\/html/], ['/styles.css', /^text\/css/]]) {
    const res = await rawRequest('HEAD', path);
    assert.equal(res.status, 200, `${path} status`);
    assert.match(res.headers['content-type'], type, `${path} content-type`);
    assert.equal(res.body, '', `${path} body`);
  }
});

describe('job 002: Remotion factory learning game', () => {
  const gameScriptTag = '<script type="module" src="/game.js"></script>';

  test('AC-1: package.json keeps Remotion, React, and esbuild in devDependencies and adds build:game', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    for (const name of ['remotion', '@remotion/player', 'react', 'react-dom', 'esbuild']) {
      assert.ok(pkg.devDependencies?.[name], `${name} is a devDependency`);
    }
    assert.match(pkg.devDependencies.remotion, /^\^?4\./, 'remotion 4.x');
    assert.equal(pkg.devDependencies['@remotion/player'], pkg.devDependencies.remotion, 'player matches remotion');
    assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'no runtime dependencies');
    assert.equal(pkg.scripts?.test, 'node --test test/');
    const build = pkg.scripts?.['build:game'] ?? '';
    assert.match(build, /src\/game\/main\.jsx/, 'build:game reads src/game/main.jsx');
    assert.match(build, /public\/game\.js/, 'build:game writes public/game.js');
    const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
    assert.match(gitignore, /^node_modules\/$/m, '.gitignore has node_modules/');
  });

  test('AC-6: /game and /game.js are served with the right types, methods, and headers', async () => {
    const page = await fetch(`${baseUrl}/game`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    const html = await page.text();
    assert.match(html, /lang="es"/);
    assert.match(html, /id="game"/);
    assert.match(html, /id="score"/);
    assert.ok(html.includes(gameScriptTag), 'module script tag');
    assert.equal(html.match(/<script/gi).length, 1, 'exactly one script');
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/i, 'no inline script');
    assert.doesNotMatch(html, /\sstyle="/i, 'no inline style attributes');
    assert.match(html, /<a\s[^>]*href="\/"/, 'link back to /');

    const bundle = await fetch(`${baseUrl}/game.js`);
    assert.equal(bundle.status, 200);
    assert.match(bundle.headers.get('content-type'), /^text\/javascript/);
    assert.ok((await bundle.text()).length > 0, 'non-empty bundle');

    for (const [path, type] of [['/game', /^text\/html/], ['/game.js', /^text\/javascript/]]) {
      const head = await rawRequest('HEAD', path);
      assert.equal(head.status, 200, `HEAD ${path} status`);
      assert.match(head.headers['content-type'], type, `HEAD ${path} type`);
      assert.equal(head.body, '', `HEAD ${path} empty body`);
      assertSecurityHeaders(head.headers, `HEAD ${path}`);

      const post = await rawRequest('POST', path);
      assert.equal(post.status, 405, `POST ${path} status`);
      assert.equal(post.headers.allow, 'GET, HEAD', `POST ${path} Allow`);
      assertSecurityHeaders(post.headers, `POST ${path}`);

      const get = await rawRequest('GET', path);
      assertSecurityHeaders(get.headers, `GET ${path}`);
    }
  });

  test('AC-7: the landing page links to /game without scripts, and the game sources use Remotion', async () => {
    const body = await (await fetch(`${baseUrl}/`)).text();
    const questLog = body.match(/<section id="quest-log"[\s\S]*?<\/section>/)[0];
    const items = questLog.match(/<li class="quest[\s\S]*?<\/li>/g);
    assert.ok(items.length >= 2, 'a new quest item was added');
    assert.ok(items.some((li) => /<a href="\/game">/.test(li)), 'a quest item links to /game');
    assert.doesNotMatch(body, /<script/i, 'landing page has no scripts');

    const main = await readFile(new URL('../src/game/main.jsx', import.meta.url), 'utf8');
    const loop = await readFile(new URL('../src/game/FactoryLoop.jsx', import.meta.url), 'utf8');
    assert.match(main, /from ['"]@remotion\/player['"]/, 'main.jsx imports @remotion/player');
    assert.match(loop, /from ['"]remotion['"]/, 'FactoryLoop.jsx imports remotion');
  });
});

describe('job 004: one-page game with animated octopus agent characters', () => {
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

  test('AC-5: Octopus.jsx uses the shared avatars and the Remotion frame; FactoryLoop renders it', async () => {
    const octopus = await read('../src/game/Octopus.jsx');
    assert.match(octopus, /from\s+'\.\.\/\.\.\/factory\/avatars\.js'/, 'imports ../../factory/avatars.js');
    assert.match(octopus, /import\s*\{[^}]*\buseCurrentFrame\b[^}]*\}\s*from\s*'remotion'/, 'imports useCurrentFrame from remotion');

    const loop = await read('../src/game/FactoryLoop.jsx');
    assert.match(loop, /import\s*\{[^}]*\bOctopus\b[^}]*\}\s*from\s*['"]\.\/Octopus\.jsx['"]/, 'FactoryLoop imports Octopus');
    assert.match(loop, /<Octopus\b/, 'FactoryLoop renders <Octopus');
  });

  test('AC-6: the committed game bundle carries the shared octopus geometry and colors', async () => {
    const bundle = await read('../public/game.js');
    assert.ok(bundle.includes(OCTOPUS.head), 'bundle contains OCTOPUS.head');
    for (const [name, { color }] of Object.entries(AVATARS)) {
      assert.ok(bundle.includes(color), `bundle contains ${name} color ${color}`);
    }
  });

  test('AC-7: /game is a one-page layout with a scrolling fallback on small viewports', async () => {
    const html = await (await fetch(`${baseUrl}/game`)).text();
    assert.match(html, /<body class="game-page">/);

    const css = await (await fetch(`${baseUrl}/styles.css`)).text();
    const pageRules = [...css.matchAll(/^\.game-page\s*\{([^}]*)\}/gm)].map((m) => m[1]);
    assert.ok(
      pageRules.some((body) => /100dvh/.test(body) && /overflow:\s*hidden/.test(body)),
      '.game-page rule with 100dvh and overflow: hidden',
    );

    const fallback = css.match(/@media \(max-width: 40rem\), \(max-height: 30rem\)\s*\{([\s\S]*?)\n\}/)?.[1];
    assert.ok(fallback, 'has the small-viewport fallback media query');
    const fallbackPage = fallback.match(/\.game-page\s*\{([^}]*)\}/)?.[1];
    assert.ok(fallbackPage, 'fallback has a .game-page rule');
    assert.match(fallbackPage, /overflow-y:\s*auto/);
    assert.match(fallbackPage, /overflow-x:\s*hidden/);

    const main = await read('../src/game/main.jsx');
    for (const cls of ['game__stage', 'game__media', 'game__quiz']) {
      assert.match(css, new RegExp(`\\.${cls}\\b[^{]*\\{`), `styles.css has a .${cls} rule`);
      assert.match(main, new RegExp(`className="${cls}"`), `main.jsx uses ${cls}`);
    }
  });

  test('AC-8: the quest log gains the octopus crew item and keeps the earlier ones', async () => {
    const body = await (await fetch(`${baseUrl}/`)).text();
    const questLog = body.match(/<section id="quest-log"[\s\S]*?<\/section>/)[0];
    const items = questLog.match(/<li class="quest[\s\S]*?<\/li>/g);
    assert.ok(items.some((li) => li.includes('Meet the octopus agent crew')), 'new quest item');
    assert.ok(items.some((li) => li.includes('Build the landing page')), 'first quest kept');
    assert.ok(items.some((li) => li.includes('Play the factory learning game')), 'game quest kept');
  });
});

describe('job 005: fullscreen 3D factory scene with the octopus agent crew', () => {
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

  test('AC-1: package.json adds three, @remotion/three, and @react-three/fiber as exact devDependencies', async () => {
    const pkg = JSON.parse(await read('../package.json'));
    for (const name of ['three', '@remotion/three', '@react-three/fiber']) {
      assert.match(pkg.devDependencies?.[name] ?? '', /^\d/, `${name} is an exact-pinned devDependency`);
    }
    assert.equal(pkg.devDependencies['@remotion/three'], pkg.devDependencies.remotion, '@remotion/three matches remotion');
    assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'no runtime dependencies');
  });

  test('AC-6: the game sources build the 3D scene from the shared avatars and scene layout', async () => {
    const octopus3d = await read('../src/game/Octopus3D.jsx');
    assert.match(octopus3d, /from\s+'\.\.\/\.\.\/factory\/avatars\.js'/, 'Octopus3D imports ../../factory/avatars.js');
    assert.match(octopus3d, /import\s*\{[^}]*\buseCurrentFrame\b[^}]*\}\s*from\s*'remotion'/, 'Octopus3D imports useCurrentFrame from remotion');

    const loop = await read('../src/game/FactoryLoop.jsx');
    assert.match(loop, /import\s*\{[^}]*\bThreeCanvas\b[^}]*\}\s*from\s*'@remotion\/three'/, 'FactoryLoop imports ThreeCanvas');
    assert.match(loop, /from\s+'\.\/scene\.js'/, 'FactoryLoop imports ./scene.js');
    for (const tag of ['<ThreeCanvas', '<Octopus3D', '<Octopus']) {
      assert.ok(loop.includes(tag), `FactoryLoop renders ${tag}`);
    }

    const main = await read('../src/game/main.jsx');
    assert.match(main, /className="game__scene"/, 'main.jsx uses game__scene');
    assert.match(main, /compositionSize\(/, 'main.jsx calls compositionSize(');
    const player = main.match(/<Player\b[\s\S]*?\/>/)?.[0];
    assert.ok(player, 'main.jsx renders a <Player>');
    assert.doesNotMatch(player, /\bcontrols\b/, 'Player has no controls prop');
  });

  test('AC-7: the bundle includes three.js and the avatar colors; .game__scene is a fixed full-viewport layer', async () => {
    const bundle = await read('../public/game.js');
    assert.ok(bundle.includes('__THREE__'), 'three.js is bundled');
    for (const [name, { color }] of Object.entries(AVATARS)) {
      assert.ok(bundle.includes(color), `bundle contains ${name} color ${color}`);
    }

    const css = await (await fetch(`${baseUrl}/styles.css`)).text();
    const rules = [...css.matchAll(/^\.game__scene\s*\{([^}]*)\}/gm)].map((m) => m[1]);
    assert.ok(
      rules.some((body) => /position:\s*fixed/.test(body) && /inset:\s*0/.test(body) && /pointer-events:\s*none/.test(body)),
      '.game__scene rule with position: fixed, inset: 0, pointer-events: none',
    );
  });

  test('AC-8: the quest log gains the 3D factory floor item and keeps the earlier ones', async () => {
    const body = await (await fetch(`${baseUrl}/`)).text();
    const questLog = body.match(/<section id="quest-log"[\s\S]*?<\/section>/)[0];
    const items = questLog.match(/<li class="quest[\s\S]*?<\/li>/g);
    for (const text of ['Tour the 3D factory floor', 'Build the landing page', 'Play the factory learning game', 'Meet the octopus agent crew']) {
      assert.ok(items.some((li) => li.includes(text)), `quest item: ${text}`);
    }
  });
});
