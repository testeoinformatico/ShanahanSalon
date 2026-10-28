const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const core=require('../assets/core.js');
const migration=fs.readFileSync(path.join(__dirname,'../docs/horarios-migration.sql'),'utf8');
const fix=fs.readFileSync(path.join(__dirname,'../docs/configuracion-fix.sql'),'utf8');

test('weekly ranges, special dates, interval generation and invalid schedules',()=>{
    const s=core.defaultSchedule(); s.semana[2]=[[480,720],[840,1080]]; s.semana[0]=[]; s.paso=15;
    s.excepciones['2030-01-02']=[[600,660]];
    assert.equal(core.validSchedule(s),true);
    assert.equal(core.outsideHours('08:00',60,'2030-01-01',s),false);
    assert.equal(core.outsideHours('11:30',60,'2030-01-01',s),true);
    assert.deepEqual(core.daySlots('2030-01-02',s),['10:00','10:15','10:30','10:45']);
    assert.equal(core.daySlots('2030-01-06',s).length,0);
    for (const ranges of [[[600,590]],[[600,700],[650,720]],[[600,1441]],[[600.5,700]]]) {
        const invalid=structuredClone(s); invalid.semana[1]=ranges;
        assert.equal(core.validSchedule(invalid),false);
    }
    s.excepciones['2030-02-30']=[]; assert.equal(core.validSchedule(s),false);
});

test('database schedule, admin exceptions and notification search path repair',async t=>{
    const db=new PGlite(); t.after(()=>db.close());
    const admin='00000000-0000-0000-0000-000000000001',client='00000000-0000-0000-0000-000000000002';
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO anon,authenticated;
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid()='${admin}'::uuid $$;
      CREATE TABLE public.dias_disponibles(tipo text,valor text);
      CREATE TABLE public.citas(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,fecha date,hora time,duracion_minutos integer,estado text,nombre_cliente text);
      ALTER TABLE public.citas ADD CONSTRAINT no_overlap EXCLUDE USING gist (tsrange(fecha+hora,fecha+hora+make_interval(mins=>duracion_minutos),'[)') WITH &&) WHERE (estado<>'cancelada');
      GRANT SELECT,INSERT,UPDATE ON public.citas TO authenticated; GRANT USAGE ON SEQUENCE public.citas_id_seq TO authenticated;
      CREATE TABLE public.configuracion(clave text PRIMARY KEY,valor text);
      INSERT INTO public.configuracion VALUES ('notif_email','salon@example.test');
      CREATE FUNCTION public.enviar_correos_nueva_cita() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
        DECLARE email text; BEGIN SELECT valor INTO email FROM configuracion WHERE clave='notif_email'; RETURN NEW; END $$;
      CREATE TRIGGER trigger_nueva_cita AFTER INSERT ON public.citas FOR EACH ROW EXECUTE FUNCTION public.enviar_correos_nueva_cita();
      CREATE FUNCTION public.test_atomic_insert() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
        BEGIN INSERT INTO public.citas(fecha,hora,duracion_minutos,estado) VALUES ('2030-01-10','09:00',30,'confirmada'); END $$;`);
    await db.exec(migration); await db.exec(migration);
    async function session(actor,fn,role='authenticated') {
        await db.exec('BEGIN');
        try {
            await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor||'']);
            await db.exec('SET LOCAL ROLE '+role); const result=await fn(); await db.exec('COMMIT'); return result;
        } catch(e) {await db.exec('ROLLBACK');throw e;}
    }
    const insert=(actor,date,time,duration=30)=>session(actor,()=>db.query("INSERT INTO public.citas(fecha,hora,duracion_minutos,estado) VALUES($1,$2,$3,'confirmada')",[date,time,duration]));
    const read=async()=>(await session(null,()=>db.query('SELECT public.salon_leer_horario() AS h'),'anon')).rows[0].h;
    const save=(actor,h,prior)=>session(actor,()=>db.query('SELECT public.salon_guardar_horario($1,$2)',[h,prior]));
    await t.test('same missing relation error is repaired without changing notification code',async()=>{
        await assert.rejects(session(admin,()=>db.query('SELECT public.test_atomic_insert()')),/configuracion.*does not exist/);
        await db.exec(fix); await db.exec(fix);
        await session(admin,()=>db.query('SELECT public.test_atomic_insert()'));
        assert.equal((await db.query("SELECT valor FROM public.configuracion WHERE clave='notif_email'")).rows[0].valor,'salon@example.test');
    });
    const initial=await read(),custom=core.defaultSchedule();
    custom.semana[2]=[[480,720],[840,1080]];custom.semana[0]=[]; custom.paso=15;
    custom.excepciones['2030-01-02']=[[600,660]];
    await t.test('public reads hours; only admin can save; stale edits rejected',async()=>{
        assert.deepEqual(initial,core.defaultSchedule());
        await assert.rejects(save(client,custom,initial),e=>e.code==='42501');
        await assert.rejects(session(client,()=>db.query("UPDATE public.salon_horario SET datos='{}'")),e=>e.code==='42501');
        await save(admin,custom,initial);
        await assert.rejects(save(admin,initial,initial),/otra sesion/);
        const invalid=structuredClone(custom);invalid.semana[1]=[[600,700],[650,720]];
        await assert.rejects(save(admin,invalid,custom),/no valido/);
    });
    await t.test('client bookings respect weekly hours and date overrides',async()=>{
        await insert(client,'2030-01-01','08:00');
        await assert.rejects(insert(client,'2030-01-01','11:45',30),/fuera del horario/);
        await assert.rejects(insert(client,'2030-01-02','09:00'),/fuera del horario/);
        await insert(client,'2030-01-02','10:00');
        await assert.rejects(insert(client,'2030-01-06','10:00'),/fuera del horario/);
    });
    await t.test('only admins bypass day, month and partial-hour blocks and closed hours',async()=>{
        await db.exec("INSERT INTO public.dias_disponibles VALUES ('dia_bloqueado','2030-01-03'),('hora_bloqueada','2030-01-04T10:00'),('mes_bloqueado','2030-02')");
        await assert.rejects(insert(client,'2030-01-03','09:00'),/bloqueado/);
        await assert.rejects(insert(client,'2030-01-04','09:45',30),/bloqueado/);
        await assert.rejects(insert(client,'2030-02-01','09:00'),/bloqueado/);
        await insert(admin,'2030-01-03','09:00');
        await insert(admin,'2030-01-04','09:45');
        await insert(admin,'2030-02-01','09:00');
        await insert(admin,'2030-01-06','07:10');
        await assert.rejects(insert(admin,'2030-01-06','07:20'),e=>e.code==='23P01');
        await assert.rejects(insert(admin,'2030-01-06','23:50',30),/mismo dia/);
    });
    await t.test('changing hours preserves existing appointments',async()=>{
        const closed=core.defaultSchedule();closed.semana=Array.from({length:7},()=>[]);
        await save(admin,closed,custom);
        await session(admin,()=>db.query("UPDATE public.citas SET nombre_cliente='Correccion' WHERE fecha='2030-01-01'"));
        assert.equal((await db.query("SELECT count(*)::int AS n FROM public.citas WHERE fecha='2030-01-01'")).rows[0].n,1);
    });
    await t.test('reactivating cancelled appointments rechecks closed hours for clients',async()=>{
        await session(admin,()=>db.query("UPDATE public.citas SET estado='cancelada' WHERE fecha='2030-01-01'"));
        await assert.rejects(session(client,()=>db.query("UPDATE public.citas SET estado='confirmada' WHERE fecha='2030-01-01'")),/fuera del horario/);
        await session(admin,()=>db.query("UPDATE public.citas SET estado='confirmada' WHERE fecha='2030-01-01'"));
    });
});
