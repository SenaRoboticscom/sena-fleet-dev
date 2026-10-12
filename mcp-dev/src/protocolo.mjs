// SENA FLEET — MCP de desarrollo · el protocolo (JSON-RPC 2.0 por stdio)
// -----------------------------------------------------------------------------
// Lo mínimo de MCP para un servidor local de herramientas y documentos: un
// mensaje JSON por línea en stdin, la respuesta por stdout. Sin dependencias,
// como connector-demo: se lee entero y no arrastra paquetes de terceros al
// equipo de quien lo usa.
//
// REGLA: por stdout solo salen mensajes del protocolo. Cualquier traza va a
// stderr; un console.log suelto rompería la conexión con el cliente.
// -----------------------------------------------------------------------------
import readline from 'node:readline';

// La primera es la que proponemos si el cliente pide una que no conocemos. Lo
// que usamos (herramientas y recursos de texto) es igual en todas.
export const VERSIONES = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** Error del protocolo (va en `error`), no de la herramienta (que va en el resultado). */
export class ErrorRpc extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Error de uso de una herramienta: el agente lo lee y corrige la llamada. */
export class ErrorDeUso extends Error {}

/**
 * herramientas: [{ definicion: { name, description, inputSchema, ... }, ejecutar(args) → texto }]
 * recursos:     { listar() → [{ uri, name, ... }], leer(uri) → { mimeType, text } | null }
 */
export function crearServidor({ nombre, version, instrucciones, herramientas, recursos }) {
  const porNombre = new Map(herramientas.map((h) => [h.definicion.name, h]));

  const metodos = {
    initialize(params) {
      const pedida = params?.protocolVersion;
      return {
        protocolVersion: VERSIONES.includes(pedida) ? pedida : VERSIONES[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: nombre, version },
        instructions: instrucciones,
      };
    },
    ping: () => ({}),
    'tools/list': () => ({ tools: herramientas.map((h) => h.definicion) }),
    async 'tools/call'(params) {
      const h = porNombre.get(params?.name);
      if (!h) throw new ErrorRpc(-32602, `Herramienta desconocida: ${params?.name}`);
      try {
        const texto = await h.ejecutar(params.arguments ?? {});
        return { content: [{ type: 'text', text: texto }] };
      } catch (e) {
        // Un fallo de la herramienta se le cuenta al agente, no al cliente.
        return { content: [{ type: 'text', text: e instanceof ErrorDeUso ? e.message : `Error inesperado: ${e.message}` }], isError: true };
      }
    },
    'resources/list': () => ({ resources: recursos.listar() }),
    'resources/templates/list': () => ({ resourceTemplates: [] }),
    async 'resources/read'(params) {
      const r = await recursos.leer(params?.uri);
      if (!r) throw new ErrorRpc(-32002, `Recurso no encontrado: ${params?.uri}`);
      return { contents: [{ uri: params.uri, ...r }] };
    },
  };

  /** Un mensaje → su respuesta, o null si era una notificación. */
  async function atender(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return msg && 'id' in msg ? { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32600, message: 'Petición no válida' } } : null;
    }
    const esNotificacion = !('id' in msg);
    const fn = metodos[msg.method];
    if (esNotificacion) return null; // notifications/initialized, cancelled… nada que contestar
    if (!fn) return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Método no soportado: ${msg.method}` } };
    try {
      return { jsonrpc: '2.0', id: msg.id, result: await fn(msg.params) };
    } catch (e) {
      const code = e instanceof ErrorRpc ? e.code : -32603;
      return { jsonrpc: '2.0', id: msg.id, error: { code, message: e.message } };
    }
  }

  /** Una línea del cliente → lo que hay que escribir (o null). Admite lotes. */
  async function linea(texto) {
    let msg;
    try { msg = JSON.parse(texto); } catch {
      return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON no válido' } };
    }
    if (Array.isArray(msg)) {
      const r = (await Promise.all(msg.map(atender))).filter(Boolean);
      return r.length ? r : null;
    }
    return atender(msg);
  }

  return { atender, linea };
}

/** Conecta el servidor a stdin/stdout. Cada petición se atiende en paralelo. */
export function escucharStdio(servidor, { entrada = process.stdin, salida = process.stdout } = {}) {
  const rl = readline.createInterface({ input: entrada, crlfDelay: Infinity });
  rl.on('line', (l) => {
    if (!l.trim()) return;
    servidor.linea(l).then((r) => { if (r) salida.write(`${JSON.stringify(r)}\n`); })
      .catch((e) => console.error('[MCP] fallo atendiendo una petición:', e.message));
  });
  return rl;
}
