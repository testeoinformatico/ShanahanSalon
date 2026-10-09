# Comprobaciones de servidor pendientes antes de publicar

Estas tareas necesitan acceso al proyecto de Supabase. No se ha inferido ni aplicado una migración contra un esquema desconocido.

1. Exportar esquema, políticas RLS, funciones y disparadores para revisar sus definiciones. Guardar copia de seguridad antes de cualquier cambio.
2. Comprobar que perfiles y citas de una clienta solo sean accesibles por su `auth.uid()`, que solo el personal pueda administrar tablas y Storage, y que las lecturas públicas se limiten a catálogo, reseñas publicadas y disponibilidad sin datos personales. Verificar las funciones de recuperación y sus permisos/límites de intentos.
3. Comprobar una restricción o transacción que rechace intervalos de cita solapados, incluidos envíos simultáneos. No basta con ejecutar `horas_ocupadas` y luego insertar desde el navegador. Revisar citas canceladas y bloques de días/meses/horas.
4. Sustituir completar/editar/crear/eliminar citas y ajustar sellos por operaciones atómicas e idempotentes. Bloquear las filas afectadas; guardar el movimiento de sellos y el canje de premios para poder revertir una cita sin perder el historial. La comparación de valores en el cliente reduce conflictos, pero no reemplaza esta transacción.
5. Confirmar que `admins.id` corresponde a usuarios reales de Auth. Revisar si permanecen columnas de contraseñas heredadas y eliminar sus datos solo tras confirmar la migración. El frontend ya no lee ni escribe esos campos.
6. Verificar las asociaciones `citas.cliente_id`, incluidas citas antiguas o creadas manualmente. El área de clientas consulta por ese identificador; las filas históricas sin relación deben vincularse de forma controlada, no por un teléfono ambiguo en el navegador.
7. Realizar pruebas con cuentas de ensayo autorizadas: registro/OTP, recuperación, restauración de sesión, reserva simultánea, completar cita una vez, fallo durante fidelización y cambio/reversión de estado. Las pruebas locales usan datos simulados y no sustituyen esta verificación.

No se debe fusionar la rama como si fuese una auditoría completa de Supabase. Los cambios de frontend no afirman corregir permisos o transacciones del servidor.
