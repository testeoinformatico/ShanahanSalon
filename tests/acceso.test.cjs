const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync(path.join(__dirname,'../docs/acceso-migration.sql'),'utf8');

test('access migration restricts legacy resets and creates profiles from the verified identity',async t=>{
    const db=new PGlite();t.after(()=>db.close());
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,encrypted_password text,raw_user_meta_data jsonb);
      CREATE TABLE public.clientas(id uuid PRIMARY KEY REFERENCES auth.users(id),usuario text UNIQUE NOT NULL,nombre text NOT NULL,telefono text,visitas integer DEFAULT 0);
      CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
      CREATE FUNCTION public.send_recovery_code(text) RETURNS json LANGUAGE sql AS $$ SELECT '{"ok":true}'::json $$;
      CREATE FUNCTION public.verify_recovery_code(text,text,text) RETURNS json LANGUAGE sql AS $$ SELECT '{"ok":true}'::json $$;
      CREATE FUNCTION public.send_welcome_email(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
      CREATE FUNCTION public.enviar_recordatorios_diarios() RETURNS void LANGUAGE sql AS $$ SELECT $$;
      CREATE FUNCTION public.send_password_changed_email() RETURNS void LANGUAGE sql AS $$ SELECT $$;
      INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000001','existing@example.test','unchanged','{}');
      INSERT INTO public.clientas VALUES('00000000-0000-0000-0000-000000000001','existing@example.test','Existente','000',8);`);
    await db.exec(migration);await db.exec(migration);
    for(const role of ['anon','authenticated']){
        await db.exec('SET ROLE '+role);
        for(const fn of ["verify_recovery_code('x','123456','new')","send_recovery_code('x')","send_welcome_email('x')","enviar_recordatorios_diarios()"])
            await assert.rejects(db.query('SELECT public.'+fn),e=>e.code==='42501');
        await db.exec('RESET ROLE');
    }
    const privileges=(await db.query(`SELECT has_function_privilege('anon','public.send_password_changed_email()','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.send_password_changed_email()','EXECUTE') AS authenticated,
      has_function_privilege('service_role','public.enviar_recordatorios_diarios()','EXECUTE') AS cron`)).rows[0];
    assert.deepEqual(privileges,{anon:false,authenticated:true,cron:true});
    await db.query('INSERT INTO auth.users VALUES($1,$2,$3,$4)',[
        '00000000-0000-0000-0000-000000000002',' NEW@example.test ','new-hash',
        {nombre:'  Nueva  ',telefono:' 123 ',usuario:'existing@example.test',visitas:10}]);
    const profiles=(await db.query('SELECT usuario,nombre,visitas FROM public.clientas ORDER BY usuario')).rows;
    assert.deepEqual(profiles,[{usuario:'existing@example.test',nombre:'Existente',visitas:8},{usuario:'new@example.test',nombre:'Nueva',visitas:0}]);
    assert.equal((await db.query('SELECT encrypted_password FROM auth.users WHERE email=$1',['existing@example.test'])).rows[0].encrypted_password,'unchanged');
});
