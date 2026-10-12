/**
 * SENA FLEET — Conector de DEMOSTRACIÓN (robots virtuales) · plantilla de conector
 * -----------------------------------------------------------------------------
 * Un conector completo que cumple el contrato de conectores
 * (docs/contrato-conector.md), con tres robots SIMULADOS. Tres usos:
 *   1. Probar la plataforma sin depender de la marca de nadie.
 *   2. La PLANTILLA que se da a quien quiera escribir un conector: cambiando la
 *      parte marcada "AQUÍ HABLARÍA CON LA NUBE DE LA MARCA", es un conector real.
 *   3. El entorno de pruebas para desarrolladores.
 *
 * Sin dependencias: solo node:http, para que se lea de un vistazo.
 *
 * Lo que simula:
 *   · Tres robots POR CUENTA: DEMO-001…003 sin cuenta, y ACME-001…003 si las
 *     credenciales traen { "cuenta": "ACME" }. El 001 y el 002 en línea; el 003
 *     DESCONECTADO a propósito (para ver cómo se comporta la plataforma con un
 *     robot caído).
 *   · Una misión tarda DEMO_TRAVEL_S (def. 20 s): 'moving' → llega → 'idle'.
 *   · La batería baja moviéndose y sube cargando.
 *
 * Variables: PORT (def. 4010), CONNECTOR_TOKEN (Bearer que manda la plataforma;
 * obligatorio con NODE_ENV=production), DEMO_TRAVEL_S.
 * -----------------------------------------------------------------------------
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT) || 4010;
const TOKEN = process.env.CONNECTOR_TOKEN || '';
const VIAJE_MS = (Number(process.env.DEMO_TRAVEL_S) || 20) * 1000;
const VERSION = 'demo-1.0.0';

if (!TOKEN && process.env.NODE_ENV === 'production') {
  throw new Error('CONNECTOR_TOKEN no definido: el conector quedaría abierto.');
}

// ── El "mundo" simulado ───────────────────────────────────────────────────────
const PUNTOS = [
  { pointId: 'base', name: 'Base de carga', type: 'charge' },
  { pointId: 'recepcion', name: 'Recepción', type: 'other' },
  ...[1, 2, 3, 4, 5].map((n) => ({ pointId: `mesa-${n}`, name: `Mesa ${n}`, type: 'table' })),
];

// Cada cuenta de cliente tiene SUS robots. La cuenta llega en X-Adapter-Context,
// como llegarían las credenciales de una marca de verdad. Así, en un entorno de
// pruebas compartido, cada desarrollador tiene los suyos: el número de serie de
// un robot es único en toda la plataforma.
const MAX_CUENTAS = 50;
const cuentas = new Map(); // prefijo → Map(robotId → robot)

function robotsNuevos(prefijo) {
  return new Map([
    [`${prefijo}-001`, { name: 'Demo Uno', online: true, battery: 90, state: 'idle', mision: null, pos: 'base' }],
    [`${prefijo}-002`, { name: 'Demo Dos', online: true, battery: 55, state: 'charging', mision: null, pos: 'base' }],
    [`${prefijo}-003`, { name: 'Demo Tres', online: false, battery: 12, state: 'offline', mision: null, pos: 'recepcion' }],
  ]);
}

/** Los robots de la cuenta que llama, o null si ya hay demasiadas cuentas. */
function robotsDe(req) {
  let ctx = {};
  try { ctx = JSON.parse(Buffer.from(String(req.headers['x-adapter-context'] || ''), 'base64url').toString('utf8')) ?? {}; } catch {}
  const cuenta = String(ctx?.credentials?.cuenta ?? '').trim().toUpperCase();
  const prefijo = /^[A-Z0-9]{1,12}$/.test(cuenta) ? cuenta : 'DEMO';
  if (!cuentas.has(prefijo)) {
    if (cuentas.size >= MAX_CUENTAS) return null;
    cuentas.set(prefijo, robotsNuevos(prefijo));
  }
  return cuentas.get(prefijo);
}

// Cada segundo: batería y llegadas. AQUÍ HABLARÍA CON LA NUBE DE LA MARCA: un
// conector real no simula nada, pregunta a la API del fabricante y traduce.
setInterval(() => {
  const ahora = Date.now();
  for (const r of [...cuentas.values()].flatMap((robots) => [...robots.values()])) {
    if (!r.online) continue;
    if (r.state === 'moving') r.battery = Math.max(0, r.battery - 0.2);
    if (r.state === 'charging') r.battery = Math.min(100, r.battery + 0.5);
    if (r.state === 'moving' && r.mision && ahora >= r.mision.llegaEn) {
      r.pos = r.mision.destino;
      r.state = r.mision.destino === 'base' ? 'charging' : 'idle';
      r.mision = null;
    }
  }
}, 1000).unref();

// ── Traducción al contrato ────────────────────────────────────────────────────
function estado(id, r) {
  return {
    robotId: id,
    state: r.online ? r.state : 'offline',   // SOLO estados del contrato
    online: r.online,
    battery: Math.round(r.battery),
    charging: r.state === 'charging',
    currentMission: r.mision ? { taskId: r.mision.taskId, kind: 'delivery', destination: r.mision.destino } : null,
    errors: [],
    raw: { simulado: true },
  };
}

function error(res, status, code, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
}
function ok(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function autorizado(req) {
  if (!TOKEN) return true; // solo en desarrollo (en producción no arranca sin él)
  const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function cuerpo(req) {
  let t = '';
  for await (const c of req) { t += c; if (t.length > 64_000) break; }
  try { return t ? JSON.parse(t) : {}; } catch { return {}; }
}

// ── Rutas del contrato ────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/health') return ok(res, { ok: true, provider: 'demo', version: VERSION, checkedAt: new Date().toISOString() });
  if (!autorizado(req)) return error(res, 401, 'auth_failed', 'token inválido');

  // La plataforma manda en X-Adapter-Context las credenciales de la cuenta del
  // cliente. Un conector real las usaría para hablar con la nube de la marca;
  // este solo mira `cuenta` para saber qué robots enseñar. NUNCA se registran en el log.
  const robots = robotsDe(req);
  if (!robots) return error(res, 429, 'rate_limited', 'demasiadas cuentas de demostración');

  if (req.method === 'GET' && p === '/capabilities') {
    return ok(res, { capabilities: ['send_mission', 'control_mission', 'return_to_charge', 'live_location', 'list_points', 'discovery'] });
  }
  if (req.method === 'GET' && p === '/robots') {
    return ok(res, { robots: [...robots].map(([id, r]) => ({ robotId: id, name: r.name, model: 'DEMO', online: r.online })) });
  }

  const m = /^\/robots\/([^/]+)(\/.*)?$/.exec(p);
  if (!m) return error(res, 404, 'invalid_request', 'ruta desconocida');
  const id = decodeURIComponent(m[1]);
  const resto = m[2] || '';
  const r = robots.get(id);
  if (!r) return error(res, 404, 'robot_not_found', `no existe ${id}`);

  if (req.method === 'GET' && resto === '/status') return ok(res, estado(id, r));
  if (req.method === 'GET' && resto === '/location') {
    const i = PUNTOS.findIndex((x) => x.pointId === r.pos);
    return ok(res, { supported: true, x: i * 2.5, y: 1, angle: 0, floor: 1, mapName: 'Demo', raw: {} });
  }
  if (req.method === 'GET' && resto === '/points') return ok(res, { points: PUNTOS.map((x, i) => ({ ...x, x: i * 2.5, y: 1, floor: 1, raw: {} })) });

  if (!r.online) return error(res, 409, 'robot_offline', `${id} está desconectado`);

  if (req.method === 'POST' && resto === '/missions') {
    const b = await cuerpo(req);
    const destino = PUNTOS.find((x) => x.pointId === b.pointId || x.name === b.pointName);
    if (!destino) return error(res, 404, 'point_not_found', 'ese punto no existe en el mapa');
    if (r.state === 'moving') return error(res, 409, 'robot_busy', `${id} ya está en una misión`);
    const taskId = `T${Date.now().toString(36)}`;
    r.mision = { taskId, destino: destino.pointId, llegaEn: Date.now() + VIAJE_MS };
    r.state = 'moving';
    return ok(res, { taskId, accepted: true, raw: { simulado: true } });
  }
  if (req.method === 'POST' && resto === '/missions/control') {
    const b = await cuerpo(req);
    if (!r.mision) return error(res, 409, 'robot_busy', 'no hay misión en curso');
    if (b.op === 'pause') { r.state = 'paused'; r.mision.restante = r.mision.llegaEn - Date.now(); }
    else if (b.op === 'resume') { r.state = 'moving'; r.mision.llegaEn = Date.now() + (r.mision.restante ?? VIAJE_MS); }
    else if (b.op === 'cancel') { r.mision = null; r.state = 'idle'; }
    else return error(res, 400, 'invalid_request', 'op debe ser pause, resume o cancel');
    return ok(res, { ok: true, raw: {} });
  }
  if (req.method === 'POST' && resto === '/return-to-charge') {
    const taskId = `T${Date.now().toString(36)}`;
    r.mision = { taskId, destino: 'base', llegaEn: Date.now() + VIAJE_MS };
    r.state = 'moving';
    return ok(res, { mode: 'charge_point', taskId, point: 'base', raw: {} });
  }
  return error(res, 501, 'op_unsupported', 'operación no soportada por este conector');
});

server.listen(PORT, () => console.log(`[CONECTOR-DEMO] escuchando en :${PORT} · ${VERSION} · auth=${TOKEN ? 'ON' : 'OFF(dev)'} · viaje ${VIAJE_MS / 1000} s`));
