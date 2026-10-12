# Webhooks: avisos de tu flota en tu sistema

Sena Fleet puede avisar a tu sistema (un PMS, un panel propio, una
automatización) cada vez que pasa algo en tu flota, sin que tengas que
preguntar. Se configuran en **Configuración → API → Webhooks**.

## Qué eventos hay

| Evento | Cuándo llega |
|---|---|
| `mission.created` | Se crea una misión, desde la plataforma o desde el propio robot |
| `mission.status_changed` | Una misión cambia de estado: llegada, vuelta, completada, fallida… |
| `incident.opened` | Se abre una incidencia en un robot o ascensor |
| `incident.resolved` | Una incidencia se da por resuelta |
| `incident.dismissed` | Una incidencia se descarta |
| `webhook.test` | Solo cuando pulsas **Enviar prueba** |

Puedes suscribirte a los que quieras, o a **todos**. Si eres distribuidor,
recibes también los eventos de los robots que has vendido.

## Qué recibes

Una petición `POST` a tu URL, con un cuerpo JSON como este:

```json
{
  "id": "5b0c1f2e-8a3d-4c7e-9f1a-2d6b8e4c0a91",
  "type": "mission.status_changed",
  "created_at": "2026-09-28T10:15:03.412Z",
  "data": {
    "mission_id": "c7a4…",
    "robot_sn": "ROB-0001",
    "from": "sent",
    "to": "arrived",
    "point_id": "12",
    "arrived_at": "2026-09-28T10:15:03.000Z",
    "route": null
  }
}
```

### Paradas de una ruta

Si un robot está recorriendo una **ruta guardada** (Modo Trabajo → Rutas), cada
punto de cada vuelta es una misión y te llegan sus avisos como los de cualquier
otra. Para que no las cuentes como entregas, esas misiones traen `route` relleno:

```json
"route": { "route_id": "3f1c…", "lap": 2 }
```

- `route_id`: la ruta que se está recorriendo.
- `lap`: la vuelta en curso (1, 2, 3…). Una ruta sin fin sigue sumando.

En cualquier otra misión, `route` es `null`. Si solo te interesan las entregas,
**ignora los avisos con `route` distinto de `null`**: con una ruta sin fin llegan
muchos a lo largo del día.

Y estas cabeceras:

| Cabecera | Qué es |
|---|---|
| `X-Sena-Event-Id` | El `id` del evento (el mismo que en el cuerpo) |
| `X-Sena-Event-Type` | El tipo de evento |
| `X-Sena-Signature` | La firma: `t=<segundos>,v1=<firma>` |

Los eventos llevan solo identificadores y estados: **nunca datos personales**.

## Comprobar que viene de nosotros (la firma)

Al crear el webhook te damos un **secreto** (`whsec_…`). Con él, calculas:

```
firma = HMAC-SHA256(secreto, "<t>.<cuerpo tal cual lo recibiste>")
```

y la comparas con `v1`. Rechaza también los avisos cuyo `t` tenga más de
**5 minutos**: así, un aviso capturado no se puede reenviar después.

⚠️ Usa el cuerpo **tal cual llega**, antes de convertirlo a JSON. Si lo conviertes
y lo vuelves a escribir, cambian los espacios y la firma no coincide.

**Node.js:**

```js
import crypto from 'node:crypto';

function avisoValido(secreto, cuerpoCrudo, cabecera) {
  const partes = Object.fromEntries(cabecera.split(',').map((p) => p.split('=')));
  const t = Number(partes.t);
  if (Math.abs(Date.now() / 1000 - t) > 300) return false;
  const esperado = crypto.createHmac('sha256', secreto).update(`${t}.${cuerpoCrudo}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(partes.v1 ?? ''));
}
```

**Python:**

```python
import hmac, hashlib, time

def aviso_valido(secreto: str, cuerpo_crudo: bytes, cabecera: str) -> bool:
    partes = dict(p.split("=", 1) for p in cabecera.split(","))
    t = int(partes["t"])
    if abs(time.time() - t) > 300:
        return False
    esperado = hmac.new(secreto.encode(), f"{t}.".encode() + cuerpo_crudo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, partes.get("v1", ""))
```

## Cómo responder

- Responde con **2xx** (por ejemplo `200` o `204`) en **menos de 10 segundos**.
  Si tienes que hacer algo lento, responde primero y procésalo después.
- **No seguimos redirecciones**: una `301` o `302` cuenta como fallo.

## Reintentos, y por qué puede llegarte un aviso dos veces

Si tu sistema no responde con 2xx, reintentamos con esperas crecientes: a los
30 s, 2 min, 10 min, 30 min, 2 h, 6 h, 12 h y 24 h. Después del último, la
entrega queda como **fallida** en el historial.

Como reintentamos, **un mismo aviso puede llegarte más de una vez**. Guarda el
`id` de los que ya procesaste y descarta los repetidos.

Si un webhook falla **50 veces seguidas**, lo pausamos para no seguir llamando a
un sistema caído, y lo verás como **Pausado** con el motivo. Cuando lo arregles,
pulsa **Reanudar**.

## Probar

El botón **Enviar prueba** manda un `webhook.test` solo a ese webhook, por el
mismo camino que uno real. Si la prueba llega y la firma cuadra, lo demás
llegará igual. En **Historial** ves cada entrega: si llegó, cuántos intentos
llevó y qué respondió tu sistema.
