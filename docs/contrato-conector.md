# Contrato de conectores

Lo que tiene que cumplir un conector para que SENA Fleet maneje los robots de una
marca. La guía paso a paso está en `docs/conectores.md`; esto es la referencia.

- **El vocabulario en código** (estados, errores y capacidades): `adapters/contract.mjs`.
- **El comprobador automático:** `node tools/probar-conector.mjs`, o la herramienta
  `sena_probar_conector` del MCP (`mcp-dev/`).

---

## 1. Autenticación y contexto

- **Token:** toda ruta salvo `GET /health` exige
  `Authorization: Bearer <CONNECTOR_TOKEN>`. Sin él, o con otro, responde `401` con
  `{ "error": { "code": "auth_failed", "message": "…" } }`.
- **Credenciales del cliente:** las de la cuenta de marca de cada cliente llegan en
  **cada** petición, en la cabecera `X-Adapter-Context`. Es JSON en base64url:

  ```json
  { "credentials": { "…": "…" }, "metadata": { "…": "…" } }
  ```

  - Qué hay dentro de `credentials` lo decides tú: lo que necesite la API de tu
    marca. Al pedir el alta, dinos qué campos son.
  - **Nunca las escribas en el log.**
- **Sin estado propio:** lo que necesites te llega en la petición o se lo pides a
  la nube de la marca.
- **Tiempo:** la plataforma espera como mucho **20 s** por respuesta.
- **Sin redirecciones:** una respuesta `3xx` cuenta como error.

## 2. Rutas

`:id` es el `robotId` que devolviste en `GET /robots`, codificado para URL.

| Ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /health` | — | `{ "ok": true, "provider": "…", "version": "…", "checkedAt": "…" }`, **sin token** |
| `GET /capabilities` | — | `{ "capabilities": [ … ] }` (§4) |
| `GET /robots` | — | `{ "robots": [ Robot ] }` (§5.4): los robots de la cuenta del contexto |
| `GET /robots/:id/status` | — | `RobotStatus` (§5.1) |
| `GET /robots/:id/location` | — | `RobotLocation` (§5.2), o `{ "supported": false }` |
| `GET /robots/:id/points` | — | `{ "points": [ Point ] }` (§5.3) |
| `POST /robots/:id/missions` | `{ "pointId"?, "pointUuid"?, "pointName"? }` | `{ "taskId": "…", "accepted": true }` |
| `POST /robots/:id/missions/multi` | `{ "points": [ … ] }` | `{ "taskId": "…" }`. Solo si declaras `multi_point` |
| `POST /robots/:id/missions/control` | `{ "op": "pause" \| "resume" \| "cancel", "taskId"? }` | `{ "ok": true }` |
| `POST /robots/:id/return-to-charge` | — | `{ "mode": "charge_point" \| "return", "taskId"?: "…" }` |

Si tu marca no soporta una ruta, responde `501` con `op_unsupported` y no declares
su capacidad.

**Misiones:** el `taskId` que devuelves tiene que aparecer en
`currentMission.taskId` del estado mientras la misión dure. La plataforma la da por
**en curso** cuando lo ve y por **completada** cuando deja de verlo.

## 3. Estados

El `state` de un robot es siempre uno de estos. Uno que no esté en la lista se
trata como `unknown`.

| Estado | Significado | ¿Se le pueden mandar órdenes? |
|---|---|---|
| `idle` | Encendido, sin tarea, disponible | Sí |
| `moving` | Haciendo una tarea de movimiento (entrega **o** limpieza) | Sí |
| `charging` | En la base, cargando | Sí |
| `paused` | Tarea suspendida, a la espera de reanudar | Sí |
| `waiting_elevator` | Parado esperando o usando un ascensor | Sí |
| `error` | Fallo que requiere atención (atascado, parada de emergencia, hardware) | No |
| `offline` | Sin conexión o sin reportar | No |
| `unknown` | La marca dio algo que no encaja en ninguno | No |

El **tipo** de tarea (entrega o limpieza) no es un estado: va en `currentMission.kind`.

## 4. Capacidades

Declara en `GET /capabilities` solo lo que funciona de verdad. El panel enseña los
botones según esta lista, y una capacidad que no está aquí se ignora.

| Capacidad | Qué permite |
|---|---|
| `send_mission` | Mandar el robot a un punto |
| `multi_point` | Una misión con varios puntos seguidos |
| `control_mission` | Pausar, reanudar y cancelar |
| `return_to_charge` | Volver a cargar |
| `live_location` | Posición en el mapa |
| `list_points` | Lista de destinos |
| `discovery` | Listar los robots de la cuenta |
| `floor_change` | Cambiar de planta con ascensor. La plataforma aún no lo usa con conectores: no lo declares |

## 5. Modelos JSON

En todos, `raw` es opcional: el dato tal como lo da la marca, solo para diagnóstico.

### 5.1 `RobotStatus`

```json
{
  "robotId": "ROB-0001",
  "state": "moving",
  "online": true,
  "battery": 87,
  "charging": false,
  "currentMission": {
    "taskId": "T-1001",
    "kind": "delivery",
    "destination": "Mesa 4"
  },
  "errors": [{ "code": "stuck", "message": "…" }],
  "raw": {}
}
```

- `online`: un booleano de verdad. `"yes"` o `1` cuentan como desconectado.
- `battery`: porcentaje, o `null` si no se sabe.
- `currentMission`: `null` si no hay tarea. `kind` es `delivery`, `cleaning`,
  `return` u `other`.

### 5.2 `RobotLocation`

```json
{ "supported": true, "x": 12.3, "y": 4.5, "angle": 90, "floor": 2, "mapName": "Planta 2", "raw": {} }
```

### 5.3 `Point`

```json
{ "name": "Mesa 4", "pointId": "7", "pointUuid": null, "x": 12.3, "y": 4.5, "type": "table", "floor": 2, "raw": {} }
```

- Cada punto lleva `name` y al menos uno de `pointId` o `pointUuid`.
- `type` es, por ejemplo, `table`, `charge` u `other`.

### 5.4 `Robot` (descubrimiento)

```json
{ "robotId": "ROB-0001", "name": "Robot 1", "model": "MODELO-X", "online": true, "raw": {} }
```

## 6. Errores

Siempre así, con el HTTP de la tabla:

```json
{ "error": { "code": "robot_offline", "message": "ROB-0001 está desconectado" } }
```

| `code` | HTTP | Cuándo |
|---|---|---|
| `robot_not_found` | 404 | El robot no existe o no es de esta cuenta |
| `robot_offline` | 409 | Desconectado: ahora no se le puede llamar |
| `robot_busy` | 409 | Ocupado: ahora no acepta la orden |
| `point_not_found` | 404 | Ese destino no existe en el mapa del robot |
| `invalid_request` | 400 | Faltan datos o no son válidos |
| `op_unsupported` | 501 | La marca no permite esa operación |
| `op_pending` | 501 | La marca la permite, pero el conector aún no la hace |
| `auth_failed` | 502 | Las credenciales de la marca no valen (o, en `401`, el token del conector) |
| `upstream_error` | 502 | La API de la marca devolvió un error |
| `upstream_timeout` | 504 | La API de la marca no respondió a tiempo |
| `rate_limited` | 429 | La marca limita las peticiones |
| `internal_error` | 500 | Fallo inesperado del conector |

Un `code` que no esté en esta tabla se trata como `upstream_error`.
