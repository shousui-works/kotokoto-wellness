import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {request as httpRequest} from 'node:http';
import {mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAppServer} from '../server/index.mjs';

let server, directory, port;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'kotokoto-server-'));
  const root = join(directory, 'dist');
  await mkdir(join(root, 'assets'), {recursive: true});
  await writeFile(join(root, 'index.html'), '<!doctype html><title>こつこつ日和</title>');
  await writeFile(join(root, 'app.mjs'), 'export const ready = true;');
  await writeFile(join(root, 'style.css'), 'body { margin: 0; }');
  await writeFile(join(root, 'assets', 'dog.png'), Buffer.from([137, 80, 78, 71]));
  await writeFile(join(root, '.env'), 'TEST_ONLY=hidden');
  await writeFile(join(directory, 'private.txt'), 'outside public directory');
  await symlink(join(directory, 'private.txt'), join(root, 'outside.txt'));
  server = createAppServer({root});
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});

after(async () => {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (directory) await rm(directory, {recursive: true, force: true});
});

function request(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = httpRequest({hostname: '127.0.0.1', port, path, method}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the app and supports HEAD without a response body', async () => {
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /こつこつ日和/);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.equal(page.headers['cache-control'], 'no-cache');
  const head = await request('/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-length'], String(page.body.length));
});

test('serves modules, styles and binary images with query strings and correct MIME types', async () => {
  const module = await request('/app.mjs?v=play-1');
  assert.equal(module.status, 200);
  assert.match(module.headers['content-type'], /^text\/javascript/);
  assert.match((await request('/style.css')).headers['content-type'], /^text\/css/);
  const image = await request('/assets/dog.png');
  assert.equal(image.headers['content-type'], 'image/png');
  assert.deepEqual(image.body, Buffer.from([137, 80, 78, 71]));
});

test('health checks reveal only readiness and are not cached', async () => {
  const response = await request('/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {status: 'ok'});
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

test('rejects writes, missing files and directory listings', async () => {
  const write = await request('/', 'POST');
  assert.equal(write.status, 405);
  assert.equal(write.headers.allow, 'GET, HEAD');
  assert.equal((await request('/missing')).status, 404);
  assert.equal((await request('/assets/')).status, 404);
});

test('blocks traversal, hidden files, malformed URLs and symlinks outside dist', async () => {
  for (const path of ['/../private.txt', '/%2e%2e/private.txt', '/.env', '/%2eenv', '/.openai/hosting.json', '/outside.txt']) {
    assert.equal((await request(path)).status, 404, path);
  }
  for (const path of ['/bad%00file', '/bad%zz', '/%5cprivate.txt']) {
    assert.equal((await request(path)).status, 400, path);
  }
});
