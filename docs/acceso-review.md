# Revisión de acceso — 23 de noviembre de 2026

## Evidencia y alcance

Se revisaron la web publicada, el código, las cuentas e identidades de Supabase, las políticas RLS, las funciones de recuperación y registro, SMTP, las plantillas y los registros de autenticación. Las consultas de diagnóstico no mostraron hashes de contraseñas ni códigos de recuperación.

- Hay 138 cuentas; todas tienen una contraseña almacenada con formato bcrypt y una identidad de correo. Esto no verifica la contraseña que recuerda cada persona.
- Hay 12 cuentas sin correo confirmado y 7 sin ficha (4 sin confirmar y 3 confirmadas). La web permite completar la ficha propia tras autenticarse; no se recrearon automáticamente ni se asignaron sellos.
- La cuenta facilitada existe, está confirmada, tiene ficha y no está bloqueada. El último acceso con contraseña registrado fue el 9 de octubre, después de una recuperación. La actividad del 23 de noviembre renovó una sesión antigua.
- Los rechazos observados son `invalid_credentials`, junto a accesos correctos. No se demostró una caída general ni que un cambio concreto de SQL causara todos los rechazos.

## Fallos confirmados y cambios

1. **Destino incorrecto de los correos:** Site URL apuntaba a `http://localhost:3000`; los redirects adicionales solo incluían el dominio anterior de Vercel. Se corrige Site URL a `https://shanahan-nails.es`. El SMTP Resend ya estaba activo y la plantilla oficial de recuperación usa `ConfirmationURL`.
2. **Recuperación SQL propia:** generaba códigos con `random()`, sin límite de intentos, y modificaba directamente `auth.users`. La comprobación y el consumo del código eran operaciones separadas sin bloqueo. La web se cambia a `resetPasswordForEmail` y `updateUser`. Después del despliegue, `acceso-migration.sql` sustituye las dos RPC antiguas por avisos fijos que piden recargar la página. Estos avisos no consultan cuentas ni envían correos ni modifican contraseñas. No modifica credenciales existentes.
3. **Mensajes engañosos:** el frontend no comprobaba `data.ok` al pedir un código y trataba cualquier registro con usuario devuelto como envío de confirmación. Ahora maneja errores de Auth, respuestas de registro duplicado y altas con sesión inmediata.
4. **Cierre de sesión indebido:** cualquier fragmento de URL activaba un cierre diferido al cambiar la contraseña. Ahora solo el evento `PASSWORD_RECOVERY` identifica ese flujo y no hay un cierre diferido que pueda afectar a otra sesión.
5. **Contraseña administrativa alterada:** el formulario eliminaba espacios antes de enviarla. Ahora conserva exactamente la contraseña introducida.
6. **Confirmación incompleta:** se añade reenvío desde el acceso para correos pendientes y desde el paso de verificación; acepta códigos completos de seis u ocho dígitos y evita solicitudes simultáneas. Se conserva el correo al que se pidió el código.
7. **Sesiones desactualizadas:** una lectura pendiente podía restaurar una cuenta después de cerrar sesión. Se descartan resultados antiguos y se actualiza la identidad al cambiar de cuenta en otra pestaña.
8. **Ficha inicial:** el trigger confiaba en `usuario` de los metadatos enviados por el navegador. Se usa el correo de Auth, se normalizan los datos y se mantiene el saldo inicial cero. No se sobrescriben fichas existentes.
9. **Funciones de correo:** se retira el acceso público a los envíos de bienvenida y recordatorios; se conserva el acceso del servidor. El aviso de cambio de contraseña queda limitado a sesiones autenticadas y con búsqueda de esquema explícita. Un fallo de ese aviso no se presenta como un fallo del cambio de contraseña.

## Publicación

1. Corregir Site URL; conservar SMTP y la plantilla del salón.
2. Publicar la web nueva, que utiliza enlaces oficiales de recuperación.
3. Ejecutar `docs/acceso-migration.sql` y verificar permisos y trigger.
4. Las pestañas antiguas deben recargarse. Los códigos SQL antiguos dejan de aceptarse: se solicita un enlace nuevo.

## Validación y límites

77 pruebas locales pasan, incluyendo 12 pruebas nuevas de interfaz y una de PostgreSQL/PGlite. Cubren acceso, recuperación, confirmación, sesión, permisos de la migración y conservación de datos, además de las regresiones existentes de reservas, horarios, fidelidad y animaciones. `npm run check`, `npm run build` y `git diff --check` pasan. Las pruebas locales no usan cuentas ni envían correos reales.

Queda una prueba humana de entrega del correo, apertura del enlace y entrada con la contraseña elegida. El asistente no recibe ni cambia las contraseñas de las clientas. Los cambios corrigen fallos confirmados, pero no demuestran que todos los rechazos de credenciales hayan quedado resueltos.

Existe una consulta SQL guardada antigua, `Update User Password Hashes`, que contiene contraseñas en texto y actualiza una lista de cuentas. No se ejecutó durante esta revisión y su existencia no prueba cuándo se ejecutó. Conviene retirar ese contenido y que las personas afectadas elijan contraseñas nuevas; eliminarlo permanentemente requiere confirmación y los cambios de contraseña los realizan sus titulares. Ninguna contraseña de esa consulta se incorpora al repositorio ni a este informe.

Referencias oficiales: [recuperación por correo](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [redirecciones](https://supabase.com/docs/guides/auth/redirect-urls), [registro y cuentas existentes](https://supabase.com/docs/reference/javascript/auth-signup).

## Compatibilidad con pestañas antiguas

La retirada inicial de permisos provocó `permission denied for function send_recovery_code` en pestañas que todavía conservaban el JavaScript anterior. Las dos funciones antiguas quedan como avisos de actualización con SECURITY INVOKER, sin operaciones sobre datos. Las pruebas comprueban el aviso tanto para visitantes como para sesiones autenticadas; los envíos de bienvenida y recordatorios siguen restringidos. Esto corrige el error de recuperación de pestañas antiguas, sin atribuirle los rechazos de contraseña que siguen pendientes de diagnóstico.
