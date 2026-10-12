#!/usr/bin/env node
// =============================================================================
//  SENA FLEET — comprobador de conectores (¿cumple el contrato §5?)
// -----------------------------------------------------------------------------
//  Antes de dar de alta el conector de una marca nueva hay que saber si habla el
//  contrato (docs/contrato-conector.md) tal como lo espera la plataforma. Esto lo
//  comprueba punto por punto y dice qué falla. Es lo que un desarrollador pasa
//  antes de pedir el alta, y la base de la futura certificación.
//
//  USO
//    node tools/probar-conector.mjs --url http://localhost:4010 --token XXX
//    node tools/probar-conector.mjs --url … --token … --escritura
//
//  Sin --escritura solo LEE. Con --escritura manda una misión al primer robot en
//  línea y la cancela: ¡contra un conector real, mueve un robot de verdad!
//  (La clave: --credentials '{"...":"..."}' se manda como X-Adapter-Context.)
// =============================================================================
import { CANONICAL_STATES, AdapterErrorCode, Capability } from '../adapters/contract.mjs';

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const URL_BASE = String(arg('url') ?? '').replace(/\/+$/, '');
const TOKEN = arg('token') ?? '';
const ESCRITURA = args.includes('--escritura');
// También por variable (PROBAR_CREDENTIALS), que es como las pasa el MCP de
// desarrollo (mcp-dev/): en la línea de comandos las ve cualquier proceso del equipo.
const CREDS_TXT = arg('credentials') ?? process.env.PROBAR_CREDENTIALS;
const CREDS = CREDS_TXT ? JSON.parse(CREDS_TXT) : {};
if (!URL_BASE) { console.error('Uso: node tools/probar-conector.mjs --url <url> --token <token> [--escritura]'); process.exit(2); }

const CODIGOS = new Set(Object.values(AdapterErrorCode));
const CAPS = new Set(Object.values(Capability));
let fallos = 0;
let avisos = 0;
const ok = (c, m, x = '') => { console.log(`${c ? '✔' : '✖'} ${m}${x ? ` — ${x}` : ''}`); if (!c) fallos++; return c; };
const aviso = (m) => { console.log(`⚠ ${m}`); avisos++; };

async function pedir(method, path, { body, sinToken = false } = {}) {
  const ctx = Buffer.from(JSON.stringify({ credentials: CREDS, metadata: {} })).toString('base64url');
  const r = await fetch(URL_BASE + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(!sinToken && TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      'X-Adapter-Context': ctx,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}

const errorDelContrato = (j) => j?.error && CODIGOS.has(j.error.code);

console.log(`Conector: ${URL_BASE}\n`);

// 1. Salud (sin token)
let r = await pedir('GET', '/health', { sinToken: true });
ok(r.status === 200 && r.j?.ok === true, 'GET /health responde { ok: true } sin token', `HTTP ${r.status}`);

// 2. Seguridad: sin token no se entra
r = await pedir('GET', '/robots', { sinToken: true });
if (!TOKEN) aviso('sin --token no se puede comprobar que el conector exige autenticación');
else ok(r.status === 401 && errorDelContrato(r.j), 'sin token: 401 con error del catálogo', `HTTP ${r.status}`);

// 3. Capacidades
r = await pedir('GET', '/capabilities');
const caps = Array.isArray(r.j) ? r.j : r.j?.capabilities;
ok(r.status === 200 && Array.isArray(caps), 'GET /capabilities devuelve una lista');
const raras = (caps ?? []).filter((c) => !CAPS.has(c));
ok(raras.length === 0, 'solo capacidades del contrato', raras.length ? `desconocidas: ${raras.join(', ')}` : (caps ?? []).join(', '));

// 4. Descubrimiento
r = await pedir('GET', '/robots');
const lista = Array.isArray(r.j) ? r.j : r.j?.robots;
ok(r.status === 200 && Array.isArray(lista), 'GET /robots devuelve una lista', `${lista?.length ?? 0} robots`);
ok((lista ?? []).every((x) => x?.robotId), 'cada robot trae robotId');
const enLinea = (lista ?? []).find((x) => x.online);
if (!enLinea) aviso('ningún robot en línea: se omiten las comprobaciones de estado y misión');

// 5. Estado de un robot
if (enLinea) {
  const id = encodeURIComponent(enLinea.robotId);
  r = await pedir('GET', `/robots/${id}/status`);
  ok(r.status === 200, `GET /robots/${enLinea.robotId}/status`, `HTTP ${r.status}`);
  ok(CANONICAL_STATES.includes(r.j?.state), 'state es un estado del contrato', String(r.j?.state));
  ok(typeof r.j?.online === 'boolean', 'online es booleano');
  ok(r.j?.battery == null || Number.isFinite(r.j.battery), 'battery es número o null');

  r = await pedir('GET', `/robots/${id}/points`);
  const pts = Array.isArray(r.j) ? r.j : r.j?.points;
  ok(r.status === 200 && Array.isArray(pts), 'GET …/points devuelve una lista', `${pts?.length ?? 0} puntos`);
  ok((pts ?? []).every((x) => x?.name && (x.pointId != null || x.pointUuid != null)), 'cada punto trae name y pointId/pointUuid');

  // 6. Escritura (opcional)
  if (ESCRITURA && pts?.length) {
    const destino = pts.find((x) => x.type !== 'charge') ?? pts[0];
    r = await pedir('POST', `/robots/${id}/missions`, { body: { pointId: destino.pointId, pointName: destino.name } });
    ok(r.status === 200 && r.j?.taskId != null, 'POST …/missions devuelve taskId', `HTTP ${r.status}`);
    const taskId = r.j?.taskId;
    r = await pedir('GET', `/robots/${id}/status`);
    ok(r.j?.currentMission?.taskId === taskId, 'el estado refleja la misión en currentMission.taskId');
    r = await pedir('POST', `/robots/${id}/missions/control`, { body: { op: 'cancel', taskId } });
    ok(r.status === 200, 'cancelar la misión');
  } else if (!ESCRITURA) {
    aviso('sin --escritura no se prueba el envío de misiones');
  }
}

// 7. Errores del catálogo
r = await pedir('GET', '/robots/NO-EXISTE-XYZ/status');
ok(r.status === 404 && r.j?.error?.code === 'robot_not_found', 'robot inexistente: 404 robot_not_found', `HTTP ${r.status} ${r.j?.error?.code ?? ''}`);

console.log(`\n${fallos ? `✖ ${fallos} comprobaciones fallan` : '✔ El conector cumple el contrato'}${avisos ? ` · ${avisos} avisos` : ''}`);
// exitCode y no exit(): con process.exit y conexiones de fetch abiertas, Node en
// Windows revienta al salir ("Assertion failed … async.c") tras dar el resultado.
process.exitCode = fallos ? 1 : 0;
