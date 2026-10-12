// SENA FLEET — MCP de desarrollo · herramientas y documentos
// -----------------------------------------------------------------------------
// Lo que el agente de IA de un desarrollador (Claude Code, Cursor…) puede hacer
// para construir sobre Sena Fleet sin inventarse nada:
//   · leer la documentación oficial (contrato de conectores, API /v1, webhooks);
//   · partir de la plantilla de conector;
//   · pasar el comprobador del contrato contra su conector;
//   · mandar a su app webhooks firmados como los de verdad, y comprobar firmas.
//
// REGLA: nada de aquí hace algo que no permita ya lo público. No toca la
// plataforma: corre en el equipo
// del desarrollador y solo habla con SU conector y SU app. Por eso reutiliza el
// código de verdad (contrato, comprobador, firma) en vez de copiarlo: si cambia
// la plataforma, cambia esto.
// -----------------------------------------------------------------------------
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CANONICAL_STATES, AdapterErrorCode, ERROR_HTTP, Capability } from '../../adapters/contract.mjs';
import { firmar, verificar } from '../../event-dispatcher/src/firma.mjs';
import { ErrorDeUso } from './protocolo.mjs';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Solo la documentación pública para desarrolladores.
const DOCUMENTOS = {
  conectores: { fichero: 'docs/conectores.md', titulo: 'Escribir un conector de marca', descripcion: 'Guía completa: qué rutas, cómo se aloja, plantilla, comprobador y cómo pedir el alta.' },
  contrato: { fichero: 'docs/contrato-conector.md', titulo: 'Contrato de conectores', descripcion: 'Autenticación, rutas, estados, capacidades, modelos JSON y errores que tiene que cumplir un conector.' },
  'api-v1': { fichero: 'docs/api-v1.md', titulo: 'API pública v1', descripcion: 'Consultar robots y misiones, y mandar misiones, con una clave de API.' },
  webhooks: { fichero: 'docs/webhooks.md', titulo: 'Webhooks', descripcion: 'Eventos que manda la plataforma, su firma, reintentos y cómo responder.' },
};
const TEMAS = [...Object.keys(DOCUMENTOS), 'vocabulario'];

async function leerDocumento(tema) {
  if (tema === 'vocabulario') {
    // Sale del código del contrato, no de un texto: siempre al día.
    return JSON.stringify({
      estados: CANONICAL_STATES,
      errores: Object.values(AdapterErrorCode).map((code) => ({ code, http: ERROR_HTTP[code] ?? null })),
      capacidades: Object.values(Capability),
    }, null, 2);
  }
  const d = DOCUMENTOS[tema];
  if (!d) return null;
  return fs.readFile(path.join(RAIZ, d.fichero), 'utf8');
}

export const RECURSOS = {
  listar: () => [
    ...Object.entries(DOCUMENTOS).map(([tema, d]) => ({ uri: `sena://docs/${tema}`, name: tema, title: d.titulo, description: d.descripcion, mimeType: 'text/markdown' })),
    { uri: 'sena://docs/vocabulario', name: 'vocabulario', title: 'Vocabulario del contrato', description: 'Estados, códigos de error (con su HTTP) y capacidades válidas, en JSON.', mimeType: 'application/json' },
  ],
  async leer(uri) {
    const m = /^sena:\/\/docs\/([a-z0-9-]+)$/.exec(String(uri ?? ''));
    const texto = m ? await leerDocumento(m[1]) : null;
    if (texto == null) return null;
    return { mimeType: m[1] === 'vocabulario' ? 'application/json' : 'text/markdown', text: texto };
  },
};

// ── Comprobaciones de entrada ─────────────────────────────────────────────────
function urlHttp(valor, campo) {
  let u;
  try { u = new URL(String(valor ?? '')); } catch { throw new ErrorDeUso(`${campo}: no es una URL válida`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ErrorDeUso(`${campo}: tiene que empezar por http:// o https://`);
  return u.toString().replace(/\/+$/, '');
}
function texto(valor, campo, { obligatorio = true } = {}) {
  if (valor == null || valor === '') { if (obligatorio) throw new ErrorDeUso(`falta ${campo}`); return ''; }
  if (typeof valor !== 'string') throw new ErrorDeUso(`${campo} tiene que ser texto`);
  return valor;
}

// ── Eventos de ejemplo (la FORMA es la de los eventos reales: docs/webhooks.md) ─
export const TIPOS_EVENTO = ['mission.created', 'mission.status_changed', 'incident.opened', 'incident.resolved', 'incident.dismissed', 'webhook.test'];

function datosDeEjemplo(tipo) {
  const ahora = new Date().toISOString();
  const robot_sn = 'DEMO-001';
  const incidencia = { incident_id: crypto.randomUUID(), robot_sn, elevator_id: null, severity: 'critical', code: 'robot_offline', title: 'Robot desconectado' };
  switch (tipo) {
    case 'mission.created':
      return { mission_id: crypto.randomUUID(), robot_sn, status: 'sent', point_id: '12', task_no: 'T-1001', source: 'platform', created_at: ahora, route: null };
    case 'mission.status_changed':
      return { mission_id: crypto.randomUUID(), robot_sn, from: 'sent', to: 'arrived', point_id: '12', arrived_at: ahora, returned_at: null, changed_at: ahora, route: null };
    case 'incident.opened': return { ...incidencia, created_at: ahora };
    case 'incident.resolved': return { ...incidencia, resolved_at: ahora };
    case 'incident.dismissed': return { ...incidencia, dismissed_at: ahora };
    default: return { subscription_id: crypto.randomUUID(), message: 'Prueba de Sena Fleet: si ves esto, tu webhook funciona.' };
  }
}

// ── Las herramientas ──────────────────────────────────────────────────────────
const documentacion = {
  definicion: {
    name: 'sena_documentacion',
    title: 'Documentación de Sena Fleet',
    description: 'Devuelve la documentación oficial para desarrolladores de Sena Fleet. Léela ANTES de escribir código: '
      + '"conectores" (guía para conectar una marca de robots), "contrato" (lo que tiene que cumplir un conector), '
      + '"vocabulario" (estados, errores y capacidades válidos, en JSON), "api-v1" (API pública para apps) y '
      + '"webhooks" (eventos que manda la plataforma y cómo verificar su firma).',
    inputSchema: { type: 'object', properties: { tema: { type: 'string', enum: TEMAS } }, required: ['tema'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ejecutar({ tema }) {
    const t = await leerDocumento(tema);
    if (t == null) throw new ErrorDeUso(`tema desconocido. Elige uno de: ${TEMAS.join(', ')}`);
    return t;
  },
};

const plantilla = {
  definicion: {
    name: 'sena_plantilla_conector',
    title: 'Plantilla de conector',
    description: 'Devuelve los ficheros de un conector completo y funcional (tres robots simulados, sin dependencias). '
      + 'Es el punto de partida para conectar una marca nueva: cópialos y sustituye la parte marcada '
      + '"AQUÍ HABLARÍA CON LA NUBE DE LA MARCA" por llamadas a la API del fabricante.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ejecutar() {
    const ficheros = ['Dockerfile', 'package.json', 'src/server.mjs'];
    const partes = await Promise.all(ficheros.map(async (f) => {
      const contenido = await fs.readFile(path.join(RAIZ, 'connector-demo', f), 'utf8');
      return `### ${f}\n\n\`\`\`${f.endsWith('.mjs') ? 'js' : f.endsWith('.json') ? 'json' : 'dockerfile'}\n${contenido.trimEnd()}\n\`\`\``;
    }));
    return [
      'Plantilla de conector de Sena Fleet (connector-demo). Crea una carpeta nueva con estos tres ficheros.',
      'Para probarla: `CONNECTOR_TOKEN=un-token-largo-de-24-o-mas node src/server.mjs` y después la herramienta sena_probar_conector con url http://localhost:4010.',
      'Requisitos de la imagen (usuario nobody, disco de solo lectura, puerto 4010, solo salida por 443): ver sena_documentacion tema "conectores".',
      '',
      ...partes,
    ].join('\n');
  },
};

const probar = {
  definicion: {
    name: 'sena_probar_conector',
    title: 'Comprobar un conector contra el contrato',
    description: 'Comprueba punto por punto si un conector cumple el contrato de Sena Fleet (salud, autenticación, '
      + 'capacidades, descubrimiento, estado, puntos, errores) y dice qué falla. Pasarlo en verde es el requisito para '
      + 'pedir el alta. Por defecto SOLO LEE. Con escritura=true manda una misión al primer robot en línea y la '
      + 'cancela: contra una marca real MUEVE UN ROBOT DE VERDAD; úsalo solo si el usuario lo pide expresamente.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Dirección del conector, p. ej. http://localhost:4010' },
        token: { type: 'string', description: 'El CONNECTOR_TOKEN con el que arrancó el conector' },
        credenciales: { type: 'object', description: 'Credenciales de la cuenta de la marca, si el conector las usa. Viajan como X-Adapter-Context, como en producción.' },
        escritura: { type: 'boolean', description: 'true = probar también el envío de una misión (mueve un robot real). Por defecto false.' },
      },
      required: ['url', 'token'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  async ejecutar(args) {
    const url = urlHttp(args.url, 'url');
    const token = texto(args.token, 'token');
    if (args.credenciales != null && (typeof args.credenciales !== 'object' || Array.isArray(args.credenciales))) {
      throw new ErrorDeUso('credenciales tiene que ser un objeto JSON');
    }
    const argv = [path.join(RAIZ, 'tools', 'probar-conector.mjs'), '--url', url, '--token', token];
    if (args.escritura === true) argv.push('--escritura');
    // Las credenciales por variable, no por argumento: no quedan en la lista de procesos.
    const env = { ...process.env, PROBAR_CREDENTIALS: args.credenciales ? JSON.stringify(args.credenciales) : '' };

    const { codigo, salida } = await new Promise((resolve) => {
      const hijo = spawn(process.execPath, argv, { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let s = '';
      hijo.stdout.on('data', (c) => { s += c; });
      hijo.stderr.on('data', (c) => { s += c; });
      const reloj = setTimeout(() => { s += '\n(se cortó: más de 2 minutos sin terminar)'; hijo.kill(); }, 120_000);
      hijo.on('close', (code) => { clearTimeout(reloj); resolve({ codigo: code, salida: s.trim() }); });
    });
    if (/fetch failed|ECONNREFUSED/.test(salida) && !salida.includes('✔')) {
      throw new ErrorDeUso(`No se pudo conectar con ${url}. ¿Está arrancado el conector y escucha en ese puerto?\n\n${salida.slice(-1500)}`);
    }
    // Por el resumen que imprime el comprobador, no solo por el código de salida.
    const cumple = codigo === 0 && salida.includes('✔ El conector cumple el contrato') && !salida.includes('✖');
    const veredicto = cumple
      ? 'RESULTADO: el conector cumple el contrato.'
      : 'RESULTADO: hay comprobaciones que fallan (✖). Corrígelas y vuelve a pasar el comprobador.';
    return `${veredicto}\n\n${salida}`;
  },
};

const simular = {
  definicion: {
    name: 'sena_simular_webhook',
    title: 'Mandar un webhook de prueba firmado',
    description: 'Manda a la app del desarrollador un webhook exactamente como los manda Sena Fleet (mismo cuerpo, '
      + 'mismas cabeceras, misma firma HMAC) y cuenta qué respondió. Sirve para probar el receptor sin esperar a '
      + 'que un robot haga algo. Con firma="incorrecta" o "caducada" comprueba que el receptor RECHAZA lo falso: '
      + 'un receptor bien hecho tiene que responder 2xx solo con la firma correcta.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL del receptor, p. ej. http://localhost:3000/webhooks/sena' },
        secreto: { type: 'string', description: 'Secreto de firma (whsec_…). Para pruebas locales vale cualquiera, el mismo que use el receptor.' },
        tipo: { type: 'string', enum: TIPOS_EVENTO },
        datos: { type: 'object', description: 'Campos de `data` que quieras cambiar sobre el ejemplo (opcional).' },
        firma: { type: 'string', enum: ['correcta', 'incorrecta', 'caducada'], description: 'Por defecto "correcta".' },
      },
      required: ['url', 'secreto', 'tipo'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ejecutar(args) {
    const url = urlHttp(args.url, 'url');
    const secreto = texto(args.secreto, 'secreto');
    if (!TIPOS_EVENTO.includes(args.tipo)) throw new ErrorDeUso(`tipo desconocido. Elige uno de: ${TIPOS_EVENTO.join(', ')}`);
    if (args.datos != null && (typeof args.datos !== 'object' || Array.isArray(args.datos))) throw new ErrorDeUso('datos tiene que ser un objeto JSON');
    const modo = args.firma ?? 'correcta';
    if (!['correcta', 'incorrecta', 'caducada'].includes(modo)) throw new ErrorDeUso('firma: "correcta", "incorrecta" o "caducada"');

    const id = crypto.randomUUID();
    // Mismo orden de campos que la plataforma: el receptor verifica el cuerpo tal cual.
    const cuerpo = JSON.stringify({ id, type: args.tipo, created_at: new Date().toISOString(), data: { ...datosDeEjemplo(args.tipo), ...(args.datos ?? {}) } });
    const ahora = Math.floor(Date.now() / 1000);
    const firma = modo === 'incorrecta' ? firmar(`${secreto}-otro`, cuerpo, ahora)
      : modo === 'caducada' ? firmar(secreto, cuerpo, ahora - 600)
        : firmar(secreto, cuerpo, ahora);

    const inicio = Date.now();
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sena-event-id': id, 'x-sena-event-type': args.tipo, 'x-sena-signature': firma },
        body: cuerpo,
        redirect: 'manual', // la plataforma no sigue redirecciones
        signal: AbortSignal.timeout(10_000), // ni espera más de 10 s
      });
    } catch (e) {
      const motivo = e.name === 'TimeoutError' ? 'no respondió en 10 s (la plataforma lo contaría como fallo y reintentaría)' : (e.cause?.code ?? e.message);
      throw new ErrorDeUso(`No se pudo entregar en ${url}: ${motivo}`);
    }
    const ms = Date.now() - inicio;
    const respuesta = (await r.text().catch(() => '')).slice(0, 500);
    const aceptado = r.status >= 200 && r.status < 300;

    let veredicto;
    if (modo === 'correcta') {
      veredicto = aceptado ? 'BIEN: el receptor aceptó un webhook auténtico.'
        : r.status >= 300 && r.status < 400 ? 'MAL: respondió con una redirección. La plataforma no las sigue: cuenta como fallo.'
          : 'MAL: rechazó un webhook auténtico. Revisa la verificación de la firma (¿usas el cuerpo CRUDO, tal cual llega, y no el JSON vuelto a escribir?).';
    } else {
      veredicto = aceptado
        ? `MAL: aceptó un webhook con firma ${modo}. Cualquiera podría mandarle avisos falsos${modo === 'caducada' ? ' o reenviar uno capturado: rechaza los de más de 5 minutos' : ''}.`
        : `BIEN: rechazó un webhook con firma ${modo}.`;
    }
    return [
      veredicto,
      '',
      `Respuesta: HTTP ${r.status} en ${ms} ms${ms > 10_000 ? ' (más de 10 s: la plataforma lo contaría como fallo)' : ''}`,
      respuesta ? `Cuerpo de la respuesta: ${respuesta}` : 'Sin cuerpo de respuesta.',
      '',
      'Lo que se envió:',
      `x-sena-event-id: ${id}`,
      `x-sena-event-type: ${args.tipo}`,
      `x-sena-signature: ${firma}`,
      cuerpo,
    ].join('\n');
  },
};

const comprobarFirma = {
  definicion: {
    name: 'sena_verificar_firma',
    title: 'Comprobar la firma de un webhook',
    description: 'Dice si una cabecera X-Sena-Signature es válida para un cuerpo y un secreto, y si no, por qué '
      + '(formato, caducada o no coincide). Útil para depurar el código que verifica los webhooks.',
    inputSchema: {
      type: 'object',
      properties: {
        secreto: { type: 'string' },
        cuerpo: { type: 'string', description: 'El cuerpo EXACTO recibido, como texto, sin volver a formatear.' },
        cabecera: { type: 'string', description: 'Valor de X-Sena-Signature, p. ej. t=1727518503,v1=ab12…' },
      },
      required: ['secreto', 'cuerpo', 'cabecera'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ejecutar(args) {
    const secreto = texto(args.secreto, 'secreto');
    const cuerpo = texto(args.cuerpo, 'cuerpo');
    const cabecera = texto(args.cabecera, 'cabecera');
    if (verificar(secreto, cuerpo, cabecera)) return 'VÁLIDA: la firma corresponde a este cuerpo y este secreto, y tiene menos de 5 minutos.';
    const partes = Object.fromEntries(cabecera.split(',').map((p) => p.split('=')));
    const t = Number(partes.t);
    if (!Number.isFinite(t) || !partes.v1) return 'NO VÁLIDA: la cabecera no tiene el formato t=<segundos>,v1=<firma>.';
    const esperado = crypto.createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex');
    const edad = Math.floor(Date.now() / 1000) - t;
    if (esperado === partes.v1) return `NO VÁLIDA: la firma cuadra, pero tiene ${edad} s y el máximo son 300. Un receptor bien hecho la rechaza (protege de reenvíos).`;
    return [
      'NO VÁLIDA: la firma no corresponde a este cuerpo con este secreto.',
      `Esperada: v1=${esperado}`,
      'Causas habituales: el cuerpo se volvió a escribir tras leerlo como JSON (cambian espacios u orden), '
        + 'se firmó sin el prefijo "<t>." o el secreto no es el de este webhook.',
    ].join('\n');
  },
};

export const HERRAMIENTAS = [documentacion, plantilla, probar, simular, comprobarFirma];

export const INSTRUCCIONES = [
  'Herramientas para desarrollar sobre Sena Fleet, la plataforma de gestión de flotas de robots.',
  'Antes de escribir código, lee la documentación con sena_documentacion: no supongas rutas, estados ni formatos.',
  'Conector de una marca nueva: sena_plantilla_conector → implementar → sena_probar_conector hasta que salga en verde.',
  'App que usa la plataforma: temas "api-v1" y "webhooks"; prueba el receptor con sena_simular_webhook con las tres firmas (correcta, incorrecta y caducada).',
  'sena_probar_conector con escritura=true mueve un robot real: solo si el usuario lo pide.',
].join('\n');
