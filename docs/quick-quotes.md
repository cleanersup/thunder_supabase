# Quick Quotes — contrato del backend

Un **quick quote** es un estimate residencial sin cliente y sin dirección de
servicio: el dueño cotiza en el momento y escribe el email o el teléfono del
destinatario solo al enviarlo. Todo lo demás (desglose de servicios, precios,
desglose interno de costos, borradores, share token, tracking de vistas, conversión
a job o a invoice) se comporta igual que un estimate residencial.

Piezas del backend:

| Pieza | Nombre |
|---|---|
| Tabla | `public.quick_quotes` |
| Email | `send-quick-quote-email` |
| SMS | `send-quick-quote-sms` |
| Aceptar (público) | `accept-quick-quote` (`GET ?id=`) |
| Tracking de vistas | `mark-viewed` (se agregó `type=quick_quote`) |
| Realtime | `supabase_realtime` publica `quick_quotes` (y `contracts`) |
| RPCs | `get_public_quick_quote`, `generate_quick_quote_share_token`, `get_quick_quote_job_prefill`, `finalize_quick_quote_to_job_conversion`, `get_quick_quote_invoice_prefill`, `finalize_quick_quote_to_invoice_conversion` |

---

## 1. Tabla `public.quick_quotes`

Solo `id`, `user_id`, `created_at` y `updated_at` son obligatorios — un quote
completamente vacío (`insert { }`) es válido y toma los valores por defecto.

| Columna | Tipo | Default | Notas |
|---|---|---|---|
| `id` | uuid | `gen_random_uuid()` | |
| `user_id` | uuid | `auth.uid()` | dueño; llave de RLS |
| `recipient_name` | text | – | lo escribe el dueño, no hay registro de cliente |
| `recipient_email` | text | – | se sobrescribe con el email realmente usado al enviar |
| `recipient_phone` | text | – | se sobrescribe con el teléfono realmente usado al enviar |
| `service_type` | text | `'residential'` | |
| `service_sub_type` | text | – | ej. `Deep Cleaning` |
| `service_scope` | text | – | texto libre, se convierte en `jobs.service_details` |
| `main_data` | jsonb | `{}` | `bedrooms`, `kitchens`, `livingRooms`, `diningRooms`, `offices`, `fullBaths`, `halfBaths`, `squareFootage` |
| `additional_data` | jsonb | `{}` | `fans`, `oven`, `refrigerator`, `blinds`, `windowsInside`, `windowsOutside` |
| `additional_items` | jsonb | `[]` | lista libre |
| `extra_services` | jsonb | `{}` | booleanos: `baseboard`, `patio`, `walls`, `stairs`, `cabinetInside`, `cabinetOutside`, `washDishes`, `hallways`, `basement` |
| `pets` / `laundry` | text | – | |
| `discount_type` | text | – | `percentage` \| `percent` \| `amount` |
| `discount_value` | numeric | – | |
| `subtotal`, `total` | numeric | `0` | |
| `labor_cost`, `supplies_cost`, `overhead_cost`, `total_operation_cost` | numeric | – | solo internos, nunca se envían al destinatario |
| `status` | text | `'Pending'` | ver abajo |
| `quote_date` | date | `CURRENT_DATE` | se convierte en `jobs.scheduled_date` al convertir |
| `is_draft` | boolean | `false` | |
| `current_step` | integer | `0` | paso del wizard |
| `draft_data` | jsonb | – | estado del wizard |
| `public_share_token` | text | automático | hex de 48 caracteres, se genera en el insert |
| `viewed_at` | timestamptz | – | lo marca el pixel de tracking / la lectura pública |
| `sent_at` | timestamptz | – | lo escriben las funciones de envío |
| `last_sent_channel` | text | – | `email` \| `sms` |
| `job_id` | uuid | – | lo setea el RPC de conversión a job |
| `invoice_id` | uuid | – | lo setea el RPC de conversión a invoice |
| `created_at` / `updated_at` | timestamptz | `now()` | `updated_at` lo mantiene un trigger |

**Valores de status** (texto libre, igual que `estimates.status`): `Draft`,
`Pending`, `Sent`, `Viewed`, `Accepted`, `Declined`, `Converted`, `Invoiced`, `Canceled`.
`Sent` lo escriben las funciones de envío, `Viewed` lo escribe `mark-viewed`,
`Converted` el RPC a job e `Invoiced` el RPC a invoice. Si el quote ya era
`Converted` y luego se factura, el status se queda en `Converted`. El resto lo
maneja el frontend.

Los campos que sí tiene el estimate residencial y que quick quotes **no** tiene:
`client_id`, `lead_id`, `client_name`, `company_name`, `email`, `phone`, `address`,
`apt`, `city`, `state`, `zip`.

## 2. CRUD

El RLS es solo-dueño (`auth.uid() = user_id`) para SELECT / INSERT / UPDATE / DELETE,
así que las llamadas normales de PostgREST son la API de CRUD — no hace falta ningún
RPC propio:

```ts
// crear
const { data } = await supabase
  .from("quick_quotes")
  .insert({ user_id: user.id, service_sub_type: "Deep Cleaning", subtotal: 500 })
  .select()
  .single();

// listar / leer / actualizar / borrar
await supabase.from("quick_quotes").select("*").order("created_at", { ascending: false });
await supabase.from("quick_quotes").select("*").eq("id", id).single();
await supabase.from("quick_quotes").update({ subtotal: 620 }).eq("id", id);
await supabase.from("quick_quotes").delete().eq("id", id);
```

Los usuarios anónimos **no** tienen política de SELECT. La página pública del quote
tiene que usar el RPC:

```ts
const { data } = await supabase.rpc("get_public_quick_quote", { p_token: token });
```

Acepta el share token (o el id del quote cuando ya tiene token), marca `viewed_at` en
la primera lectura y quita `labor_cost`, `supplies_cost`, `overhead_cost`,
`total_operation_cost` y `draft_data`. Devuelve `null` si el token no existe.

`supabase.rpc("generate_quick_quote_share_token", { p_quick_quote_id: id })` rota el
token (solo el dueño) — el token inicial ya existe desde el insert. El trigger y el
RPC usan `extensions.gen_random_bytes` (pgcrypto). Si ves
`function gen_random_bytes(integer) does not exist`, falta aplicar
`20260923120000_fix_quick_quote_share_token.sql`.

## 3. Envío por email

```ts
await supabase.functions.invoke("send-quick-quote-email", {
  body: {
    quickQuoteId: quote.id,     // requerido (quoteData se acepta como respaldo)
    recipientEmail: "jane@example.com", // requerido — lo escribe el usuario
    recipientName: "Jane Doe",  // opcional, se usa en el saludo y el asunto
    publicUrl: undefined,       // opcional, reemplaza el link del botón "View Quote"
    isUpdate: false,            // true → texto "You have an Updated quote"
  },
});
```

Comportamiento:
- Recarga el quote del lado del servidor (service role), así el email siempre refleja
  lo que hay en la base.
- Mismo template que el email del estimate residencial: encabezado con el
  `profiles.company_name` del dueño, Service Details, Scope of Work, la tabla de tres
  columnas del Service Breakdown y la tabla de Pricing. `Client Information` se
  reemplaza por **Prepared For** con nombre/email/teléfono del destinatario y sin
  línea de dirección.
- Manda la copia al dueño a `profiles.company_email` (con el desglose interno de
  costos y el bloque de utilidad/margen), 3 s después de la copia del cliente, igual
  que en estimates.
- Incluye el pixel de tracking `mark-viewed?type=quick_quote&id=…`.
- El correo del destinatario lleva **Accept Estimate** (verde) + **View Quote**
  (azul), igual que el estimate residencial. Accept apunta a
  `${PUBLIC_SUPABASE_URL}/functions/v1/accept-quick-quote?id=<id>`. View Quote
  apunta a `publicUrl` o a
  `${PUBLIC_APP_URL}/public/quick-quote/<public_share_token>` — hay que crear esa
  ruta, o mandar `publicUrl` si prefieres otro path. Si no hay URL pública, solo se
  muestra Accept.
- Después de un envío exitoso escribe `sent_at`, `last_sent_channel='email'`,
  `recipient_email`, `is_draft=false`, y pasa `status` a `Sent` solo si estaba en
  `Draft`/`Pending`/null. Si esa escritura falla, el envío no falla.

Respuesta: `{ success, message, recipient, ownerCopied, quoteUrl }`.

## 3b. Aceptar (público)

No hay política de UPDATE para anon — no hace falta. El destinatario abre:

```
GET /functions/v1/accept-quick-quote?id=<quick_quote_id>
```

(`verify_jwt = false`, service role). Marca `status = 'Accepted'` y `is_draft = false`
salvo que ya esté en `Accepted`, `Converted` o `Canceled`. En la primera aceptación
inserta una notificación `quick_quote_accepted` y manda un correo al
`profiles.company_email` del dueño. Devuelve una página HTML de confirmación, igual
que `accept-estimate`.

`accept-estimate` no sirve: está cableado a `estimates` y con un id de quick quote
responde "Estimate not found".

## 4. Envío por SMS

```ts
await supabase.functions.invoke("send-quick-quote-sms", {
  body: {
    phoneNumber: "3055551234",  // requerido — lo escribe el usuario
    quickQuoteId: quote.id,     // requerido salvo que se mande quoteUrl
    recipientName: "Jane Doe",  // opcional, el saludo cae a "Hi there"
    quoteUrl: undefined,        // opcional, reemplaza el link
    quoteTotal: undefined,      // opcional; si no, se calcula del quote
    isUpdate: false,
  },
});
```

Mismo transporte de Twilio y mismo texto que `send-estimate-sms`:
`Hi {name}, your cleaning estimate for $X is ready. View it here: {url}`.
Los números se normalizan a `+1…`. Escribe el mismo estado de envío que la función de
email, con `last_sent_channel='sms'` y `recipient_phone`.

Respuesta: `{ success, messageSid, quoteUrl }`.

## 5. Convertir a job

Idéntico al flujo estimate→job: se inserta el job y luego se llama al RPC de
finalización. Un RPC auxiliar devuelve el payload ya mapeado para no recalcular nada
en el cliente.

```ts
// 1) prefill (solo el dueño, aplica RLS)
const { data: prefill } = await supabase
  .rpc("get_quick_quote_job_prefill", { p_quick_quote_id: quote.id });

// 2) insertar el job — agregar cliente/propiedad/empleados desde el formulario
const { data: job } = await supabase
  .from("jobs")
  .insert({ ...prefill, user_id: user.id, quick_quote_id: quote.id, /* client_id, property_* … */ })
  .select("id")
  .single();

// 3) vincular ambos lados de forma atómica
const { error } = await supabase.rpc("finalize_quick_quote_to_job_conversion", {
  p_quick_quote_id: quote.id,
  p_job_id: job.id,
});
if (error) await supabase.from("jobs").delete().eq("id", job.id); // mismo rollback que en estimates
```

`get_quick_quote_job_prefill` devuelve: `quick_quote_id`, `client_name`,
`client_email`, `client_phone` (de los campos del destinatario), `service_type`,
`job_type: 'one_time'`, `scheduled_date` (`quote_date`), `service_details`
(`service_scope`), un único `line_items` nombrado según
`service_sub_type ?? service_type` y valuado al subtotal, `subtotal`,
`discount_type`/`discount_value`/`discount_amount`, impuestos en cero,
`total_amount`, `deposit_required: false`, `balance_due`, `payment_status`,
`status: 'draft'`, y además `main_data` / `additional_data` / `additional_items` /
`extra_services` / `pets` / `laundry` tal como están, en caso de que el formulario
quiera mostrar el desglose. Las llaves que no son columnas de `jobs`
(`quick_quote_id`, `main_data`, …) hay que quitarlas antes del insert, o seleccionar
explícitamente las que sí van.

`finalize_quick_quote_to_job_conversion` setea `jobs.quick_quote_id` y
`quick_quotes.job_id`, marca el quote como `Converted` con `is_draft=false`, y
devuelve `{ job_id, quick_quote_id, job, quick_quote }`. Lanza error si: no hay
sesión, quien llama no es el dueño, no existe el quote o el job, el quote ya está
vinculado a otro job, o el job ya está vinculado a otra fuente. Volver a llamarlo con
el mismo par no hace nada.

Un job sigue aceptando como máximo una fuente: `jobs_single_source_check` ahora cubre
`estimate_id`, `walkthrough_id` y `quick_quote_id`. Borrar un quick quote deja
`jobs.quick_quote_id` en NULL — el job sobrevive.

## 6. Convertir a invoice

Misma forma que quote→job. El quote no tiene cliente ni dirección; esos campos
salen del formulario de “Complete Invoice Details” (y se guardan también como
cliente). Job e invoice son independientes: un quote puede tener los dos.

```ts
const { data: prefill } = await supabase
  .rpc("get_quick_quote_invoice_prefill", { p_quick_quote_id: quote.id });

const { data: invoice } = await supabase
  .from("invoices")
  .insert({
    ...prefill,
    user_id: user.id,
    invoice_number: nextNumber,
    client_name, email, phone, address, apt, city, state, zip,
    quick_quote_id: quote.id,
    status: "Draft",
  })
  .select("id")
  .single();

const { error } = await supabase.rpc("finalize_quick_quote_to_invoice_conversion", {
  p_quick_quote_id: quote.id,
  p_invoice_id: invoice.id,
});
if (error) await supabase.from("invoices").delete().eq("id", invoice.id);
```

`get_quick_quote_invoice_prefill` devuelve: `quick_quote_id`, `client_name` /
`email` / `phone` (del destinatario), `service_type: 'Single Payment'`,
`invoice_name` (`service_sub_type` o `service_type`), `invoice_date` y `due_date`
(`quote_date`), un `line_items` con la descripción del `service_scope` y el
subtotal, `discount_type` (`percentage` | `fixed`) / `discount_value`, `tax_rate`
nulo, `total` (`quick_quote_display_total`) y `notes` (`service_scope`).

`finalize_quick_quote_to_invoice_conversion` setea `invoices.quick_quote_id` y
`quick_quotes.invoice_id`, marca `is_draft=false` y el status `Invoiced` salvo
que ya fuera `Converted`. Lanza error si no hay sesión, no es el dueño, el quote
ya está vinculado a otra invoice, o la invoice ya tiene otra fuente. Volver a
llamarlo con el mismo par no rompe nada.

Borrar el quote deja `invoices.quick_quote_id` en NULL — la invoice sobrevive.
