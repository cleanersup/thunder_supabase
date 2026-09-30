# País de registro — cómo funciona

El país que el usuario elige al registrarse (`profiles.company_country`) es el
valor por defecto de toda dirección. El frontend puede enviarlo (lo tiene en
el login o con `get_my_country` / `me-country`); si lo manda, el backend lo
acepta. Si no lo manda, el backend lo rellena.

Orden de resolución:

1. Si el request trae `country` (o `billing_country` / `service_country` /
   `property_country`) → se guarda, normalizado a ISO alpha-2.
2. Si viene vacío o no viene → `get_user_country(dueño)`.

## Método: `get_user_country(user_id)` y `resolve_entity_country(sent, user_id)`

**`get_user_country`** lee el país del perfil, lo normaliza a ISO 3166-1
alpha-2 en minúsculas (`us`, `ca`, `mx`, …) y devuelve `'us'` si no hay
perfil o el valor no se reconoce.

**`resolve_entity_country`** es lo que usan los triggers y las edge
functions: país del request si existe, si no el de registro.

| Capa | Nombre | Uso |
|---|---|---|
| SQL | `get_user_country(uuid)` | País de registro. Valor persistido: `us`. |
| SQL | `resolve_entity_country(sent, user_id)` | Request o fallback de registro. |
| SQL | `get_user_country_info(uuid)` | `{ "country": "US", "country_name": "Canada" }`. |
| SQL | `get_my_country()` | Igual, para `auth.uid()`. Equivale a `GET /me/country`. |
| Edge | `getUserCountry(supabase, userId)` | Fallback cuando el body no trae país. |
| Edge | `resolveCountryCode(sent, fallback)` / `resolveRecordCountry(...)` | Preferir el ISO del request; si falta, el de registro. |

**Cuándo se usa.** En cada `INSERT` o `UPDATE` de una entidad con dirección,
y en geocoding / Stripe Connect / bookings públicos.

## Persistencia

Al registrarse, el frontend ya escribe `profiles.company_country` (ISO en
minúsculas). La migración:

1. Normaliza valores viejos (`United States` → `us`).
2. Congela **ese** campo de registro: un `UPDATE` posterior no puede
   cambiar `profiles.company_country`.
3. Copia `country` + `country_name` a `auth.users.raw_user_meta_data`.

Formato:

- En tablas: ISO minúsculas (`us`) para no romper el frontend actual.
- En API / login: ISO mayúsculas (`US`) + nombre para mostrar.

## Login y endpoint dedicado

Tras `signIn` / `getSession`, el usuario trae:

```json
{
  "user_metadata": {
    "country": "US",
    "country_name": "United States"
  }
}
```

Para leerlo en cualquier momento:

```ts
const { data } = await supabase.rpc("get_my_country");
// { country: "US", country_name: "United States" }

await supabase.functions.invoke("me-country");
```

El frontend puede reenviar ese código en creates/updates. No es obligatorio.

`get_public_company_profile` también incluye `company_country` y
`company_country_name`.

## Features

Triggers `zz_enforce_country_*` llaman `resolve_entity_country`:

| Feature | Tabla | Columna(s) | Dueño |
|---|---|---|---|
| Clients | `clients` | `billing_country`, `service_country` | `user_id` |
| Employees | `employees` | `country` | `user_id` |
| Jobs | `jobs` | `property_country` | `user_id` |
| Invoices | `invoices` | `country` | `user_id` |
| Estimates | `estimates` | `country` | `user_id` |
| Leads | `leads` | `country` | `user_id` |
| Requests / bookings | `bookings` | `country` | `business_owner_id` |
| Walkthroughs | `walkthroughs` | `country` | `user_id` |
| Client properties | `client_properties` | `country` | `user_id` |
| Contracts | `contracts` | `country` | `user_id` |

Edge functions:

- `create-booking` — `country` opcional; si falta, país del dueño
- `manage-client-property` — `property.country` opcional
- `stripe-onboard` — `country` opcional; si falta, país de registro
- `geocode-address` — `country` opcional para restringir Google Maps
- `me-country` — endpoint dedicado

## Google Maps / geocoding

`geocode-address` arma:

```
components=country:XX
region=xx
```

`XX` es el país del body si viene, si no el de registro. Si Google
devuelve otro país → `422`. Sin resultados → `404`.

Secretos: `GOOGLE_MAPS_API_KEY` o `GOOGLE_GEOCODING_API_KEY`.

## Tests

```bash
docker exec -i supabase_db_euydrdzayvjahstvmwoj psql -U postgres -d postgres \
  < supabase/tests/lock_user_registration_country.sql

node --experimental-strip-types --test \
  supabase/functions/_shared/userCountry.test.ts \
  supabase/functions/_shared/geocodeAddress.test.ts
```
