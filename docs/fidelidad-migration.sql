-- Aplicar antes de publicar la nueva web. No recalcula tarjetas ni citas antiguas.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.salon_operaciones (
  id uuid PRIMARY KEY,
  actor uuid NOT NULL,
  solicitud jsonb NOT NULL,
  resultado jsonb NOT NULL,
  fecha timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.salon_movimientos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cliente_id uuid NOT NULL REFERENCES public.clientas(id) ON DELETE CASCADE,
  cita_id bigint,
  tipo text NOT NULL,
  antes integer NOT NULL CHECK (antes BETWEEN 0 AND 10),
  despues integer NOT NULL CHECK (despues BETWEEN 0 AND 10),
  revierte_id bigint UNIQUE REFERENCES public.salon_movimientos(id),
  actor uuid NOT NULL,
  fecha timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salon_movimientos_cliente_idx ON public.salon_movimientos(cliente_id, id);
CREATE INDEX IF NOT EXISTS salon_movimientos_cita_idx ON public.salon_movimientos(cita_id);
ALTER TABLE public.salon_operaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salon_movimientos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.salon_operaciones, public.salon_movimientos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.salon_movimientos_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.salon_movimientos TO authenticated;
DROP POLICY IF EXISTS "Administracion lee movimientos" ON public.salon_movimientos;
CREATE POLICY "Administracion lee movimientos" ON public.salon_movimientos
  FOR SELECT TO authenticated USING (public.is_admin());

-- Una funcion de fidelidad antigua conectada provocaria un doble computo.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public.citas'::regclass AND NOT t.tgisinternal
      AND t.tgenabled <> 'D' AND p.proname='sumar_sello_al_completar'
  ) THEN
    RAISE EXCEPTION 'Hay un disparador de sellos antiguo activo: revisar antes de instalar';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.salon_operar(
  p_operacion uuid, p_tipo text, p_datos jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_solicitud jsonb := jsonb_build_object('tipo', p_tipo, 'datos', p_datos);
  v_cache public.salon_operaciones%ROWTYPE;
  v_anterior public.citas%ROWTYPE;
  v_nueva public.citas%ROWTYPE;
  v_mov public.salon_movimientos%ROWTYPE;
  v_id bigint;
  v_cliente uuid;
  v_antes integer;
  v_despues integer;
  v_aviso text;
  v_resultado jsonb;
  v_conflicto boolean := false;
  v_revertir boolean := false;
  v_sumar boolean := false;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo el salon puede realizar esta operacion' USING ERRCODE='42501';
  END IF;
  IF p_operacion IS NULL OR p_tipo IS NULL OR jsonb_typeof(p_datos) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Operacion incompleta';
  END IF;

  -- Serializa las operaciones administrativas y sus reintentos.
  PERFORM pg_advisory_xact_lock(8214431);
  SELECT * INTO v_cache FROM public.salon_operaciones WHERE id=p_operacion;
  IF FOUND THEN
    IF v_cache.actor <> v_actor OR v_cache.solicitud IS DISTINCT FROM v_solicitud THEN
      RAISE EXCEPTION 'El identificador ya pertenece a otra operacion';
    END IF;
    RETURN v_cache.resultado;
  END IF;
  PERFORM set_config('salon.operacion_atomica', '1', true);

  IF p_tipo IN ('guardar_cita', 'eliminar_cita') THEN
    v_id := (p_datos->>'id')::bigint;
    IF v_id IS NOT NULL THEN
      SELECT * INTO v_anterior FROM public.citas WHERE id=v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'La cita ya no existe. Actualiza la agenda'; END IF;
      IF p_datos->'antes' IS DISTINCT FROM to_jsonb(v_anterior) THEN
        RAISE EXCEPTION 'La cita cambio en otra sesion. Actualiza la agenda';
      END IF;
    ELSIF p_tipo='eliminar_cita' THEN
      RAISE EXCEPTION 'Falta identificar la cita';
    END IF;

    IF p_tipo='guardar_cita' THEN
      IF jsonb_typeof(p_datos->'cita') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Faltan los datos de la cita';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_object_keys(p_datos->'cita') AS k(campo)
        WHERE campo NOT IN ('cliente_id','fecha','hora','estado','duracion_minutos',
          'servicio','nombre_cliente','telefono','precio')
      ) THEN RAISE EXCEPTION 'Campo de cita no permitido'; END IF;
      v_nueva := jsonb_populate_record(v_anterior, p_datos->'cita');
      IF v_id IS NOT NULL AND v_nueva.cliente_id IS DISTINCT FROM v_anterior.cliente_id THEN
        RAISE EXCEPTION 'No se puede trasladar una cita a otra tarjeta';
      END IF;
      v_nueva.estado := COALESCE(v_nueva.estado, 'pendiente');
      IF v_nueva.estado NOT IN ('pendiente','confirmada','completada','cancelada') THEN
        RAISE EXCEPTION 'Estado de cita no valido';
      END IF;
      IF v_nueva.precio < 0 THEN RAISE EXCEPTION 'El precio no puede ser negativo'; END IF;
      IF v_id IS NULL THEN
        INSERT INTO public.citas(cliente_id,fecha,hora,estado,duracion_minutos,
          servicio,nombre_cliente,telefono,precio)
        VALUES (v_nueva.cliente_id,v_nueva.fecha,v_nueva.hora,v_nueva.estado,
          v_nueva.duracion_minutos,v_nueva.servicio,v_nueva.nombre_cliente,v_nueva.telefono,v_nueva.precio)
        RETURNING * INTO v_nueva;
        v_id := v_nueva.id;
      ELSE
        UPDATE public.citas SET fecha=v_nueva.fecha,hora=v_nueva.hora,estado=v_nueva.estado,
          duracion_minutos=v_nueva.duracion_minutos,servicio=v_nueva.servicio,
          nombre_cliente=v_nueva.nombre_cliente,telefono=v_nueva.telefono,precio=v_nueva.precio
        WHERE id=v_id RETURNING * INTO v_nueva;
      END IF;
      v_sumar := v_nueva.estado='completada' AND v_anterior.estado IS DISTINCT FROM 'completada';
      v_revertir := COALESCE(v_anterior.estado='completada',false) AND v_nueva.estado <> 'completada';
      v_cliente := v_nueva.cliente_id;
    ELSE
      DELETE FROM public.citas WHERE id=v_id;
      v_revertir := COALESCE(v_anterior.estado='completada',false);
      v_cliente := v_anterior.cliente_id;
    END IF;

    IF (v_sumar OR v_revertir) AND v_cliente IS NULL THEN
      v_aviso := 'Cita sin cuenta vinculada: no se ha modificado ninguna tarjeta.';
    ELSIF v_sumar OR v_revertir THEN
      SELECT COALESCE(visitas,0) INTO v_antes FROM public.clientas WHERE id=v_cliente FOR UPDATE;
      IF NOT FOUND OR v_antes NOT BETWEEN 0 AND 10 THEN
        RAISE EXCEPTION 'Revisa la tarjeta de esta clienta antes de continuar';
      END IF;
      IF v_sumar THEN
        -- La tarjeta llena se conserva hasta el canje explicito del salon.
        v_despues := LEAST(v_antes+1,10);
        INSERT INTO public.salon_movimientos(cliente_id,cita_id,tipo,antes,despues,actor)
        VALUES(v_cliente,v_id,'cita',v_antes,v_despues,v_actor);
        IF v_antes=10 THEN v_aviso := 'Tarjeta completa: el regalo sigue pendiente de canje.'; END IF;
      ELSE
        SELECT m.* INTO v_mov FROM public.salon_movimientos m
        WHERE m.cita_id=v_id AND m.tipo='cita'
          AND NOT EXISTS (SELECT 1 FROM public.salon_movimientos r WHERE r.revierte_id=m.id)
        ORDER BY m.id DESC LIMIT 1;
        IF NOT FOUND THEN
          v_conflicto := true;
        ELSE
          v_conflicto := v_mov.cliente_id <> v_cliente OR EXISTS (
            SELECT 1 FROM public.salon_movimientos m
            WHERE m.cliente_id=v_cliente AND m.id>v_mov.id
              AND m.tipo NOT IN ('cita','reversion')
              AND m.antes IS DISTINCT FROM m.despues
          ) OR v_antes < (v_mov.despues-v_mov.antes);
        END IF;
        IF v_conflicto AND NOT COALESCE((p_datos->>'conservar_sellos')::boolean,false) THEN
          RAISE EXCEPTION 'Esta cita es historica o su tarjeta tiene ajustes posteriores. Puedes guardar el cambio conservando los sellos actuales y revisar la tarjeta por separado.'
            USING HINT='CONFIRMAR_SIN_SELLO';
        END IF;
        IF v_conflicto THEN
          v_despues := v_antes;
          v_aviso := 'Cambio guardado. Se conservaron los sellos; revisa la tarjeta si corresponde.';
        ELSE
          v_despues := v_antes-(v_mov.despues-v_mov.antes);
        END IF;
        INSERT INTO public.salon_movimientos(cliente_id,cita_id,tipo,antes,despues,revierte_id,actor)
        VALUES(v_cliente,v_id,CASE WHEN v_conflicto THEN 'revision_manual' ELSE 'reversion' END,
          v_antes,v_despues,v_mov.id,v_actor);
      END IF;
      UPDATE public.clientas SET visitas=v_despues WHERE id=v_cliente;
    END IF;
    v_resultado := jsonb_build_object('id',v_id,'visitas',v_despues,'aviso',v_aviso);

  ELSIF p_tipo='ajustar_sellos' THEN
    v_cliente := (p_datos->>'cliente_id')::uuid;
    SELECT COALESCE(visitas,0) INTO v_antes FROM public.clientas WHERE id=v_cliente FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La clienta ya no existe'; END IF;
    IF v_antes IS DISTINCT FROM (p_datos->>'antes')::integer THEN
      RAISE EXCEPTION 'La tarjeta cambio en otra sesion. Actualiza la lista';
    END IF;
    CASE p_datos->>'accion'
      WHEN 'sumar' THEN v_despues := LEAST(v_antes+1,10);
      WHEN 'restar' THEN v_despues := GREATEST(v_antes-1,0);
      WHEN 'reiniciar' THEN v_despues := 0;
      WHEN 'canjear' THEN
        IF v_antes <> 10 THEN RAISE EXCEPTION 'El regalo requiere diez sellos'; END IF;
        v_despues := 0;
      ELSE RAISE EXCEPTION 'Ajuste desconocido';
    END CASE;
    INSERT INTO public.salon_movimientos(cliente_id,tipo,antes,despues,actor)
    VALUES(v_cliente,p_datos->>'accion',v_antes,v_despues,v_actor);
    UPDATE public.clientas SET visitas=v_despues WHERE id=v_cliente;
    v_resultado := jsonb_build_object('visitas',v_despues);

  ELSIF p_tipo='eliminar_clienta' THEN
    v_cliente := (p_datos->>'cliente_id')::uuid;
    DELETE FROM public.clientas WHERE id=v_cliente;
    IF NOT FOUND THEN RAISE EXCEPTION 'La clienta ya no existe'; END IF;
    v_resultado := jsonb_build_object('eliminada',true);
  ELSE
    RAISE EXCEPTION 'Operacion desconocida';
  END IF;

  INSERT INTO public.salon_operaciones(id,actor,solicitud,resultado)
  VALUES(p_operacion,v_actor,v_solicitud,v_resultado);
  RETURN v_resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.salon_operar(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salon_operar(uuid,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.salon_guardar_fidelidad()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_protegida boolean := false;
BEGIN
  IF TG_TABLE_NAME='clientas' THEN
    IF TG_OP='UPDATE' THEN v_protegida := NEW.visitas IS DISTINCT FROM OLD.visitas; END IF;
  ELSIF TG_OP='INSERT' THEN
    v_protegida := NEW.estado='completada';
  ELSIF TG_OP='DELETE' THEN
    v_protegida := OLD.estado='completada';
  ELSE
    v_protegida := (NEW.estado IS DISTINCT FROM OLD.estado OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id)
      AND (COALESCE(NEW.estado='completada',false) OR COALESCE(OLD.estado='completada',false));
  END IF;
  IF v_protegida AND current_setting('salon.operacion_atomica',true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Actualiza la pagina para gestionar citas y sellos conjuntamente' USING ERRCODE='42501';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.salon_guardar_fidelidad() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_salon_fidelidad_citas ON public.citas;
CREATE TRIGGER trg_salon_fidelidad_citas BEFORE INSERT OR UPDATE OR DELETE ON public.citas
FOR EACH ROW EXECUTE FUNCTION public.salon_guardar_fidelidad();
DROP TRIGGER IF EXISTS trg_salon_fidelidad_clientas ON public.clientas;
CREATE TRIGGER trg_salon_fidelidad_clientas BEFORE UPDATE ON public.clientas
FOR EACH ROW EXECUTE FUNCTION public.salon_guardar_fidelidad();

-- Comprobacion publica de despliegue; no devuelve datos de clientas.
CREATE OR REPLACE FUNCTION public.salon_fidelidad_version()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT 1 $$;
GRANT EXECUTE ON FUNCTION public.salon_fidelidad_version() TO anon, authenticated;

-- Mantiene las correcciones de resenas preparadas en la revision anterior.
ALTER POLICY "Resenas lectura publica" ON public.resenas USING (destacada IS TRUE);
ALTER POLICY "Resenas insert clientas" ON public.resenas TO authenticated
WITH CHECK (cliente_id=auth.uid() AND EXISTS(SELECT 1 FROM public.clientas c WHERE c.id=auth.uid()));
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Fidelidad atomica instalada' AS resultado;
