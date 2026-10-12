# SENA Fleet · kit para desarrolladores

Todo lo necesario para construir sobre **SENA Fleet**, la plataforma de gestión de
flotas de robots de SENA Robotics:

- **Conectores de marca:** conectar a SENA Fleet los robots de un fabricante que
  todavía no soporta.
- **Apps e integraciones:** consultar la flota y mandar misiones con la API
  pública, y recibir en tu sistema los avisos (webhooks) de lo que pasa. Por
  ejemplo, para un PMS, un panel propio o una automatización.

## Qué hay aquí

| | |
|---|---|
| [`docs/conectores.md`](docs/conectores.md) | Guía: escribir un conector, de cero a pedir el alta |
| [`docs/contrato-conector.md`](docs/contrato-conector.md) | El contrato que cumple un conector: autenticación, rutas, estados, modelos y errores |
| [`docs/api-v1.md`](docs/api-v1.md) | API pública v1: consultar la flota y mandar misiones |
| [`docs/webhooks.md`](docs/webhooks.md) | Webhooks: eventos, firma y reintentos |
| [`connector-demo/`](connector-demo/) | Plantilla: un conector completo con tres robots simulados |
| [`tools/probar-conector.mjs`](tools/probar-conector.mjs) | Comprobador del contrato: pásalo en verde antes de pedir el alta |
| [`mcp-dev/`](mcp-dev/README.md) | MCP para que tu agente de IA (Claude Code, Cursor…) lea todo esto y pruebe tu trabajo |
| [`adapters/contract.mjs`](adapters/contract.mjs) | El vocabulario del contrato, en código |
| [`event-dispatcher/src/firma.mjs`](event-dispatcher/src/firma.mjs) | Cómo firma SENA Fleet los webhooks, y cómo verificarlo |

## Empezar

Solo necesitas **Node 20 o superior**: nada de esto tiene dependencias.

**Un conector**, con la plantilla y el comprobador:

```bash
git clone https://github.com/SenaRoboticscom/sena-fleet-dev.git
cd sena-fleet-dev
CONNECTOR_TOKEN=un-token-de-24-caracteres-o-mas node connector-demo/src/server.mjs
# y en otro terminal:
node tools/probar-conector.mjs --url http://localhost:4010 --token un-token-de-24-caracteres-o-mas
```

En Windows (PowerShell), la variable se pone antes:
`$env:CONNECTOR_TOKEN='un-token-de-24-caracteres-o-mas'; node connector-demo/src/server.mjs`.

**Con tu agente de IA**, instala el MCP y pídele lo que quieras construir:

```bash
claude mcp add sena-dev -- node /ruta/a/sena-fleet-dev/mcp-dev/src/server.mjs
```

Más clientes y ejemplos de uso en [`mcp-dev/README.md`](mcp-dev/README.md).

## Pedir el alta de un conector

Cuando el comprobador sale en verde, sigue [`docs/conectores.md` §5](docs/conectores.md#5-pedir-el-alta).
Los conectores se alojan en la infraestructura de SENA, aislados: tú entregas el
código y nosotros lo desplegamos.

## Licencia

MIT: puedes copiar y adaptar la plantilla y el resto del kit. Ver [`LICENSE`](LICENSE).
