# Shanahan Nails

Web estática del salón, publicada con Vercel y conectada a Supabase.

## Estructura

- `index.html`: vistas, formularios y diálogos.
- `assets/styles.css`: estilos y adaptación a móvil.
- `assets/app.js`: navegación, sesión, catálogo, reservas y administración.
- `assets/core.js`: reglas compartidas de precios, horarios, suplementos y representación segura de reseñas.
- `tests/`: pruebas de interfaz con Supabase simulado y pruebas SQL en PostgreSQL local (PGlite).
- `docs/fidelidad-migration.sql`: migración de fidelidad; no se incluye en la web publicada.
- `scripts/serve.cjs`: servidor local, limitado a localhost.
- `vercel.json`: publicación de archivos estáticos y ruta de entrada.

`npm run build` copia los archivos públicos a `dist`; Vercel publica esa carpeta. SQL, documentación y pruebas quedan fuera. Las dependencias npm se usan para desarrollo y pruebas; el navegador carga Bootstrap, Supabase y Lottie desde sus CDN.

## Desarrollo y verificación

Requiere Node.js 20 o posterior.

```sh
npm ci
npm run check
npm test
npm start
```

La vista local se abre en `http://127.0.0.1:4173`. **Utiliza el Supabase real del salón**: navegar por pantallas públicas solo consulta datos, pero enviar formularios, iniciar sesión o usar administración puede modificar producción. Las pruebas `npm test` sustituyen Supabase y no realizan llamadas de red ni cambios reales.

Rutas compartibles: `#inicio`, `#precios`, `#resenas`, `#reservar`, `#registro`, `#mi-cuenta` y `#acceso-salon`. Los fragmentos son navegación de cliente, no páginas independientes para posicionamiento en buscadores.

## Reservas y fidelización

- Se puede elegir servicio y horario antes de iniciar sesión. El borrador se conserva en memoria durante ese acceso; no se guarda entre recargas.
- El suplemento de retirada usa precio y duración del catálogo `servicios`. No se suma dos veces si ya forma parte de la selección.
- Solo se muestran horarios tras cargar correctamente bloqueos y ocupación; se vuelven a consultar antes de enviar.
- La fidelización comunica 20 % de descuento al llegar a cinco sellos y un diseño de regalo al completar diez.
- La tarjeta se mantiene en diez sellos hasta pulsar **Canjear regalo** y confirmar la entrega. El canje queda registrado y la tarjeta empieza en cero.
- Crear, editar, completar o eliminar citas y ajustar tarjetas usa `salon_operar`: una transacción, registro de movimientos, comparación de datos previos y clave de reintento. No se suman sellos por separado desde el navegador.
- Una reversión de una cita histórica o anterior a un canje/ajuste requiere confirmar que se conservan los sellos actuales para revisarlos por separado. No se reconstruyen movimientos anteriores a la migración.
- Las citas manuales sin cuenta conservan nombre y teléfono, pero no crean perfiles inválidos ni asignan sellos por coincidencia de teléfono.

## Supabase: límite de esta revisión

Se recibió un diagnóstico del esquema y las funciones de producción. La restricción de exclusión de horarios ya se aplicó en Supabase, conservando una excepción exacta para la cita histórica 33. El usuario confirmó la instalación de la migración de fidelidad y `salon_fidelidad_version()` devuelve `1` en el servidor.

En una instalación nueva, aplicar la migración de fidelidad antes de desplegar esta versión. Las pestañas antiguas deben recargarse: el servidor impide cambios de sellos y transiciones de cita que eludan la operación atómica. Para el alcance de la revisión y los puntos no auditados, consultar `docs/supabase-review.md`.

Las cuentas y contraseñas del salón se gestionan mediante Supabase Auth. Se ha eliminado el código antiguo sin interfaz que escribía contraseñas en `admins`. La sección antes llamada «Usuarios» realmente contiene el correo de notificaciones y ahora se llama «Notificaciones».

La clave `anon` del navegador no otorga permisos administrativos por sí misma. La protección efectiva depende de RLS; nunca colocar una clave `service_role` en archivos públicos.
