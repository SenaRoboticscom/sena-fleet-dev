// Pruebas del MCP de desarrollo, de punta a punta: se arranca el servidor como lo
// arrancaría Claude Code (proceso hijo, stdio) y se le habla en JSON-RPC.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { firmar, verificar } from '../../event-dispatcher/src/firma.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');

// ── Cliente mínimo ────────────────────────────────────────────────────────────
let mcp;
let siguienteId = 1;
const pendientes = new Map();
const lineasRaras = [];

function pedir(method, params) {
  const id = siguienteId++;
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve) => pendientes.set(id, resolve));
}
const llamar = async (name, args) => (await pedir('tools/call', { name, arguments: args })).result;

// ── Lo que hace falta alrededor: el conector de demo y un receptor de webhooks ─
const PUERTO_CONECTOR = 40000 + Math.floor(Math.random() * 10000);
const TOKEN_CONECTOR = 'token-de-prueba-0123456789abcdef';
const SECRETO = 'whsec_prueba';
let conector;
let receptor;
let urlReceptor;

before(async () => {
  mcp = spawn(process.execPath, [path.join(RAIZ, 'mcp-dev', 'src', 'server.mjs')], { stdio: ['pipe', 'pipe', 'ignore'] });
  let resto = '';
  mcp.stdout.on('data', (c) => {
    resto += c;
    let i;
    while ((i = resto.indexOf('\n')) >= 0) {
      const l = resto.slice(0, i); resto = resto.slice(i + 1);
      let m; try { m = JSON.parse(l); } catch { lineasRaras.push(l); continue; }
      pendientes.get(m.id)?.(m); pendientes.delete(m.id);
    }
  });

  conector = spawn(process.execPath, [path.join(RAIZ, 'connector-demo', 'src', 'server.mjs')], {
    env: { ...process.env, PORT: String(PUERTO_CONECTOR), CONNECTOR_TOKEN: TOKEN_CONECTOR, NODE_ENV: 'production' }, stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PUERTO_CONECTOR}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }

  // Un receptor bien hecho: 204 solo con firma válida y reciente.
  receptor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      res.writeHead(verificar(SECRETO, cuerpo, req.headers['x-sena-signature']) ? 204 : 401);
      res.end();
    });
  });
  await new Promise((r) => receptor.listen(0, '127.0.0.1', r));
  urlReceptor = `http://127.0.0.1:${receptor.address().port}/webhooks`;
});

after(() => { mcp?.kill(); conector?.kill(); receptor?.close(); });

// ── Protocolo ─────────────────────────────────────────────────────────────────
test('initialize: acepta la versión del cliente y se presenta', async () => {
  const r = (await pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } })).result;
  assert.equal(r.protocolVersion, '2025-06-18');
  assert.equal(r.serverInfo.name, 'sena-dev');
  assert.ok(r.capabilities.tools && r.capabilities.resources);
  assert.match(r.instructions, /sena_documentacion/);
});

test('initialize: con una versión desconocida propone la suya', async () => {
  const r = (await pedir('initialize', { protocolVersion: '1999-01-01' })).result;
  assert.equal(r.protocolVersion, '2025-11-25');
});

test('método desconocido: -32601; notificación: sin respuesta; nada raro por stdout', async () => {
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const r = await pedir('prompts/list');
  assert.equal(r.error.code, -32601);
  assert.deepEqual(lineasRaras, []);
});

test('tools/list: las cinco herramientas, con esquema', async () => {
  const { tools } = (await pedir('tools/list')).result;
  assert.deepEqual(tools.map((t) => t.name).sort(), ['sena_documentacion', 'sena_plantilla_conector', 'sena_probar_conector', 'sena_simular_webhook', 'sena_verificar_firma']);
  for (const t of tools) assert.equal(t.inputSchema.type, 'object');
});

// ── Documentación ─────────────────────────────────────────────────────────────
test('documentación: webhooks, vocabulario y tema inválido', async () => {
  assert.match((await llamar('sena_documentacion', { tema: 'webhooks' })).content[0].text, /X-Sena-Signature/);
  const voc = JSON.parse((await llamar('sena_documentacion', { tema: 'vocabulario' })).content[0].text);
  assert.ok(voc.estados.includes('idle'));
  assert.ok(voc.errores.some((e) => e.code === 'robot_not_found' && e.http === 404));
  const mal = await llamar('sena_documentacion', { tema: 'plan' });
  assert.equal(mal.isError, true);
});

test('documentación: el contrato trae autenticación y rutas', async () => {
  const t = (await llamar('sena_documentacion', { tema: 'contrato' })).content[0].text;
  assert.match(t, /X-Adapter-Context/);
  assert.match(t, /GET \/robots\/:id\/status/);
});

test('recursos: lista y lectura', async () => {
  const { resources } = (await pedir('resources/list')).result;
  assert.ok(resources.some((r) => r.uri === 'sena://docs/api-v1'));
  const r = (await pedir('resources/read', { uri: 'sena://docs/api-v1' })).result;
  assert.match(r.contents[0].text, /Idempotency-Key/);
  assert.equal((await pedir('resources/read', { uri: 'sena://docs/nada' })).error.code, -32002);
});

test('plantilla: trae el conector y la marca de dónde tocar', async () => {
  const t = (await llamar('sena_plantilla_conector', {})).content[0].text;
  assert.match(t, /AQUÍ HABLARÍA CON LA NUBE DE LA MARCA/);
  assert.match(t, /### Dockerfile/);
});

// ── Comprobador ───────────────────────────────────────────────────────────────
test('probar conector: el de demo cumple el contrato', async () => {
  const r = await llamar('sena_probar_conector', { url: `http://127.0.0.1:${PUERTO_CONECTOR}`, token: TOKEN_CONECTOR });
  assert.notEqual(r.isError, true);
  assert.match(r.content[0].text, /RESULTADO: el conector cumple el contrato/);
});

test('probar conector: con el token equivocado falla y lo dice', async () => {
  const r = await llamar('sena_probar_conector', { url: `http://127.0.0.1:${PUERTO_CONECTOR}`, token: 'otro-token-de-prueba-que-no-es' });
  assert.match(r.content[0].text, /hay comprobaciones que fallan/);
});

test('probar conector: sin conector, error claro', async () => {
  const r = await llamar('sena_probar_conector', { url: 'http://127.0.0.1:1', token: TOKEN_CONECTOR });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /No se pudo conectar/);
});

// ── Webhooks ──────────────────────────────────────────────────────────────────
test('simular webhook: el receptor acepta la firma buena y rechaza las otras dos', async () => {
  const buena = (await llamar('sena_simular_webhook', { url: urlReceptor, secreto: SECRETO, tipo: 'mission.status_changed' })).content[0].text;
  assert.match(buena, /^BIEN: el receptor aceptó/);
  assert.match(buena, /HTTP 204/);
  for (const firma of ['incorrecta', 'caducada']) {
    const t = (await llamar('sena_simular_webhook', { url: urlReceptor, secreto: SECRETO, tipo: 'incident.opened', firma })).content[0].text;
    assert.match(t, new RegExp(`^BIEN: rechazó un webhook con firma ${firma}`));
  }
});

test('simular webhook: avisa de un receptor que lo acepta todo', async () => {
  const todoVale = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200); res.end('ok'); }); });
  await new Promise((r) => todoVale.listen(0, '127.0.0.1', r));
  const t = (await llamar('sena_simular_webhook', { url: `http://127.0.0.1:${todoVale.address().port}/`, secreto: SECRETO, tipo: 'webhook.test', firma: 'incorrecta' })).content[0].text;
  todoVale.close();
  assert.match(t, /^MAL: aceptó un webhook con firma incorrecta/);
});

test('verificar firma: válida, alterada y caducada', async () => {
  const cuerpo = '{"id":"x","type":"webhook.test"}';
  const buena = firmar(SECRETO, cuerpo);
  assert.match((await llamar('sena_verificar_firma', { secreto: SECRETO, cuerpo, cabecera: buena })).content[0].text, /^VÁLIDA/);
  assert.match((await llamar('sena_verificar_firma', { secreto: SECRETO, cuerpo: `${cuerpo} `, cabecera: buena })).content[0].text, /no corresponde/);
  const vieja = firmar(SECRETO, cuerpo, Math.floor(Date.now() / 1000) - 900);
  assert.match((await llamar('sena_verificar_firma', { secreto: SECRETO, cuerpo, cabecera: vieja })).content[0].text, /tiene 9\d\d s/);
});
