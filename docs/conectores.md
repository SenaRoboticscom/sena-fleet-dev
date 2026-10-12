# Escribir un conector de marca para SENA Fleet

Guía para quien quiera conectar a la plataforma los robots de una marca que SENA
aún no soporta. Al terminar, los robots de esa marca aparecen en el panel con su
estado, reciben misiones y funcionan por la API pública (`/v1`) y los webhooks,
**sin que SENA tenga que escribir código de tu marca**.

> Contrato de referencia: `docs/contrato-conector.md` (autenticación, rutas,
> estados, capacidades, modelos JSON y errores).

---

## 1. Cómo encaja

```
  Panel / API /v1 / webhooks de SENA Fleet
            │
     SENA Fleet  ── habla el contrato por HTTP, con Bearer
            │
            ▼
     TU CONECTOR ── traduce el contrato a la API de tu marca
            │
            ▼
     nube del fabricante ── robots
```

La plataforma no sabe nada de tu marca. Le pregunta a tu conector **en el idioma
del contrato** y tu conector traduce. Todo lo que la plataforma construye encima
sale gratis en cuanto el conector cumple el contrato:
- estado en vivo;
- misiones;
- `/v1` y los webhooks `mission.*`;
- salud de la marca.

### Dónde se aloja

**Los conectores se alojan en la infraestructura de SENA**, nunca en un servidor
tuyo. El motivo: por cada llamada viajan las credenciales de marca de los clientes
(cabecera `X-Adapter-Context`). Si el conector viviera fuera, esas credenciales
saldrían de SENA.

Tú entregas el código (o la imagen) y nosotros lo desplegamos, aislado. Para
desarrollarlo y probarlo no necesitas la plataforma: lo arrancas en tu equipo y lo
compruebas con el comprobador de esta guía.

---

## 2. Lo que tiene que hacer tu conector

Un servidor HTTP con estas rutas (detalle en `docs/contrato-conector.md`):

| Ruta | Qué devuelve |
|---|---|
| `GET /health` | `{ ok: true, version }`, **sin token** |
| `GET /capabilities` | `{ capabilities: [...] }` — solo nombres del contrato |
| `GET /robots` | `{ robots: [{ robotId, name, model, online }] }` (descubrimiento) |
| `GET /robots/:id/status` | `RobotStatus`: `state` del contrato, `online` booleano, `battery`, `currentMission` |
| `GET /robots/:id/location` | posición, o `{ supported: false }` |
| `GET /robots/:id/points` | `{ points: [{ pointId, name, type }] }` |
| `POST /robots/:id/missions` | `{ taskId, accepted }` |
| `POST /robots/:id/missions/control` | `{ op: pause\|resume\|cancel }` → `{ ok: true }` |
| `POST /robots/:id/return-to-charge` | `{ mode, taskId }` |

Reglas que la plataforma hace cumplir (y que conviene no discutir):

- **Autenticación:** toda ruta salvo `/health` exige `Authorization: Bearer <token>`.
  Sin él, `401` con `{ error: { code: 'auth_failed' } }`.
- **Credenciales del cliente:** llegan en `X-Adapter-Context` (JSON en base64url,
  `{ credentials, metadata }`). Úsalas para hablar con la nube de la marca y
  **no las escribas nunca en el log**.
- **Estados:** solo los del contrato (`idle`, `moving`, `charging`, `paused`,
  `waiting_elevator`, `error`, `offline`, `unknown`). Uno inventado lo convierte la
  plataforma en `unknown`: tu robot aparecerá como "desconocido".
- **`online`:** booleano de verdad. `"yes"` o `1` cuentan como desconectado.
- **Capacidades:** declara solo lo que funciona. El panel enseña los botones
  según esta lista; una capacidad que no es del contrato se ignora.
- **Errores:** `{ error: { code, message } }` con un código del catálogo
  (`robot_not_found`, `robot_offline`, `robot_busy`, `point_not_found`,
  `op_unsupported`...). La plataforma los traduce a mensajes para el usuario; un
  código que no es del catálogo cuenta como `upstream_error`.
- **Sin estado propio ni base de datos.** Si necesitas memoria, pídesela a la
  nube de la marca. Así se puede reiniciar o mover sin perder nada.
- **Rápido y sin redirecciones:** la plataforma espera como mucho 20 s por
  respuesta y no sigue redirecciones.
- **Misiones:** el `taskId` que devuelvas tiene que aparecer en
  `currentMission.taskId` mientras dure. La plataforma da la misión por **en
  curso** cuando lo ve y por **completada** cuando deja de verlo.

### Cómo tiene que ser tu imagen (la plataforma la arranca capada)

- **Puerto:** escucha en el de `PORT`, **4010** por defecto, que es el que espera la plataforma.
- **Usuario:** arranca como **nobody** (65534), diga lo que diga el `USER` de tu
  Dockerfile. Tus ficheros tienen que ser legibles por cualquiera.
- **Disco de solo lectura:** solo puedes escribir en `/tmp` (64 MB, sin ejecutar nada de ahí).
- **Recursos:** sin capacidades de Linux, 256 MB de RAM, media CPU y 128 procesos.
- **Aislamiento:** corre con **gVisor**, así que nada de trucos de núcleo.
- **Red:** salida a internet **solo por 443**. Nada hacia redes internas.
- **Variables que recibe:** `CONNECTOR_TOKEN` (lo genera la plataforma), `PORT` y
  `NODE_ENV=production`, más las que acordemos. Nunca recibirá claves de la plataforma.

---

## 3. Empezar: la plantilla

`connector-demo/` es un conector completo con tres robots simulados, sin
dependencias (`node:http`). Cópialo y sustituye la parte marcada
**"AQUÍ HABLARÍA CON LA NUBE DE LA MARCA"** por llamadas a tu fabricante.

```bash
cd connector-demo
CONNECTOR_TOKEN=un-token-largo DEMO_TRAVEL_S=8 node src/server.mjs
```

Variables:
- `PORT` (4010);
- `CONNECTOR_TOKEN`: obligatorio con `NODE_ENV=production`; sin él no arranca, para
  no quedar abierto.

## 4. Comprobar que cumple el contrato

```bash
node tools/probar-conector.mjs --url http://localhost:4010 --token un-token-largo
node tools/probar-conector.mjs --url … --token … --credentials '{"apiKey":"…"}'
node tools/probar-conector.mjs --url … --token … --escritura
```

Sin `--escritura` solo lee. **Con `--escritura` manda una misión real al primer
robot en línea y la cancela**: contra una marca de verdad, mueve un robot.

Pasar el comprobador en verde es el requisito para pedir el alta.

Si trabajas con un agente de IA (Claude Code, Cursor…), instálale el MCP de
`mcp-dev/`: lee esta documentación, te da la plantilla y pasa el comprobador por ti.

## 5. Pedir el alta

Cuando el comprobador sale en verde:

1. Pásalo también con **una cuenta real de la marca** (`--credentials`) y, si
   puedes, con `--escritura` contra un robot de pruebas.
2. Mándanos:
   - el código o la imagen del conector;
   - la salida del comprobador;
   - las capacidades que declara;
   - qué credenciales necesita de cada cliente (los campos de `credentials`).
3. Lo desplegamos aislado y lo probamos con un robot real de la marca antes de
   abrirlo a clientes.

## 6. Lo que aún no funciona con una marca por conector

- **Modo Trabajo** (la pantalla del camarero) todavía es por marca: una marca
  por conector no se puede usar desde ahí. Las misiones van por la API `/v1`.
- Sin mapa en vivo ni ascensores: el contrato genérico no los cubre todavía.
- La **certificación** y el **entorno de pruebas** para desarrolladores llegarán más adelante.
