-- Aplicar DESPUÉS de publicar la web que usa Auth.resetPasswordForEmail.
-- Site URL debe ser https://shanahan-nails.es (SMTP y plantilla ya configurados).
-- No modifica contraseñas, sesiones, fichas existentes, citas ni sellos.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.clientas (id, nombre, telefono, usuario, visitas)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'nombre'), ''), 'Clienta nueva'),
    NULLIF(btrim(NEW.raw_user_meta_data->>'telefono'), ''),
    COALESCE(NULLIF(lower(btrim(NEW.email)), ''), NEW.id::text),
    0
  );
  RETURN NEW;
END;
$$;

-- Mantener las funciones antiguas para auditoría, sin acceso desde el navegador.
-- Los enlaces oficiales de Auth reemplazan los códigos SQL de seis dígitos.
DO $$
DECLARE firma text; funcion regprocedure;
BEGIN
  FOREACH firma IN ARRAY ARRAY[
    'public.send_recovery_code(text)',
    'public.verify_recovery_code(text,text,text)',
    'public.send_welcome_email(text)',
    'public.enviar_recordatorios_diarios()'
  ] LOOP
    funcion := to_regprocedure(firma);
    IF funcion IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', funcion);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', funcion);
    END IF;
  END LOOP;
  funcion := to_regprocedure('public.send_password_changed_email()');
  IF funcion IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', funcion);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', funcion);
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, extensions, pg_temp', funcion);
  END IF;
END;
$$;
COMMIT;
SELECT 'Acceso seguro instalado' AS resultado;
