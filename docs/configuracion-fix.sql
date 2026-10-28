-- Reparación de los avisos ejecutados dentro de salon_operar (search_path vacío).
-- No cambia destinatarios, contenido de correos, citas ni sellos.
BEGIN;
DO $$
DECLARE f record;
BEGIN
  IF to_regclass('public.configuracion') IS NULL THEN
    RAISE EXCEPTION 'No existe public.configuracion: ejecutar primero 06-revisar-error-configuracion.sql y revisar el resultado';
  END IF;
  -- No introducir esquemas donde las cuentas de la web puedan crear objetos.
  IF has_schema_privilege('anon','public','CREATE') OR has_schema_privilege('authenticated','public','CREATE') THEN
    RAISE EXCEPTION 'Revisar permisos CREATE de public antes de reparar los avisos';
  END IF;
  FOR f IN SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('enviar_correo_cita_confirmada','enviar_correos_nueva_cita','enviar_email_confirmacion','notificar_admin_nueva_cita')
      AND p.prokind='f'
  LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path TO pg_catalog, public, extensions, pg_temp', f.nspname,f.proname,f.args);
  END LOOP;
END $$;
COMMIT;
SELECT 'Busqueda de configuracion corregida en los avisos' AS resultado;
