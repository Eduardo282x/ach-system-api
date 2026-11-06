# Documentación de cambios — Turnos 24h, Control de Ventas e Inventario

**Fecha:** 2026-11-06  
**Repositorios revisados:** `ach-system-api` (NestJS + Prisma + PostgreSQL) y `ach-system` (React + Vite + TanStack Query)  
**Alcance:** control de ventas por turnos, historial de inventario, entrada de inventario manual y por Excel, precios de compra/venta, y creación de entradas de inventario desde la plantilla Excel.

> Este documento está pensado para que otra IA o desarrollador pueda revisar los cambios, levantar el sistema en otra PC/servidor y validar contra otra base de datos sin romper datos existentes.

---

## 1. Resumen ejecutivo

| Funcionalidad | Estado |
|---|---|
| Turnos 24h y asignación de turno a la venta | Implementado |
| Bloqueo de ventas sin turno | Implementado |
| Respeto del turno de la sesión aunque cambie el turno actual | Implementado |
| Control de ventas por caja, sesión y turno | Corregido |
| Historial de inventario con búsqueda e invalidación de caché | Implementado |
| Precio de compra y precio de venta en producto | Implementado |
| Entrada de inventario manual con ambos precios | Implementado |
| Importación masiva de productos por Excel | Implementado |
| Coincidencia por código de barras + nombre similar (85%) | Implementado |
| Actualización de producto y suma de stock al coincidir | Implementado |
| Creación de entrada de inventario desde Excel | Implementado |
| Plantilla Excel con hoja de Entrada y hoja de Productos | Implementado |
| Migración/ajuste de base de datos | Aplicado con `prisma db push` en la BD local de desarrollo |

---

## 2. Instrucciones para la IA revisora

1. Revisar primero la sección **Base de datos** antes de ejecutar cualquier comando.
2. **No ejecutar `prisma migrate deploy` sin leer la advertencia de migraciones históricas.**
3. Validar que la base de datos destino tenga las columnas/tablas indicadas en la sección 4.
4. Revisar las reglas de negocio de la sección 5 contra el código.
5. Ejecutar la checklist de la sección 10 en el nuevo entorno.
6. Reportar cualquier diferencia entre la base de datos del servidor y el `schema.prisma`.

---

## 3. Entorno y arranque

### 3.1 Requisitos

- Node.js 20+ (probado con Node 24).
- PostgreSQL.
- `pnpm` (el proyecto usa `pnpm-lock.yaml`).
- Backend NestJS.
- Frontend React/Vite.

### 3.2 Variables de entorno del backend

Archivo: `ach-system-api/.env`

Variables relevantes (nombres únicamente, no valores):

```env
DATABASE_URL="postgresql://USUARIO:PASSWORD@HOST:PUERTO/BASE?schema=public&timezone=America/Caracas"
JWT_SECRET=...
TZ=America/Caracas
PORT=...
MAX_DISCOUNT_PERCENTAGE=...
PASSWORD_ADMIN=...
```

Importante:

- `TZ=America/Caracas` es necesario para que Node y la base de datos trabajen con la misma zona horaria.
- `DATABASE_URL` debe incluir `timezone=America/Caracas`.
- Sin esto, los reportes por día/turno pueden desfasarse 4 horas.

Archivo: `ach-system-api/.env.example` ya incluye `TZ=America/Caracas`.

### 3.3 Variables del frontend

Archivo: `ach-system/.env`

```env
VITE_API_URL=http://HOST:PUERTO
VITE_NAME=...
VITE_IGNORE_EUR=...
```

El frontend concatena `/api` a `VITE_API_URL`.

### 3.4 Comandos de backend

```bash
cd ach-system-api
pnpm install
npx prisma generate
npx prisma db push
pnpm dev
```

- `prisma generate`: regenera el cliente Prisma.
- `prisma db push`: sincroniza el esquema con la base de datos (usado en este proyecto).
- `pnpm dev`: Nest en modo watch.
- `pnpm build`: compila.
- `pnpm start:prod`: ejecuta `dist/src/main.js`.

### 3.5 Comandos de frontend

```bash
cd ach-system
pnpm install
pnpm dev
```

- `pnpm dev`: Vite en el puerto configurado (por defecto 5174).
- `pnpm build`: TypeScript + Vite build.

### 3.6 Puertos

- Backend: variable `PORT` del `.env` (en la máquina de desarrollo actual se usó 3004/3010 para pruebas).
- Frontend: 5174 por defecto.
- Si aparece `EADDRINUSE`, ya hay un proceso usando el puerto. No matar procesos sin confirmar.

---

## 4. Base de datos

### 4.1 Cambios de esquema

Archivo: `ach-system-api/prisma/schema.prisma`

#### `Product`

Se agregó:

```prisma
purchasePrice Decimal @default(0) @db.Decimal(10, 2)
```

Significado:

- `price`: precio de venta actual.
- `purchasePrice`: último costo de compra.

Los productos existentes quedan con `purchasePrice = 0` hasta que se editen o se cargue una entrada.

#### `InventoryEntry`

Se agregó:

```prisma
userId Int?
user   Users? @relation(fields: [userId], references: [id])

@@index([userId])
```

Significado:

- Auditoría de quién creó la entrada.
- Es opcional para no romper entradas antiguas.

#### `InventoryEntryDetail`

Se agregó:

```prisma
salePrice Decimal? @db.Decimal(10, 2)
```

Significado:

- `unitPrice`: costo de compra al momento de la entrada.
- `salePrice`: precio de venta sugerido al momento de la entrada.
- `subtotal`: `cantidad × unitPrice`.

Así el histórico no se reescribe cuando cambie el precio actual del producto.

#### `Users`

Se agregó la relación inversa:

```prisma
inventoryEntries InventoryEntry[]
```

### 4.2 Migración versionada

Archivo creado:

```text
ach-system-api/prisma/migrations/20261106000000_inventory_entry_prices_and_user/migration.sql
```

La migración es idempotente:

- Usa `ADD COLUMN IF NOT EXISTS`.
- Usa `CREATE TABLE IF NOT EXISTS`.
- Usa bloques `DO $$` para agregar foreign keys solo si no existen.

### 4.3 Advertencia importante sobre migraciones

`npx prisma migrate status` muestra las migraciones históricas como **no aplicadas**, porque la base de desarrollo fue creada/sincronizada con `prisma db push`, no con `migrate deploy`.

Consecuencia:

- **No ejecutar `prisma migrate deploy` a ciegas** en una base que ya tiene tablas.
- Para el nuevo servidor, la opción más segura en desarrollo/staging es:

```bash
npx prisma db push
```

- Si se quiere usar `migrate deploy` en producción:
  1. Hacer backup.
  2. Baselinar las migraciones históricas con `prisma migrate resolve --applied ...`.
  3. Aplicar la migración nueva.
  4. Verificar que el esquema coincida.

En esta máquina ya se ejecutó `npx prisma db push` y la base local quedó sincronizada sin pérdida de datos.

### 4.4 Verificación rápida de columnas/tablas

Ejecutar en PostgreSQL:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'Product'
  AND column_name = 'purchasePrice';

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'InventoryEntryDetail'
  AND column_name = 'salePrice';

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'InventoryEntry'
  AND column_name = 'userId';

SELECT table_name
FROM information_schema.tables
WHERE table_name IN ('InventoryEntry', 'InventoryEntryDetail');
```

---

## 5. Reglas de negocio implementadas

### 5.1 Turnos

1. Un turno se resuelve con la hora de `America/Caracas`, no con la hora local del servidor.
2. Si el turno actual no coincide con el turno con el que se abrió la sesión, **la factura se guarda con el turno de la sesión**.
3. **No se permite vender si la sesión no tiene turno.**
4. **No se permite abrir caja si no hay un turno activo.**
5. La sesión debe estar `OPEN` para vender.
6. El turno de la factura es siempre `session.shiftId`.
7. El scheduler de avisos de fin de turno usa `timeZone: America/Caracas`.
8. La pestaña Turnos muestra un aviso si los turnos activos no cubren las 24 horas.

### 5.2 Reportes por turno/sesión

- Si se envía `sessionId`, el resumen usa el rango real de la sesión:
  - `openedAt` → `closedAt` (o `now` si está abierta).
  - Esto evita problemas a medianoche y con turnos nocturnos.
- Si no hay `sessionId` pero hay `shiftId`:
  - Para turnos nocturnos, `date` se interpreta como la **fecha de fin** del turno.
  - Ejemplo: turno `22:00–07:00`, `date=2026-08-09` → rango `2026-08-08 22:00` a `2026-08-09 07:00` (hora Caracas).
- Si no hay `sessionId` ni `shiftId`, se usa el día completo de Caracas.

### 5.3 Ventas

- Se excluyen facturas `CANCELLED` de:
  - Resumen de ventas.
  - Dashboard.
- El filtro por caja ahora usa la relación `session.cashDrawerId` (antes usaba un campo inexistente).
- `payInvoiceCredit`:
  - Solo permite pagar facturas `PENDING`.
  - Marca `PAID`.
  - Refresca los totales de la sesión.

### 5.4 Inventario manual

`POST /api/inventory/entries`:

- Rechaza productos repetidos en el detalle.
- Valida que los productos existan y no estén eliminados.
- Crea la entrada con `userId`.
- Por cada detalle:
  - Suma stock.
  - Actualiza `product.purchasePrice = unitPrice`.
  - Si viene `salePrice`, actualiza `product.price = salePrice`.
  - Crea movimiento `RESTOCK`.
  - Crea `InventoryEntryDetail` con `unitPrice`, `salePrice` y `subtotal` (subtotal sobre compra).

### 5.5 Importación Excel de productos

Endpoint:

```text
POST /api/excel/products/upload
```

Comportamiento:

1. Normaliza nombres (minúsculas, sin acentos, sin puntuación).
2. Calcula similitud con:
   - Distancia de Levenshtein normalizada.
   - Jaccard por tokens.
   - Toma el máximo de ambos.
3. Umbral: **85%**.
4. Si el código de barras existe y el nombre es similar:
   - Actualiza nombre, presentación, precio de compra y precio de venta.
   - Suma la cantidad al stock.
   - Registra movimiento `ADJUSTMENT`.
5. Si el código existe pero el nombre no es similar:
   - Reporta conflicto y no sobrescribe.
6. Si el código no existe pero el nombre coincide con otro producto:
   - Reporta conflicto para evitar fusiones incorrectas.
7. Si el código viene vacío:
   - Busca por nombre similar; si existe, actualiza.
   - Si no, genera un código automático.
8. Los errores de fila no abortan toda la carga de productos: se procesan las filas válidas y se devuelve el detalle de errores.

### 5.6 Importación Excel de entrada de inventario

Endpoint:

```text
POST /api/excel/inventory-entries/upload
```

Comportamiento:

1. Lee la hoja `Entrada`:
   - N° Control (obligatorio, único).
   - Título.
   - Descripción.
   - Fecha (obligatoria).
2. Lee la hoja `Productos`.
3. Usa la misma lógica de coincidencia del 85%.
4. Crea `InventoryEntry`.
5. Por cada producto:
   - Actualiza o crea producto.
   - Suma stock.
   - Actualiza `purchasePrice` y `price` si vienen.
   - Crea `InventoryEntryDetail`.
   - Crea movimiento `RESTOCK`.
6. Si una fila falla, **toda la entrada se revierte** (transacción).
7. Devuelve:
   - Entrada creada.
   - Resumen con productos creados/actualizados y errores.

### 5.7 Semántica de precios

| Campo | Significado |
|---|---|
| `Product.purchasePrice` | Costo actual del producto |
| `Product.price` | Precio de venta actual |
| `InventoryEntryDetail.unitPrice` | Costo de compra al momento de la entrada |
| `InventoryEntryDetail.salePrice` | Precio de venta al momento de la entrada |
| `InventoryEntryDetail.subtotal` | `cantidad × unitPrice` (compra) |

---

## 6. Backend: cambios por módulo

### 6.1 Utilidad de tiempo

Archivo nuevo:

```text
ach-system-api/src/common/utils/time.util.ts
```

Funciones principales:

- `APP_TIMEZONE = 'America/Caracas'`.
- `timeToMinutes(time)`.
- `minutesOfDay(date)`.
- `startOfDay(date)`.
- `endOfDay(date)`.
- `parseDateOnly(date)`.
- `shiftReportWindow(date, shift)`.
- `shiftStartWindow(date, shift)`.
- `localDateString(date)`.

Todas usan `dayjs` con `timezone`.

### 6.2 Turnos

Archivos:

- `src/shifts/shifts.service.ts`
- `src/shifts/shifts.controller.ts`
- `src/shifts/shifts.scheduler.service.ts`

Cambios:

- `findCurrentShift()` usa `minutesOfDay()`.
- Nuevo `GET /api/shifts/current`.
- Cron con `timeZone: 'America/Caracas'`.
- Se mantiene validación de solapamiento.

### 6.3 Sesiones

Archivo: `src/sessions/sessions.service.ts`

Cambios:

- Rangos de fecha con `startOfDay`/`endOfDay`.
- `openSession` bloquea si no hay turno activo.
- `closeSession` y `refreshSessionTotals` se mantienen.

### 6.4 Ventas

Archivo: `src/sales/sales.service.ts`

Cambios:

- Eliminado `getVenezuelaNow()`.
- `createdAt` usa `new Date()`.
- `createInvoice` usa el turno de la sesión.
- `createInvoice` bloquea si `session.shiftId` es nulo.
- `createInvoice` valida `session.status === 'OPEN'`.
- `getResumenSales`:
  - Corregido filtro por caja.
  - Excluye `CANCELLED`.
  - Si hay `sessionId`, usa el rango de la sesión.
  - Si hay `shiftId`, usa el rango exacto del turno.
- `getResumenSalesExcel`:
  - Usa el mismo rango.
  - El detalle se filtra por la ventana exacta del turno.
  - Excluye canceladas.
- `payInvoiceCredit` valida estado y refresca totales.

### 6.5 Inventario

Archivos:

- `src/inventory/inventory.controller.ts`
- `src/inventory/inventory.service.ts`
- `src/inventory/inventory.dto.ts`

Cambios:

- `salePrice` opcional en el detalle.
- Actualización de precios del producto.
- Movimiento `RESTOCK`.
- `userId` en `InventoryEntry`.
- Búsqueda y paginación respetan día Caracas.

### 6.6 Productos

Archivos:

- `src/products/products.service.ts`
- `src/products/products.controller.ts`
- `src/products/products.dto.ts`

Cambios:

- `ProductDto` acepta `purchasePrice`.
- `createProduct` guarda `purchasePrice ?? 0`.
- Historial incluye `purchasePrice`.
- Historial acepta `search` por nombre/código.
- Generación de código de barras se mantiene.

### 6.7 Excel

Archivos:

- `src/excel/excel.controller.ts`
- `src/excel/excel.service.ts`
- `src/excel/excel.interface.ts`

Cambios:

- Plantilla con 3 hojas.
- Mapeo de cabeceras con alias y normalización (acentos, `?`, mayúsculas).
- Importación de productos con coincidencia al 85%.
- Importación de entradas de inventario.
- Reporte de productos actualizados con valores anteriores y nuevos.
- Fechas de Excel normalizadas.
- Columna de código de barras en formato texto en la plantilla.

### 6.8 Auth

Archivo: `src/auth/auth.guard.ts`

Cambio:

- En rutas ignoradas, si llega un token, se decodifica y se coloca en `request.user`.
- Esto permite que `/api/excel/products/upload` siga siendo pública pero registre el `userId` del movimiento cuando el frontend envía token.

### 6.9 Dashboard

Archivo: `src/dashboard/dashboard.service.ts`

Cambios:

- Día Caracas.
- Excluye facturas canceladas.

### 6.10 Tests

Archivo: `test/app.e2e-spec.ts`

Cambio menor:

- Import de `supertest` corregido para que `tsc` no falle.

---

## 7. API: endpoints nuevos o modificados

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/excel/products/template` | Sí | Descarga plantilla con hojas Productos, Entrada e Instrucciones |
| POST | `/api/excel/products/upload` | Pública (token opcional) | Carga/actualiza productos masivamente |
| POST | `/api/excel/inventory-entries/upload` | Sí | Crea una entrada de inventario desde Excel |
| GET | `/api/shifts/current` | Sí | Devuelve el turno activo actual o `null` |
| POST | `/api/inventory/entries` | Sí | Crea entrada manual; ahora acepta `salePrice` |
| GET | `/api/products/inventory/history` | Sí | Historial; ahora acepta `search` |
| GET | `/api/sales/resumen` | Sí | Resumen por fecha, caja, sesión y/o turno |
| GET | `/api/sales/resumen-excel` | Sí | Reporte Excel del resumen |

### 7.1 Ejemplo de carga de productos

`POST /api/excel/products/upload`  
`multipart/form-data`, campo `file`.

Respuesta (resumida):

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Productos procesados: 1 creados, 1 actualizados, 0 omitidos",
  "data": {
    "created": 1,
    "updated": 1,
    "skipped": 0,
    "errors": [],
    "products": [
      {
        "barcode": "7591234567890",
        "name": "Harina de maíz",
        "action": "updated",
        "quantityAdded": 10,
        "previous": {
          "name": "Harina de maiz",
          "presentation": "1kg",
          "barcode": "7591234567890",
          "price": 2.5,
          "purchasePrice": 1.5,
          "stock": 5
        },
        "current": {
          "name": "Harina de maíz",
          "presentation": "1kg",
          "barcode": "7591234567890",
          "price": 3,
          "purchasePrice": 1.75,
          "stock": 15
        }
      }
    ]
  }
}
```

### 7.2 Ejemplo de carga de entrada

`POST /api/excel/inventory-entries/upload`  
`multipart/form-data`, campo `file`.

Respuesta (resumida):

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Entrada de inventario creada: 0 creados, 1 actualizados, 0 omitidos",
  "data": {
    "entry": {
      "id": 10,
      "controlNumber": "ENT-000010",
      "title": "Compra proveedor",
      "description": "Mercancía recibida",
      "date": "2026-11-06T04:00:00.000Z",
      "userId": 1
    },
    "summary": {
      "created": 0,
      "updated": 1,
      "skipped": 0,
      "errors": [],
      "products": []
    }
  }
}
```

### 7.3 Ejemplo de turno actual

`GET /api/shifts/current`

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "shift": {
      "id": 3,
      "name": "NOCTURNO",
      "startTime": "22:00",
      "endTime": "07:00",
      "active": true
    }
  }
}
```

Si no hay turno activo:

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "shift": null
  }
}
```

---

## 8. Plantilla Excel

Archivo generado por:

```text
GET /api/excel/products/template
```

### 8.1 Hoja `Productos`

| Columna | Campo interno |
|---|---|
| Nombre | `name` |
| Presentación | `presentation` |
| Código de Barras | `barcode` |
| Precio de Compra | `purchasePrice` |
| Precio de Venta | `price` |
| Cantidad | `stock` |

La columna de código de barras se configura como texto (`@`) para intentar preservar ceros a la izquierda.

### 8.2 Hoja `Entrada`

| Columna | Campo interno |
|---|---|
| N° Control | `controlNumber` |
| Título | `title` |
| Descripción | `description` |
| Fecha | `date` |

### 8.3 Hoja `Instrucciones`

Incluye las reglas de uso, incluida la coincidencia al 85% y la semántica de precios.

### 8.4 Alias aceptados

El parser acepta variantes con/sin acentos y algunos alias:

- `Presentación`, `Presentacion`.
- `Código de Barras`, `Codigo de Barras`, `Código`, `Codigo`.
- `Precio`, `Precio de Venta`, `Precio Venta`.
- `Precio de Compra`, `Precio Compra`.
- `N° Control`, `N Control`, `Número de Control`, `Numero de Control`, `Control`.
- `Título`, `Titulo`.
- `Descripción`, `Descripcion`.

También se normalizan cabeceras con `?` para tolerar archivos con problemas de codificación.

---

## 9. Frontend: cambios

### 9.1 Inventario

Archivos:

- `src/pages/inventory/InventoryEntryForm.tsx`
- `src/pages/inventory/ProductForm.tsx`
- `src/pages/inventory/DownloadAndUploadProducts.tsx`
- `src/pages/inventory/InventoryEntries.tsx`
- `src/pages/inventory/HistoryInventory.tsx`
- `src/pages/inventory/inventory.data.ts`
- `src/pages/inventory/historyInventory.data.ts`
- `src/pages/inventory/inventoryEntries.data.ts`
- `src/interfaces/inventory.interface.ts`
- `src/services/inventory.service.ts`
- `src/hooks/inventory.hook.ts`

Cambios:

- El formulario de entrada permite editar precio de compra y precio de venta.
- El subtotal se calcula sobre el precio de compra.
- Se muestra el total de compra.
- El formulario de producto incluye precio de compra.
- La tabla de inventario muestra precio de compra y precio de venta.
- La entrada expandida muestra precio de compra, precio de venta y subtotal.
- El historial permite buscar por producto/código.
- El diálogo de plantilla permite:
  - Descargar plantilla.
  - Cargar productos.
  - Cargar entrada de inventario.
- Se muestra el detalle de productos creados/actualizados y errores.
- Se invalida inventario, entradas e historial después de cargas y cambios.

### 9.2 Turnos y caja

Archivos:

- `src/pages/layout/Footer.tsx`
- `src/pages/layout/Layout.tsx`
- `src/pages/users/Shifts.tsx`
- `src/pages/cashClosing/CashClosing.tsx`
- `src/pages/invoices/Invoices.tsx`
- `src/pages/cashDrawerSession/CashDrawerSession.tsx`
- `src/pages/cashDrawerSession/cashDrawerSession.data.ts`
- `src/hooks/shifts.hook.ts`
- `src/services/shifts.service.ts`
- `src/interfaces/sessions.interface.ts`

Cambios:

- Footer muestra el turno actual.
- El cierre de caja prioriza la sesión seleccionada.
- El cajero ve automáticamente su sesión/turno.
- El selector de turnos muestra solo turnos activos.
- La columna Turno se agregó al historial de caja.
- La pestaña Turnos muestra cobertura 24h.
- El aviso de fin de turno navega a `/cierre-caja`.
- Se corrigió la ruta duplicada `/historial-inventario`.
- Se corrigió el título de la página de historial de caja.

---

## 10. Pruebas realizadas

### 10.1 Compilación

Backend:

```bash
cd ach-system-api
npx tsc --noEmit -p tsconfig.json
npx nest build
```

Resultado: sin errores.

Frontend:

```bash
cd ach-system
npx tsc -b
npx vite build
```

Resultado: sin errores. Solo aparece el aviso preexistente de tamaño de chunk.

### 10.2 Pruebas de API con servidor real

Se levantó el backend compilado en un puerto alterno y se probó con un token de prueba.

| Prueba | Resultado |
|---|---|
| Descarga de plantilla | HTTP 200, hojas `Productos`, `Entrada`, `Instrucciones` |
| Carga de producto nuevo | Creado, stock 5, compra 1.50, venta 2.50 |
| Carga con mismo código y nombre similar | Actualizado, stock 8, compra 1.75, venta 3.00 |
| Carga de entrada Excel | Entrada creada, producto actualizado, stock 10, compra 2.00, venta 4.00 |
| Detalle de entrada | `unitPrice=2.00`, `salePrice=4.00`, `subtotal=4.00` |
| Movimientos | `ADJUSTMENT` para cargas de catálogo, `RESTOCK` para entrada |
| Turno actual | `NOCTURNO` a las 00:45 hora Caracas |
| Resumen por caja | Sin error de Prisma, totales correctos |
| Resumen por sesión | 15 facturas, rango de sesión respetado |
| Resumen por turno | 15 facturas, rango nocturno respetado |
| Reporte Excel | 15 filas de detalle, resumen correcto |
| Historial con búsqueda | Respuesta correcta, total 80 movimientos para "Arroz" |

Los datos de prueba (`SMOKE TEST...`, `SMOKE-ENTRY...`) fueron eliminados al finalizar.

### 10.3 Base de datos

Se ejecutó:

```bash
npx prisma generate
npx prisma db push
```

Resultado: base local sincronizada sin pérdida de datos.

---

## 11. Riesgos, pendientes y decisiones abiertas

1. **Migraciones históricas no aplicadas.**  
   No usar `migrate deploy` sin baselinar. Ver sección 4.3.

2. **Zona horaria del servidor.**  
   El nuevo servidor debe tener `TZ=America/Caracas` y `timezone=America/Caracas` en la conexión. Si no, los reportes por día/turno pueden desfasarse.

3. **Códigos de barras con ceros a la izquierda.**  
   La plantilla configura la columna como texto, pero si el usuario pega valores numéricos, Excel puede perder los ceros. Validar en la PC del servidor.

4. **Convención de turno nocturno en reportes.**  
   Sin `sessionId`, `date` es la fecha de fin del turno nocturno. Con `sessionId`, se usa el rango real de la sesión. Documentar esto a los usuarios.

5. **Sesiones antiguas sin turno.**  
   Las sesiones creadas antes de este cambio pueden tener `shiftId = null`. Esas sesiones no podrán vender hasta cerrarse/abrirse de nuevo.

6. **Créditos.**  
   El flujo de pago de crédito sigue siendo básico: marca `PAID` y refresca totales, pero no crea un `PaymentDetail` nuevo. Si se requiere auditoría contable detallada, es una mejora pendiente.

7. **Importación de productos parcial.**  
   En productos, las filas válidas se procesan y las inválidas se reportan. En entradas de inventario, cualquier error revierte toda la entrada.

8. **Permisos por rol.**  
   Los endpoints de inventario están protegidos por autenticación global, pero no se agregaron guards específicos por rol. Verificar si el negocio requiere restringir a ADMIN.

9. **Tests automatizados.**  
   Se hicieron pruebas manuales/smoke contra API real. No se agregaron tests unitarios/e2e nuevos para el parser Excel ni para los turnos.

10. **`SalesModule` todavía importa `ShiftsModule`.**  
    Ya no es necesario para `SalesService`, pero no rompe nada. Limpieza opcional.

11. **`createInvoiceDto.shiftId`**  
    Sigue existiendo en el DTO por compatibilidad, pero el backend lo ignora y usa `session.shiftId`. Limpieza opcional.

12. **`.vscode/settings.json`**  
    Ya estaba modificado antes de estos cambios; no forma parte de la implementación.

---

## 12. Checklist para validar en la PC servidor

### 12.1 Antes de arrancar

- [ ] Hacer backup de la base de datos del servidor.
- [ ] Confirmar `DATABASE_URL` y `TZ` en `.env`.
- [ ] Confirmar que la base tiene las columnas/tablas de la sección 4.4.
- [ ] Ejecutar `npx prisma generate`.
- [ ] Ejecutar `npx prisma db push` (si la base no tiene los cambios).
- [ ] Verificar que no haya procesos usando el puerto del backend.

### 12.2 Arranque

- [ ] `cd ach-system-api && pnpm install && pnpm dev`.
- [ ] `cd ach-system && pnpm install && pnpm dev`.
- [ ] Confirmar que el frontend apunta a la URL correcta del backend.

### 12.3 Turnos

- [ ] Crear turnos que cubran 24h, por ejemplo:
  - `07:00–15:00`
  - `15:00–22:00`
  - `22:00–07:00`
- [ ] Verificar que la pestaña Turnos no muestre huecos.
- [ ] Abrir caja y confirmar que toma el turno actual.
- [ ] Intentar abrir caja sin turno activo (simular hueco) y confirmar bloqueo.
- [ ] Vender fuera del horario del turno de la sesión y confirmar que la factura conserva el turno de la sesión.
- [ ] Cerrar caja y validar el resumen por sesión.
- [ ] Validar resumen por turno y por caja.
- [ ] Validar que una factura no quede con `shiftId = null`.

### 12.4 Inventario manual

- [ ] Crear producto con precio de compra y venta.
- [ ] Editar producto y verificar ambos precios.
- [ ] Crear entrada manual con ambos precios.
- [ ] Verificar stock, subtotal, precios del producto e historial.
- [ ] Verificar movimiento `RESTOCK`.

### 12.5 Excel de productos

- [ ] Descargar plantilla.
- [ ] Cargar producto nuevo.
- [ ] Cargar el mismo producto con nombre similar y cantidad adicional.
- [ ] Confirmar que actualiza y suma stock.
- [ ] Confirmar que muestra los productos actualizados.
- [ ] Cargar mismo código con nombre muy distinto y confirmar conflicto.
- [ ] Confirmar que se crea movimiento `ADJUSTMENT`.

### 12.6 Excel de entrada de inventario

- [ ] Completar hoja `Entrada` y hoja `Productos`.
- [ ] Cargar entrada.
- [ ] Confirmar entrada creada, detalle, stock y movimiento `RESTOCK`.
- [ ] Confirmar que el precio de venta actualiza el producto.
- [ ] Intentar cargar un N° Control duplicado y confirmar rechazo.
- [ ] Confirmar que un error de fila revierte toda la entrada.

### 12.7 Historial y ventas

- [ ] Verificar que el historial muestra ventas, entradas, desgloses y cargas Excel.
- [ ] Verificar búsqueda por producto/código.
- [ ] Verificar dashboard con día Caracas.
- [ ] Verificar que facturas canceladas no suman.
- [ ] Verificar reporte Excel de resumen.

---

## 13. Troubleshooting

### 13.1 `EADDRINUSE`

Ya hay un proceso en el puerto. Verificar qué proceso es antes de matarlo:

```powershell
Get-NetTCPConnection -LocalPort 3004
```

### 13.2 La plantilla descarga un archivo corrupto o da 404

Verificar que el frontend llame a:

```text
/api/excel/products/template
```

No a `/api/products/template`.

### 13.3 Prisma error: column does not exist

Falta aplicar el esquema:

```bash
npx prisma generate
npx prisma db push
```

Verificar `purchasePrice`, `salePrice`, `userId`.

### 13.4 Las horas/días salen corridos

Verificar:

- `TZ=America/Caracas`.
- `DATABASE_URL` con `timezone=America/Caracas`.
- Que el servidor no esté forzando UTC en el proceso de Node.

### 13.5 No se puede abrir caja

Es probable que no haya turno activo para la hora actual. Revisar la pestaña Turnos y la cobertura 24h.

### 13.6 No se puede vender

Revisar:

- La sesión está `OPEN`.
- La sesión tiene `shiftId`.
- El turno de la sesión está activo.

### 13.7 El Excel de entrada no carga

Verificar:

- Existe la hoja `Entrada`.
- Existe la hoja `Productos`.
- `N° Control` no está vacío ni duplicado.
- La fecha es válida.
- Las cabeceras están escritas correctamente.

---

## 14. Prompt sugerido para la IA revisora

```text
Actúa como revisor técnico senior de un sistema de ventas NestJS + Prisma + PostgreSQL y React + Vite.

Revisa el repositorio ach-system-api y ach-system usando el archivo DOCUMENTACION_CAMBIOS_TURNOS_VENTAS_INVENTARIO.md como guía.

Objetivos de la revisión:
1. Verificar que el control por turnos 24h sea consistente en backend y frontend.
2. Verificar que no se puedan registrar ventas sin turno.
3. Verificar que la factura conserve el turno de la sesión.
4. Verificar que los reportes por caja, sesión y turno usen rangos correctos en America/Caracas.
5. Verificar la importación Excel de productos:
   - mismo código + nombre similar >= 85% => actualizar y sumar stock.
   - mismo código + nombre distinto => conflicto.
   - reporte de productos actualizados.
6. Verificar la importación Excel de entradas de inventario.
7. Verificar la semántica de precio de compra vs precio de venta.
8. Verificar que el esquema Prisma y la base de datos estén sincronizados.
9. Detectar riesgos de migración, zona horaria, datos existentes y seguridad.
10. Entregar hallazgos por severidad y un checklist de pruebas en la PC servidor.

No ejecutes prisma migrate deploy sin advertir primero el problema de migraciones históricas no aplicadas.
No modifiques archivos sin antes explicar el cambio propuesto.
```

---

## 15. Archivos clave para revisión

### Backend

```text
src/common/utils/time.util.ts
src/auth/auth.guard.ts
src/dashboard/dashboard.service.ts
src/excel/excel.controller.ts
src/excel/excel.interface.ts
src/excel/excel.service.ts
src/inventory/inventory.controller.ts
src/inventory/inventory.dto.ts
src/inventory/inventory.service.ts
src/products/products.controller.ts
src/products/products.dto.ts
src/products/products.service.ts
src/sales/sales.service.ts
src/sessions/sessions.service.ts
src/shifts/shifts.controller.ts
src/shifts/shifts.scheduler.service.ts
src/shifts/shifts.service.ts
prisma/schema.prisma
prisma/migrations/20261106000000_inventory_entry_prices_and_user/migration.sql
```

### Frontend

```text
src/App.tsx
src/hooks/inventory.hook.ts
src/hooks/shifts.hook.ts
src/interfaces/inventory.interface.ts
src/interfaces/sessions.interface.ts
src/pages/cashClosing/CashClosing.tsx
src/pages/cashDrawerSession/CashDrawerSession.tsx
src/pages/cashDrawerSession/cashDrawerSession.data.ts
src/pages/inventory/DownloadAndUploadProducts.tsx
src/pages/inventory/HistoryInventory.tsx
src/pages/inventory/InventoryEntries.tsx
src/pages/inventory/InventoryEntryForm.tsx
src/pages/inventory/ProductForm.tsx
src/pages/inventory/historyInventory.data.ts
src/pages/inventory/inventory.data.ts
src/pages/inventory/inventoryEntries.data.ts
src/pages/invoices/Invoices.tsx
src/pages/layout/Footer.tsx
src/pages/layout/Layout.tsx
src/pages/layout/header.data.ts
src/pages/users/Shifts.tsx
src/services/inventory.service.ts
src/services/shifts.service.ts
```

---

## 16. Notas finales

- Los cambios están en el working tree; no se hizo commit.
- La base local fue sincronizada con `prisma db push`.
- Los datos de prueba fueron eliminados.
- El backend y el frontend compilan correctamente.
- Antes de probar en la PC servidor, hacer backup y revisar la sección 12.
