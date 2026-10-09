# Shanahan Nails

Web estática del salón, publicada con Vercel y conectada a Supabase.

## Estructura

- `index.html`: vistas, formularios y diálogos.
- `assets/styles.css`: estilos y adaptación a móvil.
- `assets/app.js`: navegación, sesión, catálogo, reservas y administración.
- `assets/core.js`: reglas compartidas de precios, horarios, suplementos y representación segura de reseñas.
- `tests/`: pruebas de las reglas y los flujos con una base de datos simulada.
- `scripts/serve.cjs`: servidor local, limitado a localhost.
- `vercel.json`: publicación de archivos estáticos y ruta de entrada.

La aplicación no necesita compilación. Las dependencias npm son exclusivamente para desarrollo y pruebas; el navegador carga Bootstrap, Supabase y Lottie desde sus CDN.

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
- Las escrituras comprueban el error de Supabase. Completar una cita protege contra doble clic y compara el estado previo; las actualizaciones de sellos comparan su valor anterior.

## Supabase: límite de esta revisión

El repositorio no incluye el esquema, las políticas RLS, los disparadores ni las funciones SQL de producción. No se han cambiado desde esta revisión.

La comprobación de horarios del navegador **no garantiza exclusión entre dos reservas simultáneas**. Actualizar una cita y sus sellos continúa requiriendo dos peticiones; debe pasar a una transacción de servidor para garantizar consistencia. Antes de publicar, revisar `docs/supabase-review.md`.

Las cuentas y contraseñas del salón se gestionan mediante Supabase Auth. Se ha eliminado el código antiguo sin interfaz que escribía contraseñas en `admins`. La sección antes llamada «Usuarios» realmente contiene el correo de notificaciones y ahora se llama «Notificaciones».

La clave `anon` del navegador no otorga permisos administrativos por sí misma. La protección efectiva depende de RLS; nunca colocar una clave `service_role` en archivos públicos.
