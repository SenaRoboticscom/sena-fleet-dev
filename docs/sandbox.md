# Entorno de pruebas (sandbox)

Para probar tu app o tu conector contra SENA Fleet **sin tocar robots de verdad**.
Es la misma plataforma, con su API y sus webhooks, pero aparte de los clientes
reales y con robots simulados.

## Qué te damos

- **Tu propio cliente** en el entorno de pruebas, con tu usuario. Entras al panel
  en https://pruebas.senarobotics.cloud.
- **Tres robots simulados, solo tuyos:** `<TUCUENTA>-001`, `-002` y `-003`.
  - El 001 y el 002 están en línea; el 003, **desconectado a propósito**, para que
    veas cómo se comporta la plataforma con un robot caído.
  - Una misión tarda unos 20 segundos: el robot pasa a `moving` y, al llegar, a `idle`.
  - Sus puntos: `base` (la base de carga), `recepcion` y `mesa-1` a `mesa-5`.
- **La API** en https://pruebas-api.senarobotics.cloud. Es la misma API de
  `docs/api-v1.md`; solo cambia la dirección.

## Pedir acceso

Escribe a **desarrolladores@senarobotics.com** con el nombre de tu empresa y el
correo de quien va a entrar. Te mandamos un código de activación por un canal
privado.

## Empezar

1. **Activa tu usuario** con el código en https://pruebas.senarobotics.cloud/activate.
2. **Crea una clave de API** en **Configuración → API**. Para probarlo todo, marca
   los cuatro permisos: ver robots, ver misiones, mandar robots y cancelar sus
   misiones (ver `docs/api-v1.md`). Si quieres recibir avisos, crea también un
   webhook (ver `docs/webhooks.md`):
   - tiene que ser una dirección pública, con `https`;
   - el entorno de pruebas no envía a direcciones privadas ni a `localhost`.
3. **Mira tus robots:**

   ```bash
   curl -H "x-api-key: TU_CLAVE" https://pruebas-api.senarobotics.cloud/v1/robots
   ```

4. **Manda uno a una mesa:**

   ```bash
   curl -X POST https://pruebas-api.senarobotics.cloud/v1/missions \
     -H "x-api-key: TU_CLAVE" -H "content-type: application/json" \
     -H "Idempotency-Key: $(uuidgen)" \
     -d '{"robot_sn":"TUCUENTA-001","point_id":"mesa-3"}'
   ```

5. **Cancélala si quieres:** `POST /v1/missions/<id>/cancel`, con el `id` que te
   devolvió el paso anterior.
6. **Mira llegar los avisos** `mission.created` y `mission.status_changed` a tu
   webhook. Para el `-003` recibirás un error: está desconectado.

## Ten en cuenta

- **No es un servicio garantizado:** puede estar apagado a ratos, y sus datos se
  pueden borrar cuando haga falta rehacerlo.
- **Pruebas y producción no se mezclan:** las claves y los webhooks de pruebas no
  valen en producción, y al revés.
- **Modo Trabajo** (la pantalla del camarero) no funciona con estos robots. Todo lo
  demás va por la API.
- **Si escribes un conector,** pruébalo primero en tu equipo con
  `tools/probar-conector.mjs` (ver `docs/conectores.md`). Los conectores de
  terceros no se despliegan en el entorno de pruebas: se despliegan aislados, al
  darles el alta.
