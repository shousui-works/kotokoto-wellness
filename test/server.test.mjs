import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {request as httpRequest} from 'node:http';
import {mkdtemp, mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAppServer} from '../server/index.mjs';
import {spawnSync} from 'node:child_process';
import {createFirebaseRuntime} from '../server/firebase-runtime.mjs';

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


test('handler failures return a generic error or close a partial response, without terminating the server',()=>{
 const script=`
  import assert from 'node:assert/strict';
  import {createAppServer} from ${JSON.stringify(new URL('../server/index.mjs',import.meta.url).href)};
  const logs=[];console.error=(...args)=>logs.push(args.join(' '));
  for(const which of ['accountHandler','chatHandler'])for(const mode of ['throw','reject','partial']){
   const handler=(req,res,path)=>{
    if(path!=='/failure')return false;
    if(mode==='partial'){res.writeHead(200);res.write('partial');return Promise.reject(Error('private synthetic content'));}
    if(mode==='reject')return Promise.reject(Error('private synthetic content'));
    throw Error('private synthetic content');
   };
   const server=createAppServer({[which]:handler});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   const url='http://127.0.0.1:'+server.address().port;
   try{
    if(mode==='partial')await assert.rejects(async()=>{const response=await fetch(url+'/failure');await response.text();});
    else{const response=await fetch(url+'/failure');assert.equal(response.status,500);assert.equal(await response.text(),'Internal server error\\n');}
    assert.equal((await fetch(url+'/healthz')).status,200);
   }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
  assert.equal(logs.length,6);assert.ok(logs.every(line=>!line.includes('private synthetic content')));
 `;
 const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:15000});
 assert.equal(child.status,0,child.stderr||child.error?.message);
});

test('default startup and legacy mode cannot spend AI usage without authentication',async t=>{
 const originalKey=process.env.OPENAI_API_KEY,originalFetch=globalThis.fetch;let calls=0;
 process.env.OPENAI_API_KEY='synthetic-never-send';globalThis.fetch=async()=>{calls++;throw Error('External requests are forbidden in this test');};
 t.after(()=>{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;});
 for(const accountHandler of [null,await createFirebaseRuntime({ACCOUNT_MODE:'legacy'})]){
  const app=createAppServer({accountHandler});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  try{
   const url='http://127.0.0.1:'+app.address().port;
   const session=await originalFetch(url+'/api/chat/session');assert.equal(session.status,404);assert.equal(session.headers.get('set-cookie'),null);
   const response=await originalFetch(url+'/api/chat',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({text:'synthetic'})});assert.ok(response.status>=400);assert.equal(calls,0);
   assert.equal((await originalFetch(url+'/healthz')).status,200);
  }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
 }
});
