import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const reservePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(error => error ? reject(error) : resolve(port));
  });
});

const waitForHealth = async (baseUrl, child, logs) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Test server exited early (${child.exitCode}).\n${logs.join('')}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server socket is not ready yet.
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for test server.\n${logs.join('')}`);
};

const stopChild = async (child) => {
  if (child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  let timeout;
  await Promise.race([
    exited,
    new Promise(resolve => {
      timeout = setTimeout(resolve, 5000);
      timeout.unref?.();
    })
  ]);
  clearTimeout(timeout);
  if (child.exitCode === null) child.kill('SIGKILL');
};

test('auth, collision-safe save, account streak and parser errors work together', { timeout: 30000 }, async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'vocabmaster-api-test-'));
  const databasePath = path.join(tempDirectory, 'database.db');
  const distPath = path.join(tempDirectory, 'dist');
  await mkdir(path.join(distPath, 'assets'), { recursive: true });
  await writeFile(
    path.join(distPath, 'index.html'),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app-a1b2c3.js"></script></body></html>',
    'utf8'
  );
  await writeFile(path.join(distPath, 'assets', 'app-a1b2c3.js'), 'document.body.dataset.loaded = "true";', 'utf8');
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: '',
      SQLITE_DB_PATH: databasePath,
      DIST_PATH: distPath,
      JWT_SECRET: 'integration-test-secret-that-is-longer-than-thirty-two-bytes',
      NODE_ENV: 'test',
      REQUEST_BODY_LIMIT: '2kb',
      CLIENT_ORIGIN: baseUrl
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => logs.push(chunk.toString()));
  child.stderr.on('data', chunk => logs.push(chunk.toString()));

  const request = async (pathname, { method = 'GET', cookie, body, rawBody } = {}) => {
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body))
    });
  };

  try {
    await waitForHealth(baseUrl, child, logs);
    const today = new Date().toISOString().slice(0, 10);

    const shellResponse = await fetch(`${baseUrl}/`);
    assert.equal(shellResponse.status, 200);
    assert.match(shellResponse.headers.get('cache-control'), /no-store/);
    const shellHtml = await shellResponse.text();
    const modulePath = shellHtml.match(/<script[^>]+src="([^"]+)"/)?.[1];
    assert.equal(modulePath, '/assets/app-a1b2c3.js');

    const moduleResponse = await fetch(`${baseUrl}${modulePath}`, {
      headers: { Origin: baseUrl }
    });
    assert.equal(moduleResponse.status, 200);
    assert.match(moduleResponse.headers.get('cache-control'), /immutable/);

    const sameOriginHealth = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: baseUrl }
    });
    assert.equal(sameOriginHealth.status, 200);
    const deniedHealth = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://malicious.example' }
    });
    assert.equal(deniedHealth.status, 403);

    const registerResponse = await request('/api/auth/register', {
      method: 'POST',
      body: { username: 'integration-user', password: 'secret123', localDate: today }
    });
    assert.equal(registerResponse.status, 201);
    const cookie = registerResponse.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie?.startsWith('token='));
    assert.match(registerResponse.headers.get('set-cookie'), /HttpOnly/i);
    const registered = await registerResponse.json();
    assert.equal('token' in registered, false);
    assert.deepEqual(registered.streak, { count: 0, lastStudyDate: null });

    const wrongLoginResponse = await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'integration-user', password: 'incorrect', localDate: today }
    });
    assert.equal(wrongLoginResponse.status, 401);

    const submittedSet = {
      id: 'set/collision',
      title: 'Collision-safe set',
      description: '',
      cards: [
        { id: 'card/a', english: 'one', vietnamese: 'một', stats: { correct: 2147483647, wrong: 2147483647 } },
        { id: 'card?a', english: 'two', vietnamese: 'hai', stats: { correct: 0, wrong: 0 } }
      ]
    };
    const saveResponse = await request('/api/sets', { method: 'POST', cookie, body: submittedSet });
    assert.equal(saveResponse.status, 200);
    const saved = await saveResponse.json();
    assert.equal(saved.set.cards.length, 2);
    assert.notEqual(saved.set.cards[0].id, saved.set.cards[1].id);
    assert.equal(saved.set.id, saved.setId);

    const retryResponse = await request('/api/sets', { method: 'POST', cookie, body: submittedSet });
    assert.equal(retryResponse.status, 200);
    const retried = await retryResponse.json();
    assert.equal(retried.setId, saved.setId);
    assert.deepEqual(retried.set.cards.map(card => card.id), saved.set.cards.map(card => card.id));
    assert.equal(retried.set.updatedAt, saved.set.updatedAt);

    const updatedPayload = {
      ...saved.set,
      expectedUpdatedAt: saved.set.updatedAt,
      title: 'Updated on the newest device',
      cards: [
        ...saved.set.cards,
        { id: 'third-card', english: 'three', vietnamese: 'ba', stats: { correct: 0, wrong: 0 } }
      ]
    };
    const updateResponse = await request('/api/sets', { method: 'POST', cookie, body: updatedPayload });
    assert.equal(updateResponse.status, 200);
    const updated = (await updateResponse.json()).set;
    assert.equal(updated.cards.length, 3);
    assert.ok(updated.updatedAt > saved.set.updatedAt);

    const staleEditResponse = await request('/api/sets', {
      method: 'POST',
      cookie,
      body: {
        ...saved.set,
        expectedUpdatedAt: saved.set.updatedAt,
        title: 'Stale overwrite attempt',
        cards: saved.set.cards.slice(0, 1)
      }
    });
    assert.equal(staleEditResponse.status, 409);
    assert.equal((await staleEditResponse.json()).code, 'SET_CONFLICT');

    const staleSyncResponse = await request('/api/sets/sync-batch', {
      method: 'POST',
      cookie,
      body: {
        sets: [{ ...saved.set, expectedUpdatedAt: saved.set.updatedAt, title: 'Stale sync attempt' }]
      }
    });
    assert.equal(staleSyncResponse.status, 409);

    const allSetsResponse = await request('/api/sets', { cookie });
    const allSets = await allSetsResponse.json();
    assert.equal(allSets.sets.length, 1);
    assert.equal(allSets.sets[0].title, 'Updated on the newest device');
    assert.equal(allSets.sets[0].cards.length, 3);

    for (const isCorrect of [true, false]) {
      const progressResponse = await request('/api/sets/word-stats', {
        method: 'POST',
        cookie,
        body: {
          setId: saved.setId,
          cardId: saved.set.cards[0].id,
          isCorrect,
          studyDate: today
        }
      });
      assert.equal(progressResponse.status, 200);
      assert.equal((await progressResponse.json()).streak.count, 1);
    }

    const progressedSetsResponse = await request('/api/sets', { cookie });
    const progressedSets = await progressedSetsResponse.json();
    assert.deepEqual(progressedSets.sets[0].cards[0].stats, {
      correct: 2147483647,
      wrong: 2147483647
    });
    assert.equal(progressedSets.sets[0].updatedAt, updated.updatedAt);

    const meResponse = await request(`/api/auth/me?localDate=${today}`, { cookie });
    assert.equal(meResponse.status, 200);
    const me = await meResponse.json();
    assert.deepEqual(me.streak, { count: 1, lastStudyDate: today });

    const secondRegisterResponse = await request('/api/auth/register', {
      method: 'POST',
      body: { username: 'second-integration-user', password: 'secret123', localDate: today }
    });
    assert.equal(secondRegisterResponse.status, 201);
    const secondCookie = secondRegisterResponse.headers.get('set-cookie')?.split(';')[0];
    const secondMeResponse = await request(`/api/auth/me?localDate=${today}`, { cookie: secondCookie });
    assert.equal(secondMeResponse.status, 200);
    assert.deepEqual((await secondMeResponse.json()).streak, { count: 0, lastStudyDate: null });

    const invalidDateResponse = await request('/api/sets/word-stats', {
      method: 'POST',
      cookie,
      body: {
        setId: saved.setId,
        cardId: saved.set.cards[0].id,
        isCorrect: true,
        studyDate: '2000-01-01'
      }
    });
    assert.equal(invalidDateResponse.status, 400);

    const invalidSetResponse = await request('/api/sets', {
      method: 'POST',
      cookie,
      body: { title: 'Missing id', cards: submittedSet.cards }
    });
    assert.equal(invalidSetResponse.status, 400);

    const nullCharacterResponse = await request('/api/sets', {
      method: 'POST',
      cookie,
      body: {
        id: 'null-character-set',
        title: 'Contains\u0000null',
        cards: [{ id: 'card', english: 'safe', vietnamese: 'an toàn' }]
      }
    });
    assert.equal(nullCharacterResponse.status, 400);

    const malformedResponse = await request('/api/auth/login', {
      method: 'POST',
      rawBody: '{broken-json'
    });
    assert.equal(malformedResponse.status, 400);

    const oversizedResponse = await request('/api/auth/login', {
      method: 'POST',
      rawBody: JSON.stringify({ username: 'x'.repeat(3000), password: 'secret123' })
    });
    assert.equal(oversizedResponse.status, 413);

    const staleDeleteResponse = await request(`/api/sets/${encodeURIComponent(updated.id)}`, {
      method: 'DELETE',
      cookie,
      body: { expectedUpdatedAt: saved.set.updatedAt }
    });
    assert.equal(staleDeleteResponse.status, 409);
    const currentDeleteResponse = await request(`/api/sets/${encodeURIComponent(updated.id)}`, {
      method: 'DELETE',
      cookie,
      body: { expectedUpdatedAt: updated.updatedAt }
    });
    assert.equal(currentDeleteResponse.status, 200);

    const deleteResponse = await request('/api/auth/account', { method: 'DELETE', cookie });
    assert.equal(deleteResponse.status, 200);
    const revokedResponse = await request(`/api/auth/me?localDate=${today}`, { cookie });
    assert.equal(revokedResponse.status, 401);
  } finally {
    await stopChild(child);
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
