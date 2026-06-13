# Chunky Snkrs — web

Catálogo + checkout con MercadoPago, reservas, encargos, rastreo de pedidos, minijuego/ruleta y panel de administración. Reemplaza el Shopify.

- **Frontend:** HTML/CSS/JS estático (sin build).
- **Backend:** Vercel Functions (Node.js, en `/api`).
- **Base de datos:** Supabase (Postgres).
- **Pagos:** MercadoPago Checkout Pro.
- **Mails:** Nodemailer + Gmail App Password.

---

## Estado por fases

| Fase | Qué incluye | Estado |
|------|-------------|--------|
| **1 — MVP** | Catálogo desde DB, checkout MP + webhook, rastreo de pedido, admin de pedidos | ✅ listo |
| **2** | Reservas con vencimiento (cron), encargos al backend, gestión de stock | ✅ listo |
| **3** | Reseñas automatizadas por mail (cron) + sección en la landing | ✅ backend y mails listos · falta UI del minijuego |
| **3 — minijuego** | Plataformero pixel-art + ranking mensual + validación server-side | 🔜 placeholder |
| **4 — ruleta** | Canje de puntos por premios | 🔜 placeholder |

> El catálogo funciona **aunque la base no esté configurada**: si `/api/productos` no devuelve nada, muestra los productos actuales hardcodeados como fallback (con botón "consultar" a Instagram). Apenas cargás Supabase + MercadoPago, pasan a comprarse/reservarse online.

---

## Estructura

```
/                     catálogo (index.html)
/encargos             formulario de encargos
/pedido  /pedido/:cod rastreo de pedido
/resena               página de reseña (link del mail)
/minijuego /ruleta    placeholders (fases 3-4)
/admin                panel (login real)
/assets/base.css      estilos compartidos
/assets/chrome.js     fondo, grano, nav, footer, helpers
/api/*                Vercel Functions
/lib/*                supabase, mercadopago, mail, auth, util, http
/db/schema.sql        esquema completo de la base
```

---

## Setup paso a paso

### 1. Supabase
1. Crear proyecto en [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → pegar y correr todo `db/schema.sql`.
3. **Project Settings → API** → copiar `Project URL`, `anon key` y `service_role key`.

### 2. MercadoPago (Uruguay)
1. [MercadoPago Developers](https://www.mercadopago.com.uy/developers) → crear aplicación de **Checkout Pro**.
2. Copiar **Access Token** y **Public Key** (credenciales de producción usan prefijo `APP_USR-`).
3. **Webhooks** → configurar la URL `https://TU-DOMINIO/api/webhook`, evento **Pagos**.
4. Copiar el **secreto de firma** del webhook → va en `MP_WEBHOOK_SECRET` (con esto se valida que la notificación sea real).

### 3. Gmail (mails automáticos)
1. Cuenta de Google → **Seguridad** → activar verificación en 2 pasos.
2. **Contraseñas de aplicación** → generar una para "Correo" → va en `GMAIL_APP_PASSWORD`.

### 4. Variables de entorno
Copiá `.env.example` a `.env` y completá todo. En Vercel, las mismas variables van en **Project → Settings → Environment Variables**. Generá secretos largos al azar para `ADMIN_SESSION_SECRET` y `CRON_SECRET`.

### 5. Deploy en Vercel
1. Importar el repo en [vercel.com](https://vercel.com) (framework: **Other**).
2. Cargar las variables de entorno.
3. Deploy. El dominio propio se configura en **Settings → Domains** (apuntá el DNS a Vercel).

> El archivo `CNAME` es de GitHub Pages. Al pasar a Vercel, el dominio se gestiona desde el panel de Vercel; podés dejar o borrar `CNAME`, lo que manda es a dónde apunta el DNS.

---

## Crons

Definidos en `vercel.json`:
- `liberar-reservas` — cada hora: vence reservas de +24hs y manda recordatorios (10h/20h).
- `resenas` — 1 vez al día: pide reseñas a pedidos enviados.

⚠️ En el **plan Hobby de Vercel los crons corren como máximo 1 vez por día**. Para que `liberar-reservas` corra cada hora necesitás plan Pro **o** un pinger externo gratis (ej. [cron-job.org](https://cron-job.org)) que pegue a:

```
https://TU-DOMINIO/api/cron/liberar-reservas?secret=TU_CRON_SECRET
```

Los endpoints `/api/cron/*` están protegidos: solo responden con el `CRON_SECRET` (por header `Authorization: Bearer` que manda Vercel, o por `?secret=`).

---

## Admin

Entrá a `https://TU-DOMINIO/admin` y logueate con `ADMIN_USER` / `ADMIN_PASSWORD`.

La sesión es una cookie firmada (HMAC, vence a las 12h). La URL no es secreta: **lo que protege es el login**. Si querés además una URL no obvia, renombrá la carpeta `admin/` (ej. `panel-xk9wq/`) y entrá por ahí.

Desde el panel: ver pedidos y cambiar estado de envío, alta/edición/stock de productos, ver encargos, aprobar/rechazar reseñas.

---

## Reglas de negocio (implementadas)

- **El pago solo se confirma por webhook de MercadoPago.** El redirect del cliente nunca marca "pagado"; solo muestra el estado.
- **Stock:** se descuenta al confirmarse el pago (función atómica `descontar_stock`). En 0 → se muestra "agotado", no se oculta.
- **Reservas:** bloquean el producto 24hs para un mail; vencidas devuelven el stock (cron).
- **Reseñas:** entran como `pendiente`; recién se muestran en la landing cuando las aprobás.
- **Webhook idempotente:** si MP reintenta, no descuenta stock dos veces.

---

## Pendiente (próximos turnos)

- Minijuego pixel-art jugable + `/api/minijuego/guardar-puntaje` con validación server-side.
- Ranking mensual (`puntajes_mensuales`) y su vista en `/minijuego`.
- Ruleta jugable + `/api/ruleta/girar` con pesos y stock mensual de premios.
- Vistas de admin para ranking y premios de ruleta.
