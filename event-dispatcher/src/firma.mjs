// SENA FLEET — event-dispatcher · firma de los webhooks
// -----------------------------------------------------------------------------
// Cabecera `X-Sena-Signature: t=<unix>,v1=<hex>` con
//   v1 = HMAC-SHA256(secreto, `${t}.${cuerpo}`)
//
// El mismo esquema que Stripe, a propósito: quien integre ya lo conoce, y hay
// ejemplos para verificarlo en cualquier lenguaje (docs/webhooks.md).
//
// Por qué la marca de tiempo DENTRO de lo firmado: sin ella, quien capture una
// entrega podría reenviarla mañana y seguiría siendo válida. Con ella, el
// receptor rechaza lo que tenga más de 5 minutos.
// -----------------------------------------------------------------------------
import crypto from 'node:crypto';

/** Firma un cuerpo. `ahoraS` entra como parámetro para poder probarlo. */
export function firmar(secreto, cuerpo, ahoraS = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secreto).update(`${ahoraS}.${cuerpo}`).digest('hex');
  return `t=${ahoraS},v1=${v1}`;
}

/**
 * Verifica una firma: lo que hace el RECEPTOR. Vive aquí para que los tests
 * comprueben que lo que firmamos se puede verificar tal y como lo documentamos.
 */
export function verificar(secreto, cuerpo, cabecera, { toleranciaS = 300, ahoraS = Math.floor(Date.now() / 1000) } = {}) {
  const partes = Object.fromEntries(String(cabecera ?? '').split(',').map((p) => p.split('=')));
  const t = Number(partes.t);
  if (!Number.isFinite(t) || !partes.v1) return false;
  if (Math.abs(ahoraS - t) > toleranciaS) return false;
  const esperado = crypto.createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex');
  const a = Buffer.from(esperado);
  const b = Buffer.from(String(partes.v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
