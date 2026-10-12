# sena-dev: el MCP para desarrollar sobre Sena Fleet

Un servidor MCP que se instala en el agente de IA del desarrollador (Claude Code,
Cursor, Claude Desktop…) para que construya **conectores de marca** y **apps**
sobre Sena Fleet sin inventarse la API. El agente lee la documentación oficial,
parte de la plantilla y comprueba su trabajo contra la plataforma de verdad.

## Qué herramientas da

| Herramienta | Para qué |
|---|---|
| `sena_documentacion` | Documentación oficial: `conectores`, `contrato`, `vocabulario` (estados, errores y capacidades en JSON), `api-v1` y `webhooks` |
| `sena_plantilla_conector` | Los ficheros de un conector completo con tres robots simulados, listo para adaptar a una marca |
| `sena_probar_conector` | Pasa el comprobador del contrato contra un conector y dice qué falla. Pasarlo en verde es el requisito para pedir el alta |
| `sena_simular_webhook` | Manda a la app un webhook idéntico a los de la plataforma, con firma correcta, incorrecta o caducada, y dice si el receptor se portó bien |
| `sena_verificar_firma` | Dice si una firma `X-Sena-Signature` es válida y, si no, por qué |

Los mismos documentos están también como recursos MCP (`sena://docs/<tema>`).

## Instalar

Necesita **Node 20 o superior** y una copia de este repositorio: el MCP lee la
documentación, el contrato y el comprobador de aquí mismo, así que nunca se
desfasa de la plataforma. En los ejemplos, cambia la ruta por la tuya.

**Claude Code:**

```bash
claude mcp add sena-dev -- node /ruta/a/sena-fleet/mcp-dev/src/server.mjs
```

**Cursor** (`.cursor/mcp.json`) y **Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sena-dev": {
      "command": "node",
      "args": ["/ruta/a/sena-fleet/mcp-dev/src/server.mjs"]
    }
  }
}
```

Para comprobar que funciona, pídele al agente: *"Con sena-dev, lee el contrato de
conectores y dime qué estados puede tener un robot"*.

## Cómo se usa

- **Conector de una marca nueva:** *"Quiero conectar los robots de la marca X a Sena
  Fleet. Parte de la plantilla de sena-dev, implementa la API de X y pasa el
  comprobador hasta que salga en verde."*
- **App que recibe avisos:** *"Hazme un endpoint que reciba los webhooks de Sena
  Fleet y verifique la firma. Pruébalo con sena-dev con las tres firmas."*

## Qué NO hace, a propósito

- **No habla con la plataforma ni tiene claves de ella.** Solo con el conector y la
  app del desarrollador, en su equipo.
- **`sena_probar_conector` solo lee**, salvo con `escritura: true`. En ese caso manda
  una misión real al primer robot en línea y la cancela: contra una marca de
  verdad, **mueve un robot**.

## Estado

Primera versión (octubre de 2026). Llegarán más adelante:
- herramientas del entorno de pruebas: robots simulados en la plataforma y fallos provocados a propósito;
- enviar un conector a certificación.

## Pruebas

```bash
cd mcp-dev && node --test
```

Arrancan el servidor como lo haría un cliente MCP, el conector de demostración y
un receptor de webhooks, y lo prueban todo de punta a punta.
