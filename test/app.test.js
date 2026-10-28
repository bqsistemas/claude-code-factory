import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import { AVATARS, OCTOPUS } from '../factory/avatars.js';
import { STAGES } from '../src/game/engine.js';

// The committed game bundle only carries the agents the game shows (STAGES). The
// intake agent (job 012) is in AVATARS but not in the game until the bundle is rebuilt.
const gameAvatars = () => Object.entries(AVATARS)
  .filter(([name]) => STAGES.some((stage) => stage.agents.some((agent) => agent.name === name)));

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
    for (const [name, { color }] of gameAvatars()) {
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

  test('AC-7: the bundle includes the avatar colors; .game__scene is a fixed full-viewport layer', async () => {
    const bundle = await read('../public/game.js');
    for (const [name, { color }] of gameAvatars()) {
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

describe('job 006: camera framing and flow labels', () => {
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

  test('AC-6: the committed game bundle contains the rework label', async () => {
    const bundle = await read('../public/game.js');
    assert.ok(bundle.includes('Retrabajo: cambios pedidos'), 'bundle contains the rework label');
  });

  test('AC-7: the quest log gains the labeled flow item and keeps the earlier ones', async () => {
    const body = await (await fetch(`${baseUrl}/`)).text();
    const questLog = body.match(/<section id="quest-log"[\s\S]*?<\/section>/)[0];
    const items = questLog.match(/<li class="quest[\s\S]*?<\/li>/g);
    for (const text of [
      'Follow the labeled factory flow',
      'Build the landing page',
      'Play the factory learning game',
      'Meet the octopus agent crew',
      'Tour the 3D factory floor',
    ]) {
      assert.ok(items.some((li) => li.includes(text)), `quest item: ${text}`);
    }
  });
});

describe('job 007: iso-glow factory floor', () => {
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const questItems = async () => {
    const body = await (await fetch(`${baseUrl}/`)).text();
    const questLog = body.match(/<section id="quest-log"[\s\S]*?<\/section>/)[0];
    return questLog.match(/<li class="quest[\s\S]*?<\/li>/g);
  };

  test('AC-1: the three.js packages, Octopus3D, and every three.js import are gone', async () => {
    const pkg = JSON.parse(await read('../package.json'));
    for (const name of ['three', '@remotion/three', '@react-three/fiber']) {
      assert.equal(pkg.devDependencies?.[name], undefined, `${name} is not a devDependency`);
    }
    assert.equal(pkg.devDependencies['@remotion/player'], pkg.devDependencies.remotion, 'player matches remotion');
    assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'no runtime dependencies');

    const gameDir = new URL('../src/game/', import.meta.url);
    const files = await readdir(gameDir);
    assert.ok(!files.includes('Octopus3D.jsx'), 'src/game/Octopus3D.jsx is deleted');
    for (const file of files) {
      const source = await readFile(new URL(file, gameDir), 'utf8');
      assert.doesNotMatch(
        source,
        /from\s*['"](three|@remotion\/three|@react-three\/fiber)['"]/,
        `${file} imports nothing from three.js packages`,
      );
    }

    const bundle = await read('../public/game.js');
    assert.ok(!bundle.includes('__THREE__'), 'three.js is not bundled');
  });

  test('AC-5: FactoryLoop draws an accessible SVG iso-glow scene from the iso kernel', async () => {
    const loop = await read('../src/game/FactoryLoop.jsx');
    assert.match(loop, /from\s*'remotion'/, 'imports remotion');
    const sceneImport = loop.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/scene\.js'/)?.[1] ?? '';
    for (const name of ['iso', 'FLOOR_VIEWBOX']) {
      assert.match(sceneImport, new RegExp(`\\b${name}\\b`), `imports ${name} from ./scene.js`);
    }
    for (const text of [
      '<svg',
      'role="img"',
      'aria-label',
      'iso-scene',
      'iso-hot',
      'filterUnits="userSpaceOnUse"',
      'url(#iso-bloom)',
      'stage.title',
      'Retrabajo: cambios pedidos',
      '<Octopus',
    ]) {
      assert.ok(loop.includes(text), `FactoryLoop contains ${text}`);
    }
    for (const text of ['<style', 'ThreeCanvas', 'Octopus3D', 'getContext(']) {
      assert.ok(!loop.includes(text), `FactoryLoop does not contain ${text}`);
    }

    const main = await read('../src/game/main.jsx');
    assert.match(main, /className="game__scene"/, 'main.jsx uses game__scene');
    assert.match(main, /compositionSize\(/, 'main.jsx calls compositionSize(');
    const player = main.match(/<Player\b[\s\S]*?\/>/)?.[0];
    assert.ok(player, 'main.jsx renders a <Player>');
    assert.doesNotMatch(player, /\bcontrols\b/, 'Player has no controls prop');
  });

  test('AC-6: styles.css defines the iso-glow tokens and hairline classes and keeps the scene layer', async () => {
    const css = await (await fetch(`${baseUrl}/styles.css`)).text();
    const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
    assert.match(root, /--iso-accent\s*:/, ':root defines --iso-accent');

    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
    assert.ok(
      rules.some((r) => r.selector.includes('.iso-scene') && r.selector.includes('.iso-hot') && r.body.includes('var(--iso-accent')),
      'an .iso-scene .iso-hot rule uses var(--iso-accent',
    );
    assert.ok(
      rules.some((r) => r.selector.includes('.iso-scene') && /vector-effect:\s*non-scaling-stroke/.test(r.body)),
      'an .iso-scene rule sets vector-effect: non-scaling-stroke',
    );

    const scene = [...css.matchAll(/^\.game__scene\s*\{([^}]*)\}/gm)].map((m) => m[1]);
    assert.ok(
      scene.some((body) => /position:\s*fixed/.test(body) && /inset:\s*0/.test(body) && /pointer-events:\s*none/.test(body)),
      '.game__scene rule with position: fixed, inset: 0, pointer-events: none',
    );
  });

  test('AC-7: /game credits ISO-GLOW without inline code, and the bundle carries the scene', async () => {
    const html = await (await fetch(`${baseUrl}/game`)).text();
    const credit = html.match(/<a\s[^>]*href="https:\/\/iso-glow\.vercel\.app"[^>]*>([\s\S]*?)<\/a>/);
    assert.ok(credit, 'links to https://iso-glow.vercel.app');
    assert.match(credit[1], /Made with ISO-GLOW/, 'credit text');
    assert.equal(html.match(/<script/gi).length, 1, 'exactly one script');
    assert.doesNotMatch(html, /\sstyle="/i, 'no inline style attributes');

    const bundle = await read('../public/game.js');
    for (const text of ['Retrabajo: cambios pedidos', 'iso-scene']) {
      assert.ok(bundle.includes(text), `bundle contains ${text}`);
    }
    for (const [name, { color }] of gameAvatars()) {
      assert.ok(bundle.includes(color), `bundle contains ${name} color ${color}`);
    }
  });

  test('AC-8: the quest log gains the iso-glow item and keeps the earlier ones', async () => {
    const items = await questItems();
    for (const text of [
      'Light up the iso-glow factory floor',
      'Build the landing page',
      'Play the factory learning game',
      'Meet the octopus agent crew',
      'Tour the 3D factory floor',
      'Follow the labeled factory flow',
    ]) {
      assert.ok(items.some((li) => li.includes(text)), `quest item: ${text}`);
    }
  });
});

describe('job 008: guided loop tour', () => {
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const cssRules = (css) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

  test('AC-4: FactoryLoop draws an optional layer of clickable, keyboard-operable stations', async () => {
    const loop = await read('../src/game/FactoryLoop.jsx');
    const sceneImport = loop.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/scene\.js'/)?.[1] ?? '';
    assert.match(sceneImport, /\bstationOutline\b/, 'imports stationOutline from ./scene.js');
    for (const text of ['onSelect', 'iso-hits', 'iso-hit', 'role="group"', 'role="button"', 'tabIndex={0}', 'onKeyDown', 'aria-current', 'Enter']) {
      assert.ok(loop.includes(text), `FactoryLoop contains ${text}`);
    }
    for (const text of [
      '<svg',
      'role="img"',
      'aria-label',
      'iso-scene',
      'iso-hot',
      'filterUnits="userSpaceOnUse"',
      'url(#iso-bloom)',
      'stage.title',
      'Retrabajo: cambios pedidos',
      '<Octopus',
    ]) {
      assert.ok(loop.includes(text), `FactoryLoop still contains ${text}`);
    }
    for (const text of ['<style', 'ThreeCanvas', 'Octopus3D', 'getContext(']) {
      assert.ok(!loop.includes(text), `FactoryLoop does not contain ${text}`);
    }
  });

  test('AC-5: main.jsx has the "Ver el loop" tour screen driven by tour.js', async () => {
    const main = await read('../src/game/main.jsx');
    const tourImport = main.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/tour\.js'/)?.[1] ?? '';
    for (const name of ['createTour', 'nextStep', 'selectStep', 'togglePlaying', 'TOUR_STEP_MS']) {
      assert.match(tourImport, new RegExp(`\\b${name}\\b`), `imports ${name} from ./tour.js`);
    }
    for (const text of [
      'Ver el loop',
      'Loop guiado',
      'Pausar',
      'Reanudar',
      'Salir del loop',
      'aria-live="polite"',
      'setTimeout(',
      'clearTimeout(',
      'onSelect',
    ]) {
      assert.ok(main.includes(text), `main.jsx contains ${text}`);
    }
    const players = main.match(/<Player\b[\s\S]*?\/>/g) ?? [];
    assert.ok(players.length >= 2, 'main.jsx renders a Player for the quiz and the tour');
    for (const player of players) {
      assert.doesNotMatch(player, /\bcontrols\b/, 'Player has no controls prop');
    }
  });

  test('AC-6: styles.css makes only the station hit polygons clickable, with an accent focus hairline', async () => {
    const css = await (await fetch(`${baseUrl}/styles.css`)).text();
    const rules = cssRules(css);
    assert.ok(
      rules.some(
        (r) => r.selector.includes('.iso-hit') && /pointer-events:\s*all\s*!important/.test(r.body) && /cursor:\s*pointer/.test(r.body),
      ),
      'an .iso-hit rule sets pointer-events: all !important and cursor: pointer',
    );
    assert.ok(
      rules.some((r) => r.selector.includes('.iso-hit:focus-visible') && r.body.includes('var(--iso-accent')),
      'an .iso-hit:focus-visible rule uses var(--iso-accent',
    );

    const scene = [...css.matchAll(/^\.game__scene\s*\{([^}]*)\}/gm)].map((m) => m[1]);
    assert.ok(
      scene.some((body) => /position:\s*fixed/.test(body) && /inset:\s*0/.test(body) && /pointer-events:\s*none/.test(body)),
      '.game__scene rule with position: fixed, inset: 0, pointer-events: none',
    );
    const sceneAll = [...css.matchAll(/^\.game__scene \*\s*\{([^}]*)\}/gm)].map((m) => m[1]);
    assert.ok(
      sceneAll.some((body) => /pointer-events:\s*none\s*!important/.test(body)),
      '.game__scene * rule keeps pointer-events: none !important',
    );
  });

  test('AC-7: the bundle carries the tour, /game stays inline-free, and the docs explain it', async () => {
    const bundle = await read('../public/game.js');
    for (const text of ['Ver el loop', 'Salir del loop', 'iso-hits']) {
      assert.ok(bundle.includes(text), `bundle contains ${text}`);
    }

    const html = await (await fetch(`${baseUrl}/game`)).text();
    assert.equal(html.match(/<script/gi).length, 1, 'exactly one script');
    assert.doesNotMatch(html, /\sstyle="/i, 'no inline style attributes');

    const guide = await read('../docs/juego-factory.md');
    assert.ok(guide.includes('Ver el loop'), 'guide mentions Ver el loop');
    for (const heading of ['## Qué es el juego', '## Cómo jugar', '## Etapas del factory', '## Puntuación', '## Cómo ejecutarlo']) {
      assert.match(guide, new RegExp(`^${heading}\\s*$`, 'm'), `heading ${heading}`);
    }
  });

  test('AC-8: the quest log gains the guided tour item and keeps the earlier ones', async () => {
    const body = await (await fetch(`${baseUrl}/`)).text();
    const questLog = body.match(/<section id="quest-log"[\s\S]*?<\/section>/)[0];
    const items = questLog.match(/<li class="quest[\s\S]*?<\/li>/g);
    for (const text of [
      'Take the guided factory loop tour',
      'Build the landing page',
      'Play the factory learning game',
      'Meet the octopus agent crew',
      'Tour the 3D factory floor',
      'Follow the labeled factory flow',
      'Light up the iso-glow factory floor',
    ]) {
      assert.ok(items.some((li) => li.includes(text)), `quest item: ${text}`);
    }
  });
});

describe('job 009: approval fork on the iso floor', () => {
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const labels = ['APPROVE: merge a main', 'ESCALATE: needs-human'];

  test('AC-5: FactoryLoop draws the fork from FORK with dotted branch wires and keeps the earlier scene', async () => {
    const loop = await read('../src/game/FactoryLoop.jsx');
    const sceneImport = loop.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/scene\.js'/)?.[1] ?? '';
    assert.match(sceneImport, /\bFORK\b/, 'imports FORK from ./scene.js');
    for (const text of ['iso-fork', 'iso-branch', 'strokeDasharray="2 4"']) {
      assert.ok(loop.includes(text), `FactoryLoop contains ${text}`);
    }
    assert.ok(loop.includes('branch.label') || labels.every((l) => loop.includes(l)), 'FactoryLoop draws the branch labels');
    for (const text of [
      '<svg',
      'role="img"',
      'aria-label',
      'iso-scene',
      'iso-hot',
      'filterUnits="userSpaceOnUse"',
      'url(#iso-bloom)',
      'stage.title',
      'Retrabajo: cambios pedidos',
      '<Octopus',
      'onSelect',
      'iso-hits',
      'iso-hit',
      'role="group"',
      'role="button"',
      'tabIndex={0}',
      'onKeyDown',
      'aria-current',
      'Enter',
      'stationOutline',
    ]) {
      assert.ok(loop.includes(text), `FactoryLoop still contains ${text}`);
    }
    assert.ok(!loop.includes('<style'), 'FactoryLoop has no <style');
  });

  test('AC-6: the bundle carries the fork and /game stays inline-free', async () => {
    const bundle = await read('../public/game.js');
    for (const text of ['iso-fork', 'iso-branch', ...labels]) {
      assert.ok(bundle.includes(text), `bundle contains ${text}`);
    }
    const html = await (await fetch(`${baseUrl}/game`)).text();
    assert.equal(html.match(/<script/gi).length, 1, 'exactly one script');
    assert.doesNotMatch(html, /\sstyle="/i, 'no inline style attributes');
  });

  test('AC-7: the quest log gains the approval fork item, keeps the earlier ones, and the guide names the bifurcación', async () => {
    const body = await (await fetch(`${baseUrl}/`)).text();
    const questLog = body.match(/<section id="quest-log"[\s\S]*?<\/section>/)[0];
    const items = questLog.match(/<li class="quest[\s\S]*?<\/li>/g);
    for (const text of [
      'See the approval fork on the factory floor',
      'Build the landing page',
      'Play the factory learning game',
      'Meet the octopus agent crew',
      'Tour the 3D factory floor',
      'Follow the labeled factory flow',
      'Light up the iso-glow factory floor',
      'Take the guided factory loop tour',
    ]) {
      assert.ok(items.some((li) => li.includes(text)), `quest item: ${text}`);
    }
    const guide = await read('../docs/juego-factory.md');
    assert.ok(guide.includes('bifurcación'), 'guide mentions the bifurcación');
  });
});

describe('job 010: living factory pipeline', () => {
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const cssRules = (css) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
  // The source of a top-level function, up to the next top-level function, const, or export.
  const topLevel = (source, name) =>
    source.match(new RegExp(`^function ${name}\\b[\\s\\S]*?(?=^(?:function|export|const)\\b)`, 'm'))?.[0] ?? '';

  test('AC-1: the floor caption no longer repeats the stage number and title', async () => {
    const loop = await read('../src/game/FactoryLoop.jsx');
    const caption = topLevel(loop, 'Caption');
    assert.ok(caption.length > 0, 'FactoryLoop.jsx has a Caption function');
    for (const text of ['stage.title', 'STAGES.length', 'Etapa']) {
      assert.ok(!caption.includes(text), `Caption does not contain ${text}`);
    }
    assert.ok(caption.includes('Escribe'), 'Caption keeps the output file');
    assert.ok(loop.includes('stage.title'), 'station labels still use stage.title');

    const main = await read('../src/game/main.jsx');
    const tour = topLevel(main, 'TourScreen');
    assert.ok(tour.includes('Loop guiado'), 'TourScreen renders Loop guiado');
    assert.match(tour, /<h1\b[^>]*>\s*\{stage\.title\}\s*<\/h1>/, 'TourScreen renders the stage title h1');
  });

  test('AC-2: a click never outlines a station; keyboard focus keeps the accent hairline', async () => {
    const css = await (await fetch(`${baseUrl}/styles.css`)).text();
    const rules = cssRules(css);
    assert.ok(
      rules.some((r) => /\.iso-hit:focus(?![-\w])/.test(r.selector) && /outline:\s*none/.test(r.body)),
      'an .iso-hit:focus rule sets outline: none',
    );
    assert.ok(
      !rules.some((r) => r.selector.includes('.iso-hit:hover') && /\bstroke[\w-]*\s*:/.test(r.body)),
      'no .iso-hit:hover rule sets a stroke',
    );
    assert.ok(
      rules.some((r) => r.selector.includes('.iso-hit:focus-visible') && r.body.includes('var(--iso-accent')),
      'an .iso-hit:focus-visible rule still uses var(--iso-accent',
    );

    const hits = topLevel(await read('../src/game/FactoryLoop.jsx'), 'StationHits');
    for (const text of ['onMouseDown', 'preventDefault', 'onClick', 'onKeyDown', 'tabIndex={0}', 'role="button"']) {
      assert.ok(hits.includes(text), `StationHits contains ${text}`);
    }
  });

  test('AC-3: lit pods use their avatar colour, and the bundle carries every reviewer colour', async () => {
    const loop = await read('../src/game/FactoryLoop.jsx');
    assert.match(
      loop,
      /import\s*\{[^}]*\bAVATARS\b[^}]*\}\s*from\s*'\.\.\/\.\.\/factory\/avatars\.js'/,
      'FactoryLoop imports AVATARS from ../../factory/avatars.js',
    );
    assert.match(topLevel(loop, 'Pod'), /AVATARS\[[^\]]+\]\??\.color/, 'Pod reads AVATARS[name].color');
    const bundle = await read('../public/game.js');
    for (const color of ['#e5484d', '#d6409f', '#0d9488', '#3b82f6']) {
      assert.ok(bundle.includes(color), `bundle contains ${color}`);
    }
  });

  test('AC-7: the tour Player runs the pipeline and the melody; the quiz Player does not', async () => {
    const main = await read('../src/game/main.jsx');
    const tour = topLevel(main, 'TourScreen');
    const tourPlayer = tour.match(/<Player\b[\s\S]*?\/>/)?.[0] ?? '';
    assert.match(tourPlayer, /pipeline:\s*true/, 'TourScreen passes pipeline: true to its Player');
    assert.match(main, /import\s*\{[^}]*\bphraseFor\b[^}]*\}\s*from\s*'\.\/melody\.js'/, 'imports phraseFor from ./melody.js');
    assert.match(main, /import\s*\{[^}]*\bschedulePhrase\b[^}]*\}\s*from\s*'\.\/sound\.js'/, 'imports schedulePhrase from ./sound.js');
    for (const text of ['AudioContext', '.pause()', 'Silenciar', 'Activar sonido']) {
      assert.ok(main.includes(text), `main.jsx contains ${text}`);
    }
    assert.ok(!topLevel(main, 'StagePlayer').includes('pipeline'), 'the quiz StagePlayer does not pass pipeline');
    const players = main.match(/<Player\b[\s\S]*?\/>/g) ?? [];
    assert.ok(players.length >= 2, 'quiz and tour Players');
    for (const player of players) {
      assert.match(player, /numberOfSharedAudioTags=\{0\}/, 'Player keeps numberOfSharedAudioTags={0}');
      assert.doesNotMatch(player, /\bcontrols\b/, 'Player has no controls prop');
    }

    const loop = await read('../src/game/FactoryLoop.jsx');
    assert.match(loop, /import\s*\{[^}]*\bpipelineAt\b[^}]*\}\s*from\s*'\.\/pipeline\.js'/, 'FactoryLoop imports pipelineAt');
    const sceneImport = loop.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/scene\.js'/)?.[1] ?? '';
    assert.match(sceneImport, /\bHUMAN_ROUTE\b/, 'FactoryLoop imports HUMAN_ROUTE from ./scene.js');
  });

  test('AC-8: /game keeps its CSP and markup, the bundle has the sound toggle, no audio files, docs and quest log updated', async () => {
    const res = await fetch(`${baseUrl}/game`);
    assert.equal(res.headers.get('content-security-policy'), "default-src 'self'", 'same CSP header');
    const html = await res.text();
    assert.equal(html.match(/<script/gi).length, 1, 'exactly one script');
    assert.doesNotMatch(html, /\sstyle="/i, 'no inline style attributes');

    const bundle = await read('../public/game.js');
    for (const text of ['Silenciar', 'Activar sonido']) {
      assert.ok(bundle.includes(text), `bundle contains ${text}`);
    }

    const files = (await readdir(new URL('../public/', import.meta.url))).sort();
    assert.deepEqual(files, ['game.html', 'game.js', 'index.html', 'styles.css'], 'no new files under public/');
    const app = await read('../src/app.js');
    const routes = [...app.matchAll(/\['(\/[^']*)',\s*\{/g)].map((m) => m[1]);
    assert.deepEqual(routes, ['/', '/styles.css', '/game', '/game.js'], 'no new routes');

    const guide = await read('../docs/juego-factory.md');
    for (const text of ['main', 'needs-human', 'melodía']) {
      assert.ok(guide.includes(text), `guide mentions ${text}`);
    }

    const body = await (await fetch(`${baseUrl}/`)).text();
    const questLog = body.match(/<section id="quest-log"[\s\S]*?<\/section>/)[0];
    const items = questLog.match(/<li class="quest[\s\S]*?<\/li>/g);
    for (const text of [
      'Watch the living factory pipeline',
      'Build the landing page',
      'Play the factory learning game',
      'Meet the octopus agent crew',
      'Tour the 3D factory floor',
      'Follow the labeled factory flow',
      'Light up the iso-glow factory floor',
      'Take the guided factory loop tour',
      'See the approval fork on the factory floor',
    ]) {
      assert.ok(items.some((li) => li.includes(text)), `quest item: ${text}`);
    }
  });
});
