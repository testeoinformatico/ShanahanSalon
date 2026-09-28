-- ============================================================
--  SHANAHAN NAILS · Diagnostico del aviso de cita nueva
--  Pegar en Supabase -> SQL Editor -> Run
--  SOLO LEE. No modifica nada.
--  Copiame el resultado de las 4 consultas.
-- ============================================================

-- 1) Como envia el correo la funcion que SI funciona.
--    De aqui saco el mecanismo (Resend, pg_net, hook de auth...).
SELECT proname, prosrc
FROM pg_proc
WHERE proname IN ('send_password_changed_email', 'send_recovery_code');

-- 2) Hay ya algun disparador en la tabla de citas?
SELECT c.relname AS tabla, t.tgname AS disparador, pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname = 'citas' AND NOT t.tgisinternal;

-- 3) Que extensiones hay instaladas (pg_net / http = poder llamar a una API de correo).
SELECT extname FROM pg_extension ORDER BY extname;

-- 4) Que hay guardado en configuracion (la direccion de aviso).
SELECT * FROM configuracion;
