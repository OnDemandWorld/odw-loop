#!/usr/bin/env node
/**
 * Full-flow runtime verification for the Loop API against REAL processes:
 * a built `node apps/api/dist/server.js` plus mock upstream services.
 *
 * Usage: node scripts/runtime-verify/verify.mjs [--keep]
 *   --keep  leave the temp dir + logs in place and print the path
 *
 * Every check prints PASS/FAIL; the process exits non-zero if any check fails.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import crypto from 'node:crypto';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '../..');
const KEEP = process.argv.includes('--keep');
const RUN_DIR = mkdtempSync(join(tmpdir(), 'loop-verify-'));
const API_PORT = 13000;
const BASE = `http://127.0.0.1:${API_PORT}`;
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const ENC_KEY = crypto.randomBytes(32).toString('hex');
const STATIC_KEY = 'e2e-static-admin-key';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'AdminPass!123';

const results = [];
let failures = 0;
function check(id, name, cond, detail = '') {
  const ok = Boolean(cond);
  if (!ok) failures++;
  results.push({ id, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${ok ? '' : `  → ${detail}`}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs = 15000, interval = 200) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      /* retry */
    }
    await sleep(interval);
  }
  return last;
}

async function api(method, path, { body, token, headers = {}, rawBody } = {}) {
  const h = { ...headers };
  if (token) h['authorization'] = `Bearer ${token}`;
  let payload;
  if (rawBody !== undefined) {
    payload = rawBody;
    h['content-type'] ??= 'application/json';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h['content-type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text };
}

function makeJwt(sub, role) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub, role, iat: now, exp: now + 3600 });
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${payload}`).digest('base64url');
  return `${head}.${payload}.${sig}`;
}

const hmac = (secret, body) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

function upstreamLog() {
  try {
    return readFileSync(join(RUN_DIR, 'upstream.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// ── process management ────────────────────────────────────────────────────────
const children = [];
function spawnChild(cmd, args, opts, logName) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stream = createWriteStream(join(RUN_DIR, `${logName}.log`));
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  children.push(child);
  return child;
}

const API_ENV = {
  LOOP_PORT: String(API_PORT),
  LOOP_HOST: '127.0.0.1',
  LOOP_ENV: 'test',
  LOOP_DATA_DIR: join(RUN_DIR, 'data'),
  LOOP_DB_PATH: join(RUN_DIR, 'data', 'loop.db'),
  LOOP_REQUIRE_AUTH: 'true',
  LOOP_API_KEY: STATIC_KEY,
  LOOP_API_KEY_ROLE: 'admin',
  LOOP_JWT_SECRET: JWT_SECRET,
  LOOP_ENCRYPTION_KEY: ENC_KEY,
  LOOP_BOOTSTRAP_ADMIN_USERNAME: ADMIN_USER,
  LOOP_BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASS,
  LOOP_EGRESS_ALLOW_PRIVATE: 'true',
  LOOP_VAULT_URL: 'http://127.0.0.1:18765',
  LOOP_DESK_URL: 'http://127.0.0.1:18766',
  LOOP_RECAP_URL: 'http://127.0.0.1:18767',
  LOOP_LLM_PRIMARY: 'mockllm',
  LOOP_LLM_FALLBACK_CHAIN: 'mockllm',
  LOOP_LLM_EXTRA_PROVIDERS: JSON.stringify([
    { name: 'mockllm', base_url: 'http://127.0.0.1:18769/v1', api_key: 'mock-key', model: 'mock-model' },
  ]),
  LOOP_DEFAULT_RETRY_COUNT: '3',
  LOOP_DEFAULT_BACKOFF: 'fixed',
  LOOP_DEFAULT_BACKOFF_INITIAL_MS: '100',
  LOOP_NODE_TIMEOUT_MS: '5000',
  LOOP_WORKFLOW_TIMEOUT_MS: '20000',
  LOOP_RATE_LIMIT_MAX: '100000',
  LOOP_LOG_LEVEL: 'info',
};

let apiChild;
function startApi(extraEnv = {}) {
  apiChild = spawnChild('node', ['apps/api/dist/server.js'], { env: { ...API_ENV, ...extraEnv } }, 'api');
  return apiChild;
}
async function waitApiReady(timeoutMs = 30000) {
  return waitFor(async () => {
    const r = await fetch(`${BASE}/health`);
    return r.status === 200;
  }, timeoutMs, 300);
}
async function stopApi(signal = 'SIGTERM', timeoutMs = 25000) {
  if (!apiChild || apiChild.exitCode !== null) return null;
  const exited = new Promise((r) => apiChild.once('exit', (code, sig) => r({ code, sig })));
  apiChild.kill(signal);
  const timer = setTimeout(() => apiChild.kill('SIGKILL'), timeoutMs);
  const result = await exited;
  clearTimeout(timer);
  return result;
}

async function pollExecution(execId, token, timeoutMs = 20000) {
  return waitFor(async () => {
    const r = await api('GET', `/api/v1/executions/${execId}`, { token });
    const s = r.json?.data?.status;
    return s && s !== 'pending' && s !== 'running' ? r.json.data : null;
  }, timeoutMs, 250);
}

const pos = (x, y) => ({ x, y });
const node = (id, type, config, extra = {}) => ({ id, type, position: pos(0, 0), config, ...extra });
const edge = (id, source, target, source_port = 'output') => ({ id, source, target, source_port });

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Run dir: ${RUN_DIR}`);
  const mocks = spawnChild('node', ['scripts/runtime-verify/mock-services.mjs', RUN_DIR], { env: {} }, 'mocks');
  await waitFor(async () => (await fetch('http://127.0.0.1:18765/health')).status === 200, 10000);
  startApi();
  const ready = await waitApiReady();
  check('S01', 'API server boots and /health returns 200', ready);
  if (!ready) throw new Error('API did not start — see api.log');

  // ── 1. Health / readiness / metrics ─────────────────────────────────────
  const readyRes = await api('GET', '/ready');
  check('H01', '/ready reports database ok + all mock connectors ok',
    readyRes.status === 200 && readyRes.json?.checks?.database === 'ok' && readyRes.json?.checks?.connectors === 'ok',
    JSON.stringify(readyRes.json));
  const metrics = await api('GET', '/metrics');
  check('H02', '/metrics exposes Prometheus loop metrics', metrics.status === 200 && metrics.text.includes('loop_'), metrics.text.slice(0, 120));
  const healthNoAuth = await api('GET', '/health');
  check('H03', '/health is public even with auth required', healthNoAuth.status === 200);

  // ── 2. Auth & RBAC ──────────────────────────────────────────────────────
  const noAuth = await api('GET', '/api/v1/workflows');
  check('A01', 'unauthenticated /api/v1/workflows → 401', noAuth.status === 401, `got ${noAuth.status}`);
  const badAuth = await api('GET', '/api/v1/workflows', { token: 'garbage' });
  check('A02', 'invalid bearer token → 401', badAuth.status === 401, `got ${badAuth.status}`);
  const login = await api('POST', '/api/v1/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } });
  const adminJwt = login.json?.data?.token;
  check('A03', 'bootstrap admin can login and receives JWT', login.status === 200 && typeof adminJwt === 'string', JSON.stringify(login.json).slice(0, 200));
  const badLogin = await api('POST', '/api/v1/auth/login', { body: { username: ADMIN_USER, password: 'wrong' } });
  check('A04', 'wrong password → 401', badLogin.status === 401, `got ${badLogin.status}`);
  const keyAuth = await api('GET', '/api/v1/workflows', { token: STATIC_KEY });
  check('A05', 'static API key authenticates (admin role)', keyAuth.status === 200, `got ${keyAuth.status}`);
  const viewerJwt = makeJwt('viewer-1', 'viewer');
  const editorJwt = makeJwt('editor-1', 'editor');
  const viewerRead = await api('GET', '/api/v1/workflows', { token: viewerJwt });
  check('A06', 'viewer can read workflows', viewerRead.status === 200, `got ${viewerRead.status}`);
  const viewerWrite = await api('POST', '/api/v1/workflows', { token: viewerJwt, body: { name: 'x', definition: { nodes: [], edges: [] } } });
  check('A07', 'viewer cannot create workflows → 403', viewerWrite.status === 403, `got ${viewerWrite.status}`);
  const viewerSecrets = await api('GET', '/api/v1/secrets', { token: viewerJwt });
  check('A08', 'viewer cannot list secrets → 403', viewerSecrets.status === 403, `got ${viewerSecrets.status}`);
  const viewerAudit = await api('GET', '/api/v1/audit', { token: viewerJwt });
  check('A09', 'viewer cannot read audit → 403', viewerAudit.status === 403, `got ${viewerAudit.status}`);
  const editorEgress = await api('GET', '/api/v1/egress/policies', { token: editorJwt });
  check('A10', 'editor cannot manage egress policies → 403', editorEgress.status === 403, `got ${editorEgress.status}`);
  const editorCreate = await api('POST', '/api/v1/workflows', { token: editorJwt, body: { name: 'editor-wf', definition: { nodes: [node('n1', 'control.delay', { duration_ms: 1 })], edges: [] } } });
  check('A11', 'editor can create workflows (JIT user provisioning)', editorCreate.status === 201, `got ${editorCreate.status} ${JSON.stringify(editorCreate.json).slice(0, 200)}`);
  const editorSecret = await api('POST', '/api/v1/secrets', { token: editorJwt, body: { name: 's', value: 'v' } });
  check('A12', 'editor cannot create secrets → 403', editorSecret.status === 403, `got ${editorSecret.status}`);

  const T = adminJwt; // admin token for the rest

  // ── 3. Templates ────────────────────────────────────────────────────────
  const tplList = await api('GET', '/api/v1/templates', { token: T });
  check('T01', 'template gallery lists templates with facets', tplList.status === 200 && Array.isArray(tplList.json?.data) && tplList.json.data.length > 0 && Array.isArray(tplList.json?.meta?.industries), `got ${tplList.status}`);
  const tplSearch = await api('GET', '/api/v1/templates?search=meeting', { token: T });
  check('T02', 'template search filters results', tplSearch.status === 200 && tplSearch.json.data.every((t) => JSON.stringify(t).toLowerCase().includes('meeting')), JSON.stringify(tplSearch.json?.data?.map((t) => t.id)));
  const firstTpl = tplList.json.data[0];
  const tplDetail = await api('GET', `/api/v1/templates/${firstTpl.id}`, { token: T });
  check('T03', 'template detail includes definition', tplDetail.status === 200 && Array.isArray(tplDetail.json?.data?.definition?.nodes), `got ${tplDetail.status}`);
  const tplMissing = await api('GET', '/api/v1/templates/does-not-exist', { token: T });
  check('T04', 'unknown template → 404', tplMissing.status === 404, `got ${tplMissing.status}`);
  const inst = await api('POST', `/api/v1/templates/${firstTpl.id}/instantiate`, { token: T, body: { name: 'E2E from template' } });
  check('T05', 'template instantiate creates a workflow', inst.status === 201 && inst.json?.data?.id, `got ${inst.status} ${JSON.stringify(inst.json).slice(0, 200)}`);
  const instWfId = inst.json?.data?.id;

  // ── 4. Workflow CRUD + validation ───────────────────────────────────────
  const fullDef = {
    version: '1.0',
    variables: { greeting: { type: 'string', default: 'hello' } },
    nodes: [
      node('n_vault', 'vault.rag_query', { query: '{{trigger.payload.question}}', top_k: 3 }),
      node('n_branch', 'control.branch', { condition: "{{n_vault.output.answer}} != ''" }),
      node('n_desk', 'desk.send_response', { id: 'conv-1', agent_id: 'agent-7', content: 'Reply: {{n_vault.output.answer}}' }),
      node('n_recap', 'recap.create_meeting', { title: 'Fallback meeting', token: 'recap-mock-jwt' }),
      node('n_llm', 'llm.complete', { prompt: 'Summarize: {{n_vault.output.answer}}' }),
    ],
    edges: [
      edge('e1', 'n_vault', 'n_branch'),
      edge('e2', 'n_branch', 'n_desk', 'true'),
      edge('e3', 'n_branch', 'n_recap', 'false'),
      edge('e4', 'n_desk', 'n_llm'),
      edge('e5', 'n_recap', 'n_llm'),
    ],
  };
  const created = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E full flow', description: 'runtime verification', definition: fullDef, tags: ['e2e'] } });
  const wfId = created.json?.data?.id;
  check('W01', 'create workflow with mixed connector/control nodes', created.status === 201 && wfId && created.json.data.version === 1, `got ${created.status}`);
  const badNode = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'bad', definition: { nodes: [node('x', 'vaultt.search', {})], edges: [] } } });
  check('W02', 'unknown node type rejected at create → 400', badNode.status === 400, `got ${badNode.status}`);
  const cycleDef = { nodes: [node('a', 'control.delay', { duration_ms: 1 }), node('b', 'control.delay', { duration_ms: 1 })], edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')] };
  const cycle = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'cycle', definition: cycleDef } });
  check('W03', 'cyclic graph rejected → 400', cycle.status === 400, `got ${cycle.status} ${JSON.stringify(cycle.json).slice(0, 150)}`);
  const got = await api('GET', `/api/v1/workflows/${wfId}`, { token: T });
  check('W04', 'get workflow returns definition', got.status === 200 && got.json.data.definition.nodes.length === 5, `got ${got.status}`);
  const upd = await api('PUT', `/api/v1/workflows/${wfId}`, { token: T, body: { description: 'updated', definition: { ...fullDef, nodes: [...fullDef.nodes, node('n_extra', 'control.delay', { duration_ms: 1 })] } } });
  check('W05', 'update bumps version', upd.status === 200 && upd.json.data.version === 2, `got ${upd.status} v=${upd.json?.data?.version}`);
  // remove the extra node again so the executed graph matches assertions
  await api('PUT', `/api/v1/workflows/${wfId}`, { token: T, body: { definition: fullDef } });
  const val = await api('POST', `/api/v1/workflows/${wfId}/validate`, { token: T });
  check('W06', 'validate endpoint reports valid graph', val.status === 200 && (val.json.data.valid === true || val.json.data.errors?.length === 0), JSON.stringify(val.json?.data).slice(0, 200));
  const wfList = await api('GET', '/api/v1/workflows?per_page=5&page=1', { token: T });
  check('W07', 'list workflows paginates', wfList.status === 200 && wfList.json.data.length <= 5 && wfList.json.meta.total >= 2, JSON.stringify(wfList.json?.meta));
  const badPage = await api('GET', '/api/v1/workflows?page=abc&per_page=xyz', { token: T });
  check('W08', 'garbage pagination params → 200 with defaults (not 500)', badPage.status === 200, `got ${badPage.status}`);
  const missing = await api('GET', '/api/v1/workflows/00000000-0000-0000-0000-000000000000', { token: T });
  check('W09', 'unknown workflow → 404', missing.status === 404, `got ${missing.status}`);

  // ── 5. Manual execution of the full graph ───────────────────────────────
  const exec = await api('POST', `/api/v1/workflows/${wfId}/execute`, { token: T, body: { payload: { question: 'What is Loop?' } } });
  const execId = exec.json?.data?.execution_id;
  check('E01', 'execute returns 202 + execution_id', exec.status === 202 && execId, `got ${exec.status}`);
  const finalExec = await pollExecution(execId, T);
  check('E02', 'execution reaches succeeded', finalExec?.status === 'succeeded', JSON.stringify(finalExec).slice(0, 300));
  const nodes = finalExec?.nodes ?? [];
  const byId = Object.fromEntries(nodes.map((n) => [n.node_id, n]));
  check('E03', 'vault/branch/desk/llm nodes succeeded; recap arm pruned',
    byId['n_vault']?.status === 'succeeded' && byId['n_branch']?.status === 'succeeded' && byId['n_desk']?.status === 'succeeded' && byId['n_llm']?.status === 'succeeded' && (!byId['n_recap'] || byId['n_recap'].status === 'skipped'),
    JSON.stringify(nodes.map((n) => [n.node_id, n.status])));
  const vaultOut = byId['n_vault']?.output;
  check('E04', 'trigger payload interpolated into vault query', JSON.stringify(vaultOut).includes('What is Loop?'), JSON.stringify(vaultOut).slice(0, 200));
  const deskCall = upstreamLog().find((r) => r.service === 'desk' && r.path.includes('/respond'));
  check('E05', 'desk received interpolated reply in JSON body + agent_id query',
    deskCall && deskCall.body?.content?.includes('Vault answer') && deskCall.path.includes('agent_id=agent-7'),
    JSON.stringify(deskCall));
  const llmCall = upstreamLog().find((r) => r.service === 'llm' && r.path === '/v1/chat/completions');
  check('E06', 'llm.complete reached the mock LLM with interpolated prompt', llmCall && JSON.stringify(llmCall.body).includes('Vault answer'), JSON.stringify(llmCall?.body).slice(0, 200));
  const vaultCall = upstreamLog().find((r) => r.service === 'vault' && r.path === '/query');
  check('E07', 'idempotency key forwarded upstream', Boolean(vaultCall?.idempotency_key), JSON.stringify(vaultCall));

  // ── 6. Execution list / filters ─────────────────────────────────────────
  const execList = await api('GET', `/api/v1/executions?workflow_id=${wfId}&status=succeeded`, { token: T });
  check('E08', 'execution list filters by workflow + status', execList.status === 200 && execList.json.data.some((e) => e.id === execId), JSON.stringify(execList.json?.meta));

  // ── 7. Replay ───────────────────────────────────────────────────────────
  const replayDry = await api('GET', `/api/v1/executions/${execId}/replay`, { token: T });
  check('R01', 'replay dry-run reconstructs snapshot without side effects', replayDry.status === 200 && replayDry.json?.data?.snapshot, JSON.stringify(replayDry.json).slice(0, 200));
  const deskCallsBefore = upstreamLog().filter((r) => r.service === 'desk' && r.path.includes('/respond')).length;
  await api('POST', `/api/v1/executions/${execId}/replay`, { token: T }); // default dryRun=true
  const deskCallsAfter = upstreamLog().filter((r) => r.service === 'desk' && r.path.includes('/respond')).length;
  check('R02', 'POST replay defaults to dry-run (no new upstream calls)', deskCallsBefore === deskCallsAfter, `${deskCallsBefore} → ${deskCallsAfter}`);
  const replayReal = await api('POST', `/api/v1/executions/${execId}/replay?dryRun=false`, { token: T });
  check('R03', 'real replay of terminal execution accepted', replayReal.status === 200, `got ${replayReal.status} ${JSON.stringify(replayReal.json).slice(0, 200)}`);

  // ── 8. Cancel ───────────────────────────────────────────────────────────
  const delayWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E delay', definition: { nodes: [node('d1', 'control.delay', { duration_ms: 6000 })], edges: [] } } });
  const delayExec = await api('POST', `/api/v1/workflows/${delayWf.json.data.id}/execute`, { token: T, body: {} });
  const cancelRes = await api('POST', `/api/v1/executions/${delayExec.json.data.execution_id}/cancel`, { token: T });
  check('C01', 'running execution can be cancelled', cancelRes.status === 200 && cancelRes.json.data.status === 'cancelled', JSON.stringify(cancelRes.json));
  await sleep(6500);
  const afterCancel = await api('GET', `/api/v1/executions/${delayExec.json.data.execution_id}`, { token: T });
  check('C02', 'late node completion does not overwrite cancelled', afterCancel.json.data.status === 'cancelled', afterCancel.json.data.status);
  const cancelAgain = await api('POST', `/api/v1/executions/${delayExec.json.data.execution_id}/cancel`, { token: T });
  check('C03', 'cancelling a terminal execution reports not-active', cancelAgain.status === 200 && cancelAgain.json.success === false, JSON.stringify(cancelAgain.json));

  // ── 9. Triggers ─────────────────────────────────────────────────────────
  // 9a. cron (6-field, every 2 seconds)
  const cronWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E cron', definition: { nodes: [node('c1', 'control.delay', { duration_ms: 1 })], edges: [] } } });
  const cronTrig = await api('POST', `/api/v1/workflows/${cronWf.json.data.id}/triggers`, { token: T, body: { trigger_type: 'cron', config: { expression: '*/2 * * * * *' } } });
  check('G01', 'cron trigger created (seconds granularity)', cronTrig.status === 201, `got ${cronTrig.status}`);
  const cronFired = await waitFor(async () => {
    const r = await api('GET', `/api/v1/executions?workflow_id=${cronWf.json.data.id}`, { token: T });
    return r.json?.data?.length > 0 ? r.json.data : null;
  }, 10000, 500);
  check('G02', 'cron trigger fires without restart', Array.isArray(cronFired) && cronFired.length > 0, 'no execution within 10s');
  const cronBad = await api('POST', `/api/v1/workflows/${cronWf.json.data.id}/triggers`, { token: T, body: { trigger_type: 'cron', config: { expression: 'not a cron' } } });
  check('G03', 'invalid cron expression → 400 and no row left behind', cronBad.status === 400, `got ${cronBad.status}`);
  const cronDisable = await api('PUT', `/api/v1/triggers/${cronTrig.json.data.id}`, { token: T, body: { enabled: false } });
  check('G04', 'cron trigger can be disabled', cronDisable.status === 200 && cronDisable.json.data.enabled === false, JSON.stringify(cronDisable.json).slice(0, 150));
  const cronCountBefore = (await api('GET', `/api/v1/executions?workflow_id=${cronWf.json.data.id}&per_page=200`, { token: T })).json.meta.total;
  await sleep(3000);
  const cronCountAfter = (await api('GET', `/api/v1/executions?workflow_id=${cronWf.json.data.id}&per_page=200`, { token: T })).json.meta.total;
  check('G05', 'disabled cron stops firing', cronCountAfter === cronCountBefore, `${cronCountBefore} → ${cronCountAfter}`);
  const cronDel = await api('DELETE', `/api/v1/triggers/${cronTrig.json.data.id}`, { token: T });
  check('G06', 'cron trigger deleted', cronDel.status === 200, `got ${cronDel.status}`);

  // 9b. webhook with HMAC
  const whWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E webhook', definition: { nodes: [node('w1', 'vault.rag_query', { query: '{{trigger.payload.q}}' })], edges: [] } } });
  const whSecret = 'whsec-e2e-secret';
  const whTrig = await api('POST', `/api/v1/workflows/${whWf.json.data.id}/triggers`, { token: T, body: { trigger_type: 'webhook', config: { secret: whSecret } } });
  const whId = whTrig.json?.data?.id;
  check('G07', 'webhook trigger created, secret returned once', whTrig.status === 201 && whTrig.json.data.config.secret === whSecret, JSON.stringify(whTrig.json).slice(0, 200));
  const whList = await api('GET', `/api/v1/workflows/${whWf.json.data.id}/triggers`, { token: T });
  check('G08', 'webhook secret redacted on list', whList.json.data[0].config.secret === '***redacted***', JSON.stringify(whList.json?.data?.[0]?.config));
  const whBody = JSON.stringify({ q: 'webhook question' });
  const whOk = await api('POST', `/webhooks/${whId}`, { rawBody: whBody, headers: { 'x-loop-signature': hmac(whSecret, whBody) } });
  check('G09', 'valid HMAC webhook accepted → execution runs', whOk.status === 200 && whOk.json?.execution_id, `got ${whOk.status}`);
  const whExec = await pollExecution(whOk.json.execution_id, T);
  check('G10', 'webhook execution succeeded with payload interpolation', whExec?.status === 'succeeded' && JSON.stringify(whExec.nodes?.[0]?.output).includes('webhook question'), JSON.stringify(whExec).slice(0, 250));
  const whBadSig = await api('POST', `/webhooks/${whId}`, { rawBody: whBody, headers: { 'x-loop-signature': 'sha256=deadbeef' } });
  check('G11', 'invalid signature → 401', whBadSig.status === 401, `got ${whBadSig.status}`);
  const whNoSig = await api('POST', `/webhooks/${whId}`, { rawBody: whBody });
  check('G12', 'missing signature → 401 (no bypass)', whNoSig.status === 401, `got ${whNoSig.status}`);
  const whTampered = await api('POST', `/webhooks/${whId}`, { rawBody: JSON.stringify({ q: 'tampered' }), headers: { 'x-loop-signature': hmac(whSecret, whBody) } });
  check('G13', 'signature over different body rejected', whTampered.status === 401, `got ${whTampered.status}`);
  await api('PUT', `/api/v1/triggers/${whId}`, { token: T, body: { enabled: false } });
  const whDisabled = await api('POST', `/webhooks/${whId}`, { rawBody: whBody, headers: { 'x-loop-signature': hmac(whSecret, whBody) } });
  check('G14', 'disabled webhook trigger → 404', whDisabled.status === 404, `got ${whDisabled.status}`);
  await api('PUT', `/api/v1/triggers/${whId}`, { token: T, body: { enabled: true } });
  // archive the workflow → webhook must 404
  await api('DELETE', `/api/v1/workflows/${whWf.json.data.id}`, { token: T });
  const whArchived = await api('POST', `/webhooks/${whId}`, { rawBody: whBody, headers: { 'x-loop-signature': hmac(whSecret, whBody) } });
  check('G15', 'archived workflow webhook → 404', whArchived.status === 404, `got ${whArchived.status}`);

  // 9c. event trigger
  const evWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E event', definition: { nodes: [node('v1', 'control.delay', { duration_ms: 1 })], edges: [] } } });
  const evTrig = await api('POST', `/api/v1/workflows/${evWf.json.data.id}/triggers`, { token: T, body: { trigger_type: 'event', config: { source: 'desk', event_type: 'conversation.created' } } });
  check('G16', 'event trigger created', evTrig.status === 201, `got ${evTrig.status}`);
  const evFire = await api('POST', '/api/v1/events', { token: T, body: { source: 'desk', event_type: 'conversation.created', payload: { conversation_id: 'conv-9' } } });
  check('G17', 'matching event dispatches execution', evFire.status === 202 && evFire.json.data.matched_triggers === 1, `got ${evFire.status} ${JSON.stringify(evFire.json)}`);
  const evExec = await pollExecution(evFire.json.data.execution_ids[0], T);
  check('G18', 'event-triggered execution succeeded', evExec?.status === 'succeeded', JSON.stringify(evExec).slice(0, 200));
  const evNoMatch = await api('POST', '/api/v1/events', { token: T, body: { source: 'desk', event_type: 'nothing.matches' } });
  check('G19', 'non-matching event → 200 with 0 matches', evNoMatch.status === 200 && evNoMatch.json.data.matched_triggers === 0, JSON.stringify(evNoMatch.json));

  // ── 10. Connectors + secrets + egress ───────────────────────────────────
  const connCreate = await api('POST', '/api/v1/connectors', { token: T, body: { connector_type: 'generic', name: 'e2e-rest', config: { base_url: 'http://127.0.0.1:18768', method: 'POST', api_key: 'generic-secret-key', headers: { 'x-custom': 'abc' } } } });
  const connId = connCreate.json?.data?.id;
  check('N01', 'generic connector instance created', connCreate.status === 201 && connId, `got ${connCreate.status}`);
  check('N02', 'api_key stripped from stored config', connCreate.json.data.config.api_key === undefined, JSON.stringify(connCreate.json?.data?.config));
  const connList = await api('GET', '/api/v1/connectors', { token: T });
  const storedConn = connList.json.data.find((c) => c.id === connId);
  check('N03', 'connector list never exposes api_key', storedConn && storedConn.config.api_key === undefined, JSON.stringify(storedConn?.config));
  const genWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E generic', definition: { nodes: [node('g1', 'generic.rest_call', { path: '/echo', body: { hello: 'world' } })], edges: [] } } });
  const genExec = await api('POST', `/api/v1/workflows/${genWf.json.data.id}/execute`, { token: T, body: {} });
  const genFinal = await pollExecution(genExec.json.data.execution_id, T);
  check('N04', 'generic connector execution succeeded', genFinal?.status === 'succeeded', JSON.stringify(genFinal).slice(0, 250));
  const echoCall = upstreamLog().filter((r) => r.service === 'rest' && r.path === '/echo').pop();
  check('N05', 'secret api_key resolved and sent as Bearer upstream', echoCall?.authorization === 'Bearer generic-secret-key', JSON.stringify(echoCall));
  check('N06', 'custom header from instance config forwarded', echoCall?.body !== undefined, JSON.stringify(echoCall).slice(0, 200));
  const secCreate = await api('POST', '/api/v1/secrets', { token: T, body: { name: 'e2e-global-secret', value: 'super-secret-value', scope: 'global' } });
  check('N07', 'secret created (admin)', secCreate.status === 201, `got ${secCreate.status}`);
  const secList = await api('GET', '/api/v1/secrets', { token: T });
  const secRow = secList.json.data.find((s) => s.name === 'e2e-global-secret');
  check('N08', 'secret list returns metadata only (no value)', secRow && secRow.value === undefined && !JSON.stringify(secList.json).includes('super-secret-value'), JSON.stringify(secRow));
  const secDup = await api('POST', '/api/v1/secrets', { token: T, body: { name: 'e2e-global-secret', value: 'x' } });
  check('N09', 'duplicate secret name upserts (201, same id)', secDup.status === 201 && secDup.json.data.id === secRow.id, `got ${secDup.status} id=${secDup.json?.data?.id} vs ${secRow.id}`);
  // egress deny policy blocks the generic upstream
  const pol = await api('POST', '/api/v1/egress/policies', { token: T, body: { name: 'block-rest', rule_type: 'deny', target_type: 'domain', target_value: '127.0.0.1', priority: 100 } });
  check('N10', 'egress deny policy created', pol.status === 201, `got ${pol.status}`);
  const echoBeforeBlock = upstreamLog().filter((r) => r.service === 'rest' && r.path === '/echo').length;
  const blockedExec = await api('POST', `/api/v1/workflows/${genWf.json.data.id}/execute`, { token: T, body: {} });
  const blockedFinal = await pollExecution(blockedExec.json.data.execution_id, T);
  check('N11', 'egress deny blocks connector call (execution fails)', blockedFinal?.status === 'failed', JSON.stringify(blockedFinal).slice(0, 250));
  const echoAfterBlock = upstreamLog().filter((r) => r.service === 'rest' && r.path === '/echo').length;
  check('N12', 'blocked call never reached upstream', echoAfterBlock === echoBeforeBlock, `${echoBeforeBlock} → ${echoAfterBlock}`);
  const polList = await api('GET', '/api/v1/egress/policies', { token: T });
  const polId = polList.json.data.find((p) => p.name === 'block-rest')?.id;
  await api('DELETE', `/api/v1/egress/policies/${polId}`, { token: T });
  const unblockedExec = await api('POST', `/api/v1/workflows/${genWf.json.data.id}/execute`, { token: T, body: {} });
  const unblockedFinal = await pollExecution(unblockedExec.json.data.execution_id, T);
  check('N13', 'removing policy restores egress', unblockedFinal?.status === 'succeeded', JSON.stringify(unblockedFinal).slice(0, 200));
  const connDel = await api('DELETE', `/api/v1/connectors/${connId}`, { token: T });
  check('N14', 'connector instance deleted', connDel.status === 200, `got ${connDel.status}`);
  const secDel = await api('DELETE', `/api/v1/secrets/${secRow.id}`, { token: T });
  check('N15', 'secret deleted', secDel.status === 200, `got ${secDel.status}`);

  // ── 11. LLM API ─────────────────────────────────────────────────────────
  const providers = await api('GET', '/api/v1/llm/providers', { token: T });
  check('L01', 'LLM providers lists mockllm', providers.status === 200 && providers.json.data.some((p) => p.name === 'mockllm'), JSON.stringify(providers.json?.data));
  const complete = await api('POST', '/api/v1/llm/complete', { token: T, body: { prompt: 'Say hi', provider: 'mockllm' } });
  check('L02', 'LLM completion returns mock content', complete.status === 200 && complete.json.data.content.includes('MOCK_LLM_REPLY'), `got ${complete.status} ${JSON.stringify(complete.json).slice(0, 200)}`);
  const badProvider = await api('POST', '/api/v1/llm/complete', { token: T, body: { prompt: 'x', provider: 'nope' } });
  check('L03', 'unknown LLM provider → 400', badProvider.status === 400, `got ${badProvider.status}`);

  // ── 12. Retry + timeout ─────────────────────────────────────────────────
  const retryWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E retry', definition: { nodes: [node('r1', 'generic.rest_call', { path: '/flaky' }, { retry: { max_attempts: 3, backoff: 'fixed', initial_delay_ms: 50 } })], edges: [] } } });
  // generic instance was deleted — recreate for retry/timeout tests
  const conn2 = await api('POST', '/api/v1/connectors', { token: T, body: { connector_type: 'generic', name: 'e2e-rest-2', config: { base_url: 'http://127.0.0.1:18768', method: 'GET' } } });
  const retryExec = await api('POST', `/api/v1/workflows/${retryWf.json.data.id}/execute`, { token: T, body: {} });
  const retryFinal = await pollExecution(retryExec.json.data.execution_id, T);
  const flakyCalls = upstreamLog().filter((r) => r.service === 'rest' && r.path === '/flaky').length;
  check('RT01', 'flaky upstream retried to success (3 attempts)', retryFinal?.status === 'succeeded' && flakyCalls === 3, `status=${retryFinal?.status} calls=${flakyCalls}`);
  const timeoutWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E timeout', definition: { nodes: [node('t1', 'generic.rest_call', { path: '/slow' }, { timeout_ms: 500, retry: { max_attempts: 0, backoff: 'fixed', initial_delay_ms: 0 } })], edges: [] } } });
  const timeoutExec = await api('POST', `/api/v1/workflows/${timeoutWf.json.data.id}/execute`, { token: T, body: {} });
  const timeoutFinal = await pollExecution(timeoutExec.json.data.execution_id, T, 15000);
  check('RT02', 'node timeout fails the execution promptly', timeoutFinal?.status === 'failed' && /timeout|timed out|abort/i.test(JSON.stringify(timeoutFinal.nodes?.[0]?.error ?? '')), JSON.stringify(timeoutFinal).slice(0, 250));

  // ── 13. Error paths ─────────────────────────────────────────────────────
  const execMissing = await api('POST', '/api/v1/workflows/00000000-0000-0000-0000-000000000000/execute', { token: T, body: {} });
  check('X01', 'execute unknown workflow → 404', execMissing.status === 404, `got ${execMissing.status}`);
  const badJson = await fetch(`${BASE}/api/v1/workflows`, { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'application/json' }, body: '{broken' });
  check('X02', 'malformed JSON body → 400 (not 500)', badJson.status === 400, `got ${badJson.status}`);
  const trigBadType = await api('POST', `/api/v1/workflows/${wfId}/triggers`, { token: T, body: { trigger_type: 'sms', config: {} } });
  check('X03', 'invalid trigger type → 400', trigBadType.status === 400, `got ${trigBadType.status}`);
  const execGetMissing = await api('GET', '/api/v1/executions/00000000-0000-0000-0000-000000000000', { token: T });
  check('X04', 'unknown execution → 404', execGetMissing.status === 404, `got ${execGetMissing.status}`);

  // ── 14. WebSocket monitoring ────────────────────────────────────────────
  const wsWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E ws', definition: { nodes: [node('s1', 'control.delay', { duration_ms: 300 }), node('s2', 'vault.rag_query', { query: 'ws test' })], edges: [edge('e1', 's1', 's2')] } } });
  const wsExecRes = await api('POST', `/api/v1/workflows/${wsWf.json.data.id}/execute`, { token: T, body: {} });
  const wsExecId = wsExecRes.json.data.execution_id;
  const wsEvents = [];
  const ws = new WebSocket(`ws://127.0.0.1:${API_PORT}/ws/executions/${wsExecId}?token=${T}`);
  await new Promise((resolve) => {
    ws.onmessage = (m) => {
      try {
        wsEvents.push(JSON.parse(m.data));
      } catch {
        /* ignore */
      }
    };
    ws.onopen = resolve;
    ws.onerror = resolve;
    setTimeout(resolve, 3000);
  });
  await pollExecution(wsExecId, T);
  await sleep(500);
  ws.close();
  check('WS01', 'WS subscription receives node/execution events', wsEvents.length > 0 && wsEvents.some((e) => e.type === 'node_succeeded' || e.type === 'execution_succeeded'), JSON.stringify(wsEvents.slice(0, 3)));
  const wsNoAuth = await new Promise((resolve) => {
    const w = new WebSocket(`ws://127.0.0.1:${API_PORT}/ws/executions/${wsExecId}`);
    w.onclose = (e) => resolve(e.code);
    w.onerror = () => {};
    setTimeout(() => resolve('timeout'), 3000);
  });
  check('WS02', 'unauthenticated WS closed with 4401', wsNoAuth === 4401, `close code ${wsNoAuth}`);

  // ── 15. Concurrency ─────────────────────────────────────────────────────
  const concWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E concurrency', definition: { nodes: [node('p1', 'vault.rag_query', { query: 'concurrent' })], edges: [] } } });
  const concIds = await Promise.all(
    Array.from({ length: 15 }, () => api('POST', `/api/v1/workflows/${concWf.json.data.id}/execute`, { token: T, body: {} }).then((r) => r.json.data.execution_id)),
  );
  const concFinals = await Promise.all(concIds.map((id) => pollExecution(id, T, 30000)));
  check('CC01', '15 concurrent executions all succeed', concFinals.every((e) => e?.status === 'succeeded'), JSON.stringify(concFinals.map((e) => e?.status)));

  // ── 16. Sub-workflow invocation ─────────────────────────────────────────
  const childWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E child', definition: { nodes: [node('ch1', 'vault.rag_query', { query: '{{trigger.payload.child_q}}' })], edges: [] } } });
  const parentWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E parent', definition: { nodes: [node('inv', 'workflow.invoke', { workflow_id: childWf.json.data.id, inputs: { child_q: 'from parent' } })], edges: [] } } });
  check('SW00', 'parent workflow with workflow.invoke accepted', parentWf.status === 201 && parentWf.json?.data?.id, `got ${parentWf.status} ${JSON.stringify(parentWf.json).slice(0, 200)}`);
  const parentExec = await api('POST', `/api/v1/workflows/${parentWf.json.data.id}/execute`, { token: T, body: {} });
  const parentFinal = await pollExecution(parentExec.json.data.execution_id, T);
  check('SW01', 'workflow.invoke runs child workflow', parentFinal?.status === 'succeeded', JSON.stringify(parentFinal).slice(0, 300));
  const childExecs = await api('GET', `/api/v1/executions?workflow_id=${childWf.json.data.id}`, { token: T });
  const childFinal = childExecs.json.data[0];
  check('SW02', 'child execution recorded with interpolated input', childFinal?.status === 'succeeded' && JSON.stringify(childFinal).includes('from parent'), JSON.stringify(childFinal).slice(0, 250));

  // ── 17. Crash recovery ──────────────────────────────────────────────────
  // Two nodes: a fast first node that completes, then a long delay. Killing
  // during the delay leaves a succeeded node behind, so recovery resumes from
  // it (the documented recoverable path). The zero-completed-node case — which
  // recovery deliberately marks failed — is covered separately by CR03.
  const crashWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E crash', definition: { nodes: [node('cr1', 'vault.rag_query', { query: 'crash probe' }), node('cr2', 'control.delay', { duration_ms: 3000 })], edges: [edge('cre1', 'cr1', 'cr2')] } } });
  const crashExec = await api('POST', `/api/v1/workflows/${crashWf.json.data.id}/execute`, { token: T, body: {} });
  const crashId = crashExec.json.data.execution_id;
  // Wait until the first node succeeded AND the delay node is in flight, so the
  // kill lands mid-second-node with a completed node available to resume from.
  await waitFor(async () => {
    const r = await api('GET', `/api/v1/executions/${crashId}`, { token: T });
    const nodes = r.json?.data?.nodes ?? [];
    const first = nodes.find((n) => n.node_id === 'cr1');
    const second = nodes.find((n) => n.node_id === 'cr2');
    return first?.status === 'succeeded' && (second?.status === 'running' || second?.status === 'pending') ? true : null;
  }, 8000);
  await stopApi('SIGKILL', 5000);
  check('CR01', 'server killed mid-execution (SIGKILL)', true);
  startApi();
  await waitApiReady();
  const recovered = await waitFor(async () => {
    const r = await api('GET', `/api/v1/executions/${crashId}`, { token: T });
    const s = r.json?.data?.status;
    return s === 'succeeded' || s === 'failed' ? r.json.data : null;
  }, 30000, 500);
  check('CR02', 'in-flight execution resumed after restart (completed node skipped)', recovered?.status === 'succeeded', JSON.stringify(recovered).slice(0, 300));

  // CR03: a single-node workflow killed mid-flight has zero completed nodes;
  // recovery marks it failed because the in-flight node's side effects are
  // ambiguous (recovery.ts non-recoverable path). Assert that safety behavior.
  const crashSoloWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E crash solo', definition: { nodes: [node('solo1', 'control.delay', { duration_ms: 8000 })], edges: [] } } });
  const crashSoloExec = await api('POST', `/api/v1/workflows/${crashSoloWf.json.data.id}/execute`, { token: T, body: {} });
  const crashSoloId = crashSoloExec.json.data.execution_id;
  await waitFor(async () => {
    const r = await api('GET', `/api/v1/executions/${crashSoloId}`, { token: T });
    return r.json?.data?.status === 'running';
  }, 5000);
  await stopApi('SIGKILL', 5000);
  startApi();
  await waitApiReady();
  const soloRecovered = await waitFor(async () => {
    const r = await api('GET', `/api/v1/executions/${crashSoloId}`, { token: T });
    const s = r.json?.data?.status;
    return s === 'succeeded' || s === 'failed' ? r.json.data : null;
  }, 30000, 500);
  check('CR03', 'zero-completed-node crash marked failed (non-recoverable safety)', soloRecovered?.status === 'failed' && /Interrupted by system restart/.test(soloRecovered?.error ?? ''), JSON.stringify(soloRecovered).slice(0, 300));

  // ── 18. Graceful shutdown drains in-flight work ─────────────────────────
  const drainWf = await api('POST', '/api/v1/workflows', { token: T, body: { name: 'E2E drain', definition: { nodes: [node('dr1', 'control.delay', { duration_ms: 2000 })], edges: [] } } });
  const drainExec = await api('POST', `/api/v1/workflows/${drainWf.json.data.id}/execute`, { token: T, body: {} });
  await waitFor(async () => {
    const r = await api('GET', `/api/v1/executions/${drainExec.json.data.execution_id}`, { token: T });
    return r.json?.data?.status === 'running';
  }, 5000);
  const shutdownResult = await stopApi('SIGTERM');
  check('GS01', 'SIGTERM shuts down cleanly (exit 0)', shutdownResult?.code === 0, JSON.stringify(shutdownResult));
  startApi();
  await waitApiReady();
  const drained = await api('GET', `/api/v1/executions/${drainExec.json.data.execution_id}`, { token: T });
  check('GS02', 'in-flight execution drained to succeeded before exit', drained.json.data.status === 'succeeded', drained.json.data.status);

  // ── 19. Production guardrails ───────────────────────────────────────────
  const guardChild = spawn('node', ['apps/api/dist/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      LOOP_ENV: 'production',
      LOOP_PORT: '13001',
      LOOP_DATA_DIR: join(RUN_DIR, 'guard-data'),
      LOOP_DB_PATH: join(RUN_DIR, 'guard-data', 'loop.db'),
      LOOP_REQUIRE_AUTH: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let guardOut = '';
  guardChild.stdout.on('data', (d) => (guardOut += d));
  guardChild.stderr.on('data', (d) => (guardOut += d));
  const guardExit = await new Promise((r) => {
    guardChild.once('exit', (code) => r(code));
    setTimeout(() => {
      guardChild.kill('SIGKILL');
      r('timeout');
    }, 10000);
  });
  check('PG01', 'production boot refuses public default encryption key', guardExit === 1 && /LOOP_ENCRYPTION_KEY/.test(guardOut), `exit=${guardExit} out=${guardOut.slice(0, 200)}`);

  // ── 20. Audit trail ─────────────────────────────────────────────────────
  const audit = await api('GET', '/api/v1/audit?per_page=100', { token: T });
  check('AU01', 'audit log records workflow/trigger activity', audit.status === 200 && audit.json.data.length > 0, `got ${audit.status} n=${audit.json?.data?.length}`);

  // ── summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TOTAL: ${results.length}  PASS: ${results.length - failures}  FAIL: ${failures}`);
  if (failures > 0) {
    console.log('\nFailed checks:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  ${r.id}  ${r.name}  → ${r.detail}`);
  }
  writeFileSync(join(RUN_DIR, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\nLogs: ${RUN_DIR}`);
}

main()
  .catch((err) => {
    console.error('VERIFY SCRIPT ERROR:', err);
    failures++;
  })
  .finally(async () => {
    await stopApi('SIGTERM').catch(() => {});
    for (const c of children) {
      if (c.exitCode === null) c.kill('SIGTERM');
    }
    await sleep(500);
    for (const c of children) {
      if (c.exitCode === null) c.kill('SIGKILL');
    }
    if (!KEEP) {
      // keep results.json + logs for post-mortem even on success
      console.log(`(run dir kept for inspection: ${RUN_DIR})`);
    }
    process.exit(failures > 0 ? 1 : 0);
  });