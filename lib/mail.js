import nodemailer from 'nodemailer';

let _transport = null;
function transport() {
  if (_transport) return _transport;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('Faltan GMAIL_USER / GMAIL_APP_PASSWORD en el entorno.');
  _transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  return _transport;
}

// Envía un mail. Nunca lanza: si falla, loguea y devuelve false para no
// romper el flujo principal (ej. un pago confirmado igual se guarda).
export async function enviarMail({ to, subject, html, text }) {
  try {
    const from = `Chunky Snkrs <${process.env.GMAIL_USER}>`;
    await transport().sendMail({ from, to, subject, html, text: text || stripHtml(html) });
    return true;
  } catch (err) {
    console.error('[mail] error enviando a', to, '-', err.message);
    return false;
  }
}

export function avisarDueno({ subject, html }) {
  const owner = process.env.OWNER_EMAIL || process.env.GMAIL_USER;
  return enviarMail({ to: owner, subject, html });
}

function stripHtml(html = '') {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Plantilla de mail con la estética de la marca (fondo negro, rojo, mono).
export function plantilla({ titulo, cuerpoHtml, cta }) {
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  const botonCta = cta
    ? `<a href="${cta.url}" style="display:inline-block;margin-top:24px;padding:14px 28px;background:#cc0000;color:#f2f2f2;font-family:Arial,sans-serif;font-size:14px;letter-spacing:3px;text-transform:uppercase;text-decoration:none;font-weight:bold">${cta.texto}</a>`
    : '';
  return `
  <div style="background:#080808;padding:40px 20px;font-family:Arial,Helvetica,sans-serif;color:#e8e0d0">
    <div style="max-width:520px;margin:0 auto;border:1px solid #5a0e0e;background:#101010;padding:36px 30px">
      <div style="font-size:26px;font-weight:bold;letter-spacing:-1px;color:#f2f2f2;text-transform:uppercase">CHUNKY SNKRS</div>
      <div style="height:2px;background:#cc0000;width:60px;margin:14px 0 26px"></div>
      <div style="font-size:20px;color:#f2f2f2;text-transform:uppercase;letter-spacing:1px;margin-bottom:18px">${titulo}</div>
      <div style="font-size:15px;line-height:1.6;color:#cfc7b8">${cuerpoHtml}</div>
      ${botonCta}
      <div style="margin-top:34px;padding-top:18px;border-top:1px solid #2a2a2a;font-size:11px;color:#555;letter-spacing:2px;text-transform:uppercase">
        Streetwear Uruguay — <a href="${site}" style="color:#cc0000;text-decoration:none">chunkysnkrs.store</a>
      </div>
    </div>
  </div>`;
}
