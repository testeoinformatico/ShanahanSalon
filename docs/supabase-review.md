# Comprobaciones de servidor pendientes antes de publicar

El diagnóstico facilitado el 9 de octubre de 2026 confirma columnas, políticas, restricciones y nombres de funciones/disparadores. No incluye los cuerpos de las funciones. No se ha aplicado una migración en Supabase.

## Hallazgos confirmados y corrección preparada

- `Resenas lectura publica` usa `USING (true)`, por lo que también permite leer reseñas ocultas. El filtro de la web no sustituye esta política.
- `Resenas insert clientas` comprueba que exista el perfil del usuario, pero no vincula el `cliente_id` insertado con su sesión.
- Se ha preparado la siguiente corrección. Una prueba local con PostgreSQL/PGlite y las políticas exportadas reprodujo ambos fallos y verificó lecturas públicas, inserciones propias, rechazo de identificadores ajenos/nulos y conservación de la moderación administrativa. Repetir la corrección también se verificó. La prueba no ejecuta las funciones de producción ni sustituye una comprobación posterior en Supabase.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER POLICY "Resenas lectura publica" ON public.resenas
USING (destacada IS TRUE);
ALTER POLICY "Resenas insert clientas" ON public.resenas TO authenticated
WITH CHECK (
  cliente_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.clientas AS c WHERE c.id = auth.uid())
);
COMMIT;
```

`admins` solo contiene `id`, asociado a `auth.users`; no hay columnas de contraseñas heredadas. Todas las tablas exportadas tienen RLS activa: los permisos de tabla concedidos a `anon` no implican por sí solos acceso a todas las filas.

Existen disparadores de solapamiento y guardas de citas/perfiles. Hay que leer sus funciones para evaluar concurrencia y cambios de precio, estado o sellos. `sumar_sello_al_completar` existe, pero no aparece conectado directamente a un disparador en el diagnóstico; otra función podría invocarlo.

`clientas.usuario` es obligatorio y `clientas.id` referencia Auth. La creación manual de perfiles desde el administrador debe revisarse frente a estas restricciones antes de publicarse.

## Pendiente antes de publicar

1. Obtener las definiciones de funciones y disparadores de reservas, perfiles y fidelización. Las funciones de correo y recuperación necesitan una revisión separada que no exponga secretos incrustados.
2. Comprobar que perfiles y citas de una clienta solo sean accesibles por su `auth.uid()`, que solo el personal pueda administrar tablas y Storage, y que las lecturas públicas se limiten a catálogo, reseñas publicadas y disponibilidad sin datos personales. Verificar las funciones de recuperación y sus permisos/límites de intentos.
3. Comprobar una restricción o transacción que rechace intervalos de cita solapados, incluidos envíos simultáneos. No basta con ejecutar `horas_ocupadas` y luego insertar desde el navegador. Revisar citas canceladas y bloques de días/meses/horas.
4. Sustituir completar/editar/crear/eliminar citas y ajustar sellos por operaciones atómicas e idempotentes. Bloquear las filas afectadas; guardar el movimiento de sellos y el canje de premios para poder revertir una cita sin perder el historial. La comparación de valores en el cliente reduce conflictos, pero no reemplaza esta transacción.
5. Verificar el acceso con una cuenta administrativa de ensayo. La relación de `admins.id` con Auth ya está confirmada por la clave foránea; el frontend ya no usa los campos heredados inexistentes.
6. Verificar las asociaciones `citas.cliente_id`, incluidas citas antiguas o creadas manualmente. El área de clientas consulta por ese identificador; las filas históricas sin relación deben vincularse de forma controlada, no por un teléfono ambiguo en el navegador.
7. Realizar pruebas con cuentas de ensayo autorizadas: registro/OTP, recuperación, restauración de sesión, reserva simultánea, completar cita una vez, fallo durante fidelización y cambio/reversión de estado. Las pruebas locales usan datos simulados y no sustituyen esta verificación.

No se debe fusionar la rama como si fuese una auditoría completa de Supabase. Los cambios de frontend no afirman corregir permisos o transacciones del servidor.
