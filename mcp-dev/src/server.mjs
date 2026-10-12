#!/usr/bin/env node
/**
 * SENA FLEET — MCP de desarrollo ("sena-dev")
 * -----------------------------------------------------------------------------
 * Servidor MCP local (stdio) para que el agente de IA de un desarrollador
 * construya conectores y apps sobre Sena Fleet: documentación oficial, plantilla
 * de conector, comprobador del contrato y webhooks firmados de prueba.
 *
 * Corre en el equipo del desarrollador, lanzado por su cliente (Claude Code,
 * Cursor, Claude Desktop…). No escucha en ningún puerto, no tiene claves de la
 * plataforma y no le habla: solo a SU conector y a SU app. Instalación: README.md.
 * -----------------------------------------------------------------------------
 */
import { crearServidor, escucharStdio } from './protocolo.mjs';
import { HERRAMIENTAS, RECURSOS, INSTRUCCIONES } from './herramientas.mjs';

const VERSION = 'mcp-dev-2026.10.11';

escucharStdio(crearServidor({
  nombre: 'sena-dev',
  version: VERSION,
  instrucciones: INSTRUCCIONES,
  herramientas: HERRAMIENTAS,
  recursos: RECURSOS,
}));
console.error(`[sena-dev] MCP de desarrollo ${VERSION} listo (stdio)`);
