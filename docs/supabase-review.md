# Estado del servidor y alcance de la revisión

## Cambios confirmados en Supabase

El usuario aplicó las restricciones de duración positiva y exclusión de horarios. Se conserva una excepción exacta para la cita histórica 33, completada el 18 de junio de 2026 a las 18:30 con 160 minutos. Las citas 32 y 33 no se borraron ni se alteraron. Cambiar los campos de la excepción vuelve a incluir la cita en la restricción; el disparador comprueba nuevas reservas contra ambas.

El usuario también ejecutó `docs/fidelidad-migration.sql` y confirmó «Fidelidad atomica instalada». Una consulta a `salon_fidelidad_version()` en el servidor devolvió `1`.

El 28 de octubre de 2026 ejecutó el SQL combinado de `docs/configuracion-fix.sql` y `docs/horarios-migration.sql` y confirmó «Horarios personalizados instalados». La RPC pública `salon_leer_horario()` devuelve un horario válido. Los horarios semanales, las fechas especiales y los bloqueos se comprueban también en la base de datos; solo un administrador autenticado puede guardar excepciones. La reparación de avisos está incluida en la transacción, pero no se han enviado correos reales para validarla.

- `salon_operar` autoriza al administrador, serializa operaciones, bloquea filas y registra el resultado por UUID de reintento. Actualizar una cita y su tarjeta forma una sola transacción.
- Los disparadores impiden cambios de sellos y transiciones de finalización por separado desde pestañas antiguas; deben recargarse tras publicar.
- Según la preferencia expresa del usuario, los diez sellos se conservan hasta pulsar «Canjear regalo». La tarjeta nueva empieza en cero y el canje queda registrado.
- Los movimientos vinculan citas por `cliente_id`, sin buscar teléfonos. Las citas manuales sin cuenta no modifican tarjetas.
- No se infieren sellos de citas históricas. Revertir una cita sin movimiento conocido, o anterior a un ajuste/canje posterior, requiere confirmar que se conserva el saldo para revisión manual. Cancelar la confirmación revierte toda la operación.
- La migración corrige las políticas de reseñas: la lectura pública requiere `destacada IS TRUE` y la inserción de clientas exige que `cliente_id` coincida con `auth.uid()`.

## Esquema comprobado

`admins` solo contiene `id`, asociado a `auth.users`; no hay columnas de contraseñas heredadas. Todas las tablas exportadas tenían RLS activa. Los permisos concedidos a `anon` no implican por sí solos acceso a todas las filas.

`clientas.usuario` es obligatorio y `clientas.id` referencia Auth. La web ya no intenta crear un perfil únicamente con nombre/teléfono: permite agendar una cita sin cuenta y explica que carece de tarjeta de fidelidad.

`sumar_sello_al_completar` existe pero no aparece conectado a un disparador. No se activa; la migración rechaza su instalación si detecta esa función conectada, para impedir un doble cómputo.

## Validación y límites

Las pruebas locales de PostgreSQL/PGlite verifican permisos, intervalos, reintentos, canjes, reversiones, datos antiguos y reversión completa ante un fallo de escritura. Las pruebas de interfaz comprueban el doble clic, la reutilización de la clave tras un fallo de red y las confirmaciones. No se crearon reservas ni cuentas de prueba en producción.

PGlite no reproduce contención entre varias conexiones ni todos los disparadores de producción. La concurrencia administrativa se serializa con un bloqueo asesor transaccional, y los solapamientos se protegen mediante la restricción de exclusión.

Quedan fuera de esta revisión:

- Las funciones de correo y recuperación, incluidos permisos y límites de intentos. Las pruebas no envían correos reales.
- La validación completa de catálogo y precios en las reservas públicas: parte sigue en el navegador. Los horarios, bloqueos, solapamientos y duraciones no positivas sí tienen comprobaciones en el servidor.
- La reconstrucción de sellos anteriores a la migración y la asociación de citas históricas sin `cliente_id`.
- Una prueba administrativa de extremo a extremo con cuentas de ensayo en producción.

La revisión corrige los problemas descritos y no constituye una auditoría completa de Supabase.

## Revisión de horarios del 28 de octubre de 2026

Se reprodujeron y corrigieron tres fallos de interfaz: el retorno a horas predeterminadas cuando faltaba la RPC, la reactivación de citas canceladas sin volver a comprobar disponibilidad y la representación incompleta de bloqueos de 30 minutos con intervalos de reserva menores. Los bloqueos existentes pueden retirarse incluso si el administrador creó una cita excepcional encima de ellos. Se añadió un mensaje comprensible para conflictos de reservas simultáneas y se ajustaron los campos y servicios en móvil.

Las 58 pruebas locales pasan. Las pruebas adicionales cubren los fallos reproducidos, los conflictos al reactivar, el mensaje de concurrencia y la comprobación de horarios del servidor al reactivar una cita. No equivalen a una prueba de correo real ni a una prueba administrativa autenticada en producción.
