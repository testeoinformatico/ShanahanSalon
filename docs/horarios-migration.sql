-- Instalar antes de publicar el editor de horarios. No modifica citas existentes.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS public.salon_horario (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  datos jsonb NOT NULL
);
INSERT INTO public.salon_horario(id,datos)
SELECT true,jsonb_build_object('paso',30,'excepciones','{}'::jsonb,'semana',
  (SELECT jsonb_agg('[[540,840],[960,1260]]'::jsonb) FROM generate_series(0,6)))
ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.salon_horario ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_horario FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.salon_validar_tramos(p_tramos jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE r jsonb; a integer; b integer; anterior integer := -1;
BEGIN
  IF jsonb_typeof(p_tramos) IS DISTINCT FROM 'array' OR jsonb_array_length(p_tramos)>12 THEN RETURN false; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_tramos) LOOP
    IF jsonb_typeof(r) IS DISTINCT FROM 'array' OR jsonb_array_length(r)<>2 THEN RETURN false; END IF;
    IF jsonb_typeof(r->0)<>'number' OR jsonb_typeof(r->1)<>'number' OR (r->>0)!~'^\d+$' OR (r->>1)!~'^\d+$' THEN RETURN false; END IF;
    a:=(r->>0)::integer; b:=(r->>1)::integer;
    IF a<0 OR b>1440 OR a>=b OR a<anterior THEN RETURN false; END IF;
    anterior:=b;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE OR REPLACE FUNCTION public.salon_validar_horario(p_horario jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE r jsonb; k text; d date;
BEGIN
  IF jsonb_typeof(p_horario) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_horario->'semana') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_horario->'semana')<>7
     OR jsonb_typeof(p_horario->'excepciones') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_horario->'paso') IS DISTINCT FROM 'number'
     OR NOT (p_horario->>'paso'=ANY(ARRAY['5','10','15','20','30','60'])) THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_horario->'excepciones'))>366 THEN RETURN false; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_horario->'semana') LOOP
    IF NOT public.salon_validar_tramos(r) THEN RETURN false; END IF;
  END LOOP;
  FOR k,r IN SELECT key,value FROM jsonb_each(p_horario->'excepciones') LOOP
    IF k!~'^\d{4}-\d{2}-\d{2}$' OR NOT public.salon_validar_tramos(r) THEN RETURN false; END IF;
    d:=k::date;
    IF to_char(d,'YYYY-MM-DD')<>k THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE OR REPLACE FUNCTION public.salon_leer_horario()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT datos FROM public.salon_horario WHERE id=true
$$;
REVOKE ALL ON FUNCTION public.salon_leer_horario() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.salon_leer_horario() TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.salon_guardar_horario(p_horario jsonb,p_anterior jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actual jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo el salon puede cambiar el horario' USING ERRCODE='42501';
  END IF;
  IF NOT public.salon_validar_horario(p_horario) THEN RAISE EXCEPTION 'Horario no valido: revisa fechas y tramos'; END IF;
  SELECT datos INTO actual FROM public.salon_horario WHERE id=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Falta instalar el horario'; END IF;
  IF actual IS DISTINCT FROM p_anterior THEN RAISE EXCEPTION 'El horario cambio en otra sesion. Vuelve a abrir Horarios antes de guardar'; END IF;
  UPDATE public.salon_horario SET datos=p_horario WHERE id=true;
  RETURN p_horario;
END $$;
REVOKE ALL ON FUNCTION public.salon_guardar_horario(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.salon_guardar_horario(jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.salon_comprobar_horario_cita()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h jsonb; tramos jsonb; inicio numeric; fin numeric; fecha_txt text;
BEGIN
  IF coalesce(NEW.estado,'pendiente')='cancelada' THEN RETURN NEW; END IF;
  -- Conservar las citas históricas y las correcciones que no alteran su horario.
  IF TG_OP='UPDATE' THEN
    IF coalesce(OLD.estado,'pendiente')<>'cancelada' AND
      ROW(NEW.fecha,NEW.hora,NEW.duracion_minutos) IS NOT DISTINCT FROM ROW(OLD.fecha,OLD.hora,OLD.duracion_minutos) THEN RETURN NEW; END IF;
  END IF;
  inicio:=extract(epoch FROM NEW.hora)/60;
  fin:=inicio+coalesce(NEW.duracion_minutos,30);
  IF NEW.fecha IS NULL OR NEW.hora IS NULL OR coalesce(NEW.duracion_minutos,30)<=0 OR fin>1440 OR inicio<0 THEN
    RAISE EXCEPTION 'Hora o duracion no valida: la cita debe terminar en el mismo dia';
  END IF;
  -- Solo la identidad autenticada del salón puede saltarse cierres y bloqueos.
  -- Las restricciones existentes contra solapamientos continúan aplicándose.
  IF auth.uid() IS NOT NULL AND public.is_admin() THEN RETURN NEW; END IF;
  SELECT datos INTO h FROM public.salon_horario WHERE id=true FOR SHARE;
  IF h IS NULL OR NOT public.salon_validar_horario(h) THEN RAISE EXCEPTION 'No se puede verificar el horario'; END IF;
  fecha_txt:=to_char(NEW.fecha,'YYYY-MM-DD');
  tramos:=coalesce(h->'excepciones'->fecha_txt,h->'semana'->extract(dow FROM NEW.fecha)::integer);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(tramos) r WHERE inicio >= (r->>0)::integer AND fin <= (r->>1)::integer) THEN
    RAISE EXCEPTION 'La cita queda fuera del horario de reservas';
  END IF;
  IF EXISTS (SELECT 1 FROM public.dias_disponibles b WHERE
      (b.tipo='dia_bloqueado' AND b.valor=fecha_txt) OR
      (b.tipo='mes_bloqueado' AND b.valor=left(fecha_txt,7)) OR
      (CASE WHEN b.tipo='hora_bloqueada' AND left(b.valor,11)=fecha_txt||'T' THEN
       tsrange(NEW.fecha+NEW.hora,NEW.fecha+NEW.hora+make_interval(mins=>coalesce(NEW.duracion_minutos,30)),'[)') &&
       tsrange((b.valor)::timestamp,(b.valor)::timestamp+interval '30 minutes','[)') ELSE false END)
    ) THEN RAISE EXCEPTION 'Ese dia u hora esta bloqueado para reservas'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.salon_comprobar_horario_cita() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_salon_horario ON public.citas;
CREATE TRIGGER trg_salon_horario BEFORE INSERT OR UPDATE ON public.citas
FOR EACH ROW EXECUTE FUNCTION public.salon_comprobar_horario_cita();
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT 'Horarios personalizados instalados' AS resultado;
