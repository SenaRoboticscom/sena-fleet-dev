# API pública v1: consultar la flota y mandar misiones

Para quien integre su sistema con Sena Fleet (un PMS, un panel propio, una
automatización). Con la API **preguntas** a la plataforma; para que ella te
**avise** cuando pasa algo, usa los webhooks (`docs/webhooks.md`).

> Es la primera versión de la API. Lo que hay aquí es estable; lo que llegue
> (permisos más finos, instalaciones por cliente) se añadirá sin romperlo.

## Lo básico

- **Dirección:** `https://platform.senarobotics.cloud`
- **Clave:** se crea en **Configuración → API**. Va en cada petición, en una de
  estas dos cabeceras:

  ```
  x-api-key: sk_live_…
  Authorization: Bearer sk_live_…
  ```

  La clave es como una contraseña: nunca en el código del navegador ni en un
  repositorio.
- **Qué ves:** con una clave de **cliente**, sus robots. Con una de
  **distribuidor**, los suyos y los que ha vendido. Lo mismo que en el panel.
- **Permisos de la clave:** `read` para consultar (GET) y `write` para mandar
  misiones (POST).
- **Límite:** 120 peticiones por minuto y clave. Si lo pasas, `429` con la cabecera
  `Retry-After` (segundos que hay que esperar).

## GET /v1/robots

Los robots activos y su estado en vivo.

```json
{
  "ok": true,
  "robots": [
    {
      "robot_sn": "ROB-0001",
      "alias": "Camarero 1",
      "store_id": "…",
      "model": "T8",
      "brand": "keenon",
      "online": true,
      "battery_level": 82,
      "state": "idle",
      "work_state": "…",
      "nearby_point": "…",
      "last_event_at": "2026-09-28T10:15:03.000Z"
    }
  ]
}
```

- **`state`** es el estado común a todas las marcas: `idle`, `moving`, `charging`,
  `paused`, `waiting_elevator`, `error`, `offline` o `unknown`. **Usa este.**
- `work_state` es el estado tal como lo da la marca: cambia de una marca a otra.
- `online` es `false` si el robot lleva más de 10 minutos sin dar señales.

## GET /v1/missions

Las misiones más recientes, de la más nueva a la más antigua. Filtros opcionales
en la URL: `status`, `robot_sn` y `limit` (50 por defecto, 200 como máximo).

```json
{
  "ok": true,
  "missions": [
    {
      "id": "c7a4…",
      "robot_sn": "ROB-0001",
      "task_no": "…",
      "point_id": "12",
      "status": "arrived",
      "point_name": "Mesa 12",
      "created_at": "…",
      "arrived_at": "…",
      "returned_at": null
    }
  ]
}
```

## POST /v1/missions

⚠️ **Mueve un robot de verdad.**

Manda un robot a un punto de su mapa:

```json
{ "robot_sn": "ROB-0001", "point_id": "12", "point_name": "Mesa 12" }
```

- `point_id` o `point_uuid`: uno de los dos es obligatorio. `point_name` es opcional.
- **Manda siempre la cabecera `Idempotency-Key`** con un valor único por misión
  (por ejemplo, un UUID). Si la red falla y reintentas con la misma clave, el
  robot no sale dos veces: recibes la respuesta del primer envío.

Respuesta `201`:

```json
{ "ok": true, "mission": { "id": "…", "robot_sn": "…", "task_no": "…", "point_id": "12", "status": "sent", "created_at": "…" } }
```

La misión empieza en `sent`. Para saber cuándo llega, no preguntes cada pocos
segundos: suscríbete a `mission.status_changed` (`docs/webhooks.md`).

Hoy se pueden mandar misiones por API a robots **Keenon** y a los de marcas
conectadas por **conector**. Para el resto, `422` con `op_unsupported_via_api`.

## Errores

Siempre `{ "ok": false, "error": "<código>" }`, a veces con `detail`:

| HTTP | `error` | Qué pasa |
|---|---|---|
| 401 | `missing_api_key`, `invalid_api_key` | Falta la clave, o no existe o está revocada |
| 403 | `insufficient_scope` | La clave no tiene el permiso (`required` dice cuál) |
| 429 | `rate_limited` | Demasiadas peticiones: espera `retry_after` segundos |
| 400 | `missing_robot_sn`, `missing_point` | Falta un dato en el cuerpo |
| 404 | `robot_not_found` | El robot no existe **o no es tuyo**: no se distingue a propósito |
| 422 | `op_unsupported_via_api` | Esa marca aún no admite misiones por API |
| 422 | `send_failed` | La marca rechazó la orden. `code` dice por qué (tabla de abajo) |

Los `code` de `send_failed` más habituales:

| `code` | ¿Reintentar? |
|---|---|
| `robot_offline`, `robot_busy` | Sí, más tarde |
| `upstream_timeout`, `upstream_error`, `rate_limited` | Sí, con espera y la **misma** `Idempotency-Key` |
| `point_not_found`, `invalid_request` | No: corrige la petición |
| `op_unsupported`, `auth_failed` | No: avisa al administrador de la cuenta |
