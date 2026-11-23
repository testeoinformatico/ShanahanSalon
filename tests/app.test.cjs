const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'assets/core.js'), 'utf8');
const homeMotion = fs.readFileSync(path.join(root, 'assets/home-motion.js'), 'utf8');
const liquid = fs.readFileSync(path.join(root, 'assets/liquid-background.js'), 'utf8');
const services = [
    { id: 1, grupo: 'Manicura', val: 'Manicura · Color', nombre: 'Color', dur: 75, dur_txt: '1 h 15 min', precio: '25 €', orden_grupo: 1 },
    { id: 2, grupo: 'Retirada', val: 'Suplemento retirada (de otro centro)', nombre: 'Retirada de otro centro', dur: 30, dur_txt: '+30 min', precio: '+7 €', is_extra_addon: true, orden_grupo: 2 },
    { id: 3, grupo: 'Decoraciones', val: 'Flor', nombre: 'Flor', dur: 10, dur_txt: '+10 min', precio: '+3 €', is_extras_group: true, orden_grupo: 3 }
];
const profile = { id: 'client-test', nombre: 'Clienta', telefono: '000000000', visitas: 0 };
const settle = () => new Promise(resolve => setTimeout(resolve, 25));

async function fixture(options = {}) {
    const errors = [], writes = [], operations = [];
    const activeProfile = { ...profile, ...options.profile };
    const console = new VirtualConsole();
    console.on('jsdomError', error => errors.push(error.message));
    const dom = new JSDOM(html, { url: 'https://example.test/' + (options.hash || ''), runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
    const w = dom.window;
    w.structuredClone = structuredClone;
    w.scrollTo = () => {};
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.HTMLCanvasElement.prototype.getContext = () => { throw new Error('Unexpected canvas/GPU initialization'); };
    w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
    w.ResizeObserver = class { observe() {} disconnect() {} };
    w.alert = () => {};
    w.confirm = () => true;
    w.customElements.define('lottie-player', class extends w.HTMLElement { seek() {} play() {} });
    if (options.fakeAdmin) w.sessionStorage.setItem('adminAuth', 'true');
    const user = { id:profile.id, email:'clienta@example.test',user_metadata:{nombre:'Clienta',telefono:'000000000'} };
    let session = options.session ? { user } : null;
    let callback;
    const client = {
        auth: {
            getSession: async () => ({ data: { session }, error: null }),
            onAuthStateChange: cb => { callback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
            signInWithPassword: async () => { session = { user }; return { data: session, error: null }; },
            getUser: async () => ({data:{user:options.currentUser || session?.user},error:null}),
            signOut: async () => { session = null; callback?.('SIGNED_OUT'); return { error: null }; }
        },
        from(table) {
            let mutation = null, payload, single = false;
            const query = {
                select() { return query; }, eq() { return query; }, neq() { return query; }, order() { return query; }, limit() { return query; },
                maybeSingle() { single = true; return query; }, single() { single = true; return query; },
                insert(value) { mutation = 'insert'; payload = value; return query; },
                update(value) { mutation = 'update'; payload = value; return query; },
                delete() { mutation = 'delete'; return query; },
                then(resolve, reject) {
                    if (mutation) writes.push({ table, mutation, payload });
                    if (table === 'clientas' && single && !mutation && options.profileRead) return Promise.resolve(options.profileRead()).then(resolve,reject);
                    const error = table === 'dias_disponibles' && options.failAvailability ? { message: 'offline' }
                        : mutation && options.failWrites ? { message: 'write rejected' } : null;
                    const data = table === 'servicios' ? (options.services || services) : table === 'clientas' ? (single ? activeProfile : [activeProfile])
                        : table === 'admins' ? (single ? (options.admin ? {id:profile.id} : null) : [])
                        : table === 'dias_disponibles' ? (options.blocks || [])
                        : table === 'citas' && !mutation ? (options.appointments || []) : mutation ? { id: 1 } : [];
                    return Promise.resolve({ data, error }).then(resolve, reject);
                }
            };
            return query;
        },
        rpc: async (name,args) => {
            if (name === 'salon_leer_horario') return options.failSchedule ? {error:{message:'offline',code:options.scheduleErrorCode}} : {data:options.schedule || require('../assets/core.js').defaultSchedule(),error:null};
            if (name === 'salon_operar') {
                operations.push(args);
                return options.operation ? options.operation(args,operations.length) : {data:{id:1,visitas:1},error:null};
            }
            return { data: [], error: options.failOccupancy ? { message: 'offline' } : null };
        },
        storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) }
    };
    w.supabase = { createClient: () => client };
    w.eval(core);
    w.eval(app + '\n' + fs.readFileSync(path.join(root,'assets/schedule-editor.js'),'utf8'));
    w.eval(homeMotion);
    w.eval(liquid);
    await settle();
    return { w, dom, errors, writes, client, operations, emitAuth(event,next) {
        if (next !== undefined) session = next;
        callback?.(event,session);
    } };
}

test('app renders catalog and navigates without a GPU context when reduced motion is enabled', async t => {
    const f = await fixture({ hash: '#precios' }); t.after(() => f.dom.window.close());
    assert.deepEqual(f.errors, []);
    assert.equal(f.w.document.getElementById('gl'), null);
    assert.equal(f.w.document.getElementById('liquidBackground').hidden, true);
    assert.equal(f.w.document.getElementById('vistaPrecios').style.display, 'flex');
    assert.match(f.w.document.getElementById('publicServicioGrid').textContent, /25 €/);
    f.w.mostrarVista('vistaResenas');
    assert.equal(f.w.location.hash, '#resenas');
    f.w.history.back(); await settle();
    assert.equal(f.w.document.getElementById('vistaPrecios').style.display, 'flex');
});

test('failed availability never displays reservable times', async t => {
    const f = await fixture({ hash: '#reservar', failAvailability: true }); t.after(() => f.dom.window.close());
    assert.equal(f.w.document.querySelectorAll('.time-slot:not([disabled])').length, 0);
    assert.match(f.w.document.getElementById('timeSlots').textContent, /No se pudo verificar/);
    assert.doesNotMatch(f.w.document.getElementById('latHuecosCuerpo').textContent, /Estos días están completos/);
    assert.deepEqual(f.writes, []);
});

test('stored admin UI flag grants no admin view', async t => {
    const f = await fixture({ hash: '#salon', fakeAdmin: true }); t.after(() => f.dom.window.close());
    assert.equal(f.w.document.getElementById('vistaAdmin').style.display, 'none');
    assert.equal(f.w.document.getElementById('vistaAccesoAdmin').style.display, 'flex');
});

test('root opens the homepage while keeping the authenticated customer session', async t => {
    const f = await fixture({ session: true }); t.after(() => f.dom.window.close());
    assert.equal(f.w.document.getElementById('login').style.display, 'flex');
    assert.equal(f.w.document.getElementById('vistaCliente').style.display, 'none');
    assert.equal(f.w.location.hash, '');
    assert.equal(f.w.document.getElementById('clienteNombre').textContent, 'Clienta');
    f.w.mostrarVista('vistaCliente');
    await settle();
    assert.equal(f.w.document.getElementById('vistaCliente').style.display, 'flex');
    assert.deepEqual(f.errors, []);
});

test('root opens the homepage for a saved admin session too', async t => {
    const f=await fixture({session:true,admin:true});t.after(()=>f.dom.window.close());
    assert.equal(f.w.document.getElementById('login').style.display,'flex');
    assert.equal(f.w.document.getElementById('vistaAdmin').style.display,'none');
    assert.equal(f.w.location.hash,'');
    f.w.mostrarVista('vistaAdmin');
    await settle();
    assert.equal(f.w.document.getElementById('vistaAdmin').style.display,'block');
});

test('explicit account and admin links still open their requested destination', async t => {
    for (const [hash,admin,id] of [['#mi-cuenta',false,'vistaCliente'],['#salon',true,'vistaAdmin']]) {
        const f=await fixture({session:true,admin,hash});t.after(()=>f.dom.window.close());
        assert.equal(f.w.document.getElementById(id).style.display,admin?'block':'flex');
        assert.equal(f.w.location.hash,hash);
    }
});

async function loginFixture(w) {
    w.document.getElementById('loginUsuario').value='clienta@example.test';
    w.document.getElementById('loginPass').value='test-only';
    await w.iniciarSesionCliente();
    await settle();
}
test('missing profile is completed explicitly using the authenticated identity, without loyalty writes',async t=>{
    let row=null;
    const f=await fixture({profileRead:()=>({data:row,error:null})}); t.after(()=>f.dom.window.close());
    await loginFixture(f.w);
    assert.equal(f.w.document.getElementById('completarFicha').hidden,false);
    assert.deepEqual(f.writes,[]);
    let reads=0;
    const from=f.client.from.bind(f.client);
    f.client.from=table=>{
        const q=from(table);
        if(table==='clientas'){ const insert=q.insert; q.insert=p=>{row={...p,visitas:0};reads++;return insert(p);}; }
        return q;
    };
    await Promise.all([f.w.guardarFichaPropia(),f.w.guardarFichaPropia()]);await settle();
    assert.equal(reads,1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.writes[0].payload)),{id:profile.id,usuario:'clienta@example.test',nombre:'Clienta',telefono:'000000000'});
    assert.equal(f.w.document.getElementById('vistaCliente').style.display,'flex');
});
test('profile read failure is retried without treating a database error as a missing record',async t=>{
    let calls=0;
    const f=await fixture({profileRead:()=>{calls++;return {status:503,error:{message:'unavailable'}};}});t.after(()=>f.dom.window.close());
    await loginFixture(f.w);
    assert.equal(calls,2);assert.equal(f.w.document.getElementById('completarFicha').hidden,true);
    assert.match(f.w.document.body.textContent,/no se pudo consultar tu ficha/i);assert.deepEqual(f.writes,[]);
});
test('profile appearing in another tab keeps its stamps and is never overwritten',async t=>{
    let row=null;
    const f=await fixture({profileRead:()=>({data:row,error:null})});t.after(()=>f.dom.window.close());
    await loginFixture(f.w);row={...profile,visitas:8};
    await f.w.guardarFichaPropia();await settle();
    assert.deepEqual(f.writes,[]);assert.equal(f.w.document.getElementById('stampCountText').textContent,'8');
});
test('changed identity cannot create a profile under the previous login',async t=>{
    const f=await fixture({profileRead:()=>({data:null,error:null}),currentUser:{id:'different',email:'other@example.test'}});t.after(()=>f.dom.window.close());
    await loginFixture(f.w);await f.w.guardarFichaPropia();
    assert.deepEqual(f.writes,[]);assert.equal(f.w.document.getElementById('completarFicha').hidden,true);
});
test('guest keeps selected service, day and hour when signing in', async t => {
    const f = await fixture(); t.after(() => f.dom.window.close());
    const date = new Date(); date.setDate(date.getDate() + 2);
    const iso = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    f.w.reservarHueco(iso, '09:00'); await settle();
    const option = f.w.document.querySelector('#servicioGrid .servicio-opcion');
    f.w.selSrvAcc('Manicura · Color', 75, 25, 'Manicura', option);
    await f.w.enviarReserva();
    assert.match(f.w.document.getElementById('loginTitulo').textContent, /reservar/i);
    f.w.document.getElementById('loginUsuario').value = 'test@example.test';
    f.w.document.getElementById('loginPass').value = 'test-only';
    await f.w.iniciarSesionCliente(); await settle();
    assert.equal(f.w.document.getElementById('vistaReservar').style.display, 'flex');
    assert.equal(f.w.document.getElementById('pickedTimeLabel').textContent, '09:00 h');
    assert.match(f.w.document.getElementById('pickedServiceLabel').textContent, /Color/);
    assert.deepEqual(f.writes, []);
});

test('failed database writes reject the checked operation', async t => {
    const f = await fixture({ failWrites: true }); t.after(() => f.dom.window.close());
    await assert.rejects(f.w.checked(f.client.from('clientas').update({ visitas: 1 }).eq('id', 'test').select('id').single()), error => error.message === 'write rejected');
});

test('booking submits the withdrawal price and duration from the catalog', async t => {
    const f = await fixture({ session: true }); t.after(() => f.dom.window.close());
    const date = new Date(); date.setDate(date.getDate() + 2);
    const iso = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    f.w.reservarHueco(iso, '09:00'); await settle();
    f.w.selSrvAcc('Manicura · Color', 75, 25, 'Manicura', f.w.document.querySelector('#servicioGrid .servicio-opcion'));
    const saving = f.w.enviarReserva();
    assert.match(f.w.document.getElementById('retiradaOtroLabel').textContent, /7 € \/ \+30 min/);
    f.w.resolverRetirada('otro');
    await saving;
    const booking = f.writes.find(write => write.table === 'citas').payload[0];
    assert.equal(booking.precio, 32);
    assert.equal(booking.duracion_minutos, 105);
    assert.equal(booking.fecha, iso);
    assert.equal(booking.hora, '09:00');
    assert.equal(booking.cliente_id, profile.id);
    assert.deepEqual(f.errors, []);
});

test('failed occupancy lookup leaves all time slots unavailable', async t => {
    const f = await fixture({ failOccupancy: true }); t.after(() => f.dom.window.close());
    const date = new Date(); date.setDate(date.getDate() + 2);
    const iso = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    f.w.reservarHueco(iso, '09:00'); await settle();
    f.w.selSrvAcc('Manicura · Color', 75, 25, 'Manicura', f.w.document.querySelector('#servicioGrid .servicio-opcion'));
    assert.equal(f.w.document.querySelectorAll('.time-slot:not([disabled])').length, 0);
    assert.deepEqual(f.writes, []);
});

const exampleAppointment = {id:42,cliente_id:profile.id,nombre_cliente:'Clienta',telefono:'000000000',
    fecha:'2030-01-01',hora:'09:00:00',duracion_minutos:75,precio:25,servicio:'Manicura · Color',estado:'confirmada'};

test('admin completion sends one atomic operation for double clicks and never writes stamps directly', async t => {
    const f=await fixture({admin:true,session:true,appointments:[exampleAppointment]}); t.after(()=>f.dom.window.close());
    await f.w.cargarDatosAdmin();
    await Promise.all([f.w.completarCita(42),f.w.completarCita(42)]);
    assert.equal(f.operations.length,1);
    assert.equal(f.operations[0].p_tipo,'guardar_cita');
    assert.equal(f.operations[0].p_datos.antes.id,42);
    assert.equal(f.operations[0].p_datos.cita.estado,'completada');
    assert.deepEqual(f.writes,[]);
});

test('lost network response keeps the same idempotency key on retry', async t => {
    const f=await fixture({operation:async(args,n)=> n===1 ? {error:{message:'Failed to fetch'}} : {data:{id:42},error:null}});
    t.after(()=>f.dom.window.close());
    const request={id:42,cita:{estado:'completada'}};
    await assert.rejects(f.w.operacionSalon('guardar_cita',request));
    await f.w.operacionSalon('guardar_cita',request);
    assert.equal(f.operations.length,2);
    assert.equal(f.operations[0].p_operacion,f.operations[1].p_operacion);
    assert.deepEqual(f.writes,[]);
});

test('ambiguous legacy reversal asks before preserving the card', async t => {
    const f=await fixture({operation:async(args,n)=>n===1 ? {error:{hint:'CONFIRMAR_SIN_SELLO',message:'Revisar tarjeta antigua'}} : {data:{id:42},error:null}});
    t.after(()=>f.dom.window.close());
    const pending=f.w.operacionSalon('eliminar_cita',{id:42});
    await settle();
    assert.match(f.w.document.getElementById('confirmMsg').textContent,/tarjeta antigua/);
    assert.equal(f.operations.length,1);
    f.w.closeConfirm(true);
    await pending;
    assert.equal(f.operations[1].p_datos.conservar_sellos,true);
    assert.deepEqual(f.writes,[]);
});

test('full card shows redemption and requires confirmation', async t => {
    const f=await fixture({admin:true,session:true,profile:{visitas:10}}); t.after(()=>f.dom.window.close());
    await f.w.cargarDatosAdmin();
    assert.match(f.w.document.body.textContent,/Canjear regalo/);
    const pending=f.w.canjearRegalo(profile.id);
    await settle();
    assert.equal(f.operations.length,0);
    f.w.closeConfirm(true);
    await pending;
    assert.equal(f.operations[0].p_tipo,'ajustar_sellos');
    assert.equal(f.operations[0].p_datos.accion,'canjear');
    assert.equal(f.operations[0].p_datos.antes,10);
    assert.deepEqual(f.writes,[]);
});

test('manual guest selection creates no invalid Auth profile',async t=>{
    const f=await fixture(); t.after(()=>f.dom.window.close());
    f.w.document.getElementById('ncNewNombre').value='Invitada';
    f.w.document.getElementById('ncNewTelef').value='000000001';
    await f.w.ncCrearYUsarCliente();
    assert.equal(f.w.document.getElementById('ncScName').textContent,'Invitada');
    assert.deepEqual(f.writes,[]);
});

test('admin confirms blocked off-hours booking; cancellation sends nothing; exact manual time is retained',async t=>{
    const f=await fixture({admin:true,session:true,blocks:[{tipo:'dia_bloqueado',valor:'2030-01-06'}]});
    t.after(()=>f.dom.window.close());
    await f.w.cargarDatosAdmin();
    f.w.abrirNuevaCita('2030-01-06','07:10');
    f.w.ncSetClient(profile);
    f.w.document.querySelector('#ncServicioGrid .nc-servicio-opcion:not(.nc-extra-addon)').click();
    let pending=f.w.guardarNuevaCita(); await settle();
    assert.match(f.w.document.getElementById('confirmMsg').textContent,/excepcional/);
    f.w.closeConfirm(false); await pending;
    assert.equal(f.operations.length,0);
    pending=f.w.guardarNuevaCita(); await settle(); f.w.closeConfirm(true); await pending;
    assert.equal(f.operations.length,1);
    assert.equal(f.operations[0].p_datos.cita.hora,'07:10');
    assert.equal(f.operations[0].p_datos.cita.fecha,'2030-01-06');
});

test('non-admin cannot use manual booking; failed schedule load closes public calendar',async t=>{
    const f=await fixture({session:true,failSchedule:true});t.after(()=>f.dom.window.close());
    f.w.abrirNuevaCita(); await f.w.guardarNuevaCita();
    assert.equal(f.operations.length,0);
    assert.equal(f.w.isDiaDisponible('2030-01-01'),false);
});

test('public slots follow custom hours and editor validates without writing invalid ranges',async t=>{
    const schedule=require('../assets/core.js').defaultSchedule();schedule.semana[2]=[[480,600]];schedule.paso=15;
    const f=await fixture({admin:true,session:true,schedule});t.after(()=>f.dom.window.close());
    f.w.reservarHueco('2030-01-01','08:00'); await settle();
    f.w.selSrvAcc('Manicura · Color',75,25,'Manicura',f.w.document.querySelector('#servicioGrid .servicio-opcion'));
    f.w.renderTimeSlots();
    assert.deepEqual([...f.w.document.querySelectorAll('#timeSlots .time-slot')].map(el=>el.dataset.time),['08:00','08:15','08:30','08:45','09:00','09:15','09:30','09:45']);
    f.w.renderHorarioEditor();
    assert.equal(f.w.document.querySelectorAll('[data-schedule-key]').length,7);
    f.w.document.querySelector('[data-end]').value='07:00';
    await f.w.guardarHorarioSalon();
    assert.equal(f.operations.length,0);
});

test('missing schedule RPC keeps reservations closed instead of inventing default hours',async t=>{
    const f=await fixture({failSchedule:true,scheduleErrorCode:'PGRST202'});t.after(()=>f.dom.window.close());
    assert.equal(f.w.isDiaDisponible('2030-01-01'),false);
});

test('reactivating a cancelled appointment in closed hours requires confirmation',async t=>{
    const cita={id:71,cliente_id:profile.id,nombre_cliente:profile.nombre,telefono:profile.telefono,
        fecha:'2030-01-06',hora:'07:10:00',duracion_minutos:30,servicio:'Color',precio:25,estado:'cancelada'};
    const f=await fixture({session:true,admin:true,appointments:[cita]});t.after(()=>f.dom.window.close());
    await f.w.cargarDatosAdmin();
    f.w.abrirEditarCita(71);f.w.setEditEstado('confirmada');
    const saving=f.w.guardarEdicionCita();await settle();
    const writesBeforeConfirmation=f.operations.length;
    f.w.closeConfirm(false);await saving;
    assert.equal(writesBeforeConfirmation,0);
    assert.equal(f.operations.length,0);
});

test('hour blocks show their full 30-minute coverage and detect partial appointment overlaps',async t=>{
    const date=new Date(),iso=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const schedule=require('../assets/core.js').defaultSchedule();schedule.paso=15;
    const f=await fixture({session:true,admin:true,schedule,blocks:[{id:1,tipo:'hora_bloqueada',valor:iso+'T09:00'}],
        appointments:[{id:72,fecha:iso,hora:'10:10:00',duracion_minutos:30,estado:'confirmada'}]});
    t.after(()=>f.dom.window.close());await f.w.cargarDatosAdmin();
    f.w.document.querySelector(`#hCalGrid [data-iso="${iso}"]`).click();
    const button=time=>f.w.document.querySelector(`#horasSlotsManana [data-t="${time}"]`);
    assert.equal(button('09:00').disabled,false);
    assert.equal(button('09:15').disabled,true);
    assert.match(button('09:15').textContent,/BLOQUEADA/);
    assert.equal(button('09:30').disabled,false);
    assert.equal(button('10:00').disabled,true);
});

test('reactivation checks fresh occupancy and never writes over another appointment',async t=>{
    const cancelled={id:71,fecha:'2030-01-01',hora:'09:00:00',duracion_minutos:30,estado:'cancelada'};
    const occupied={id:72,fecha:'2030-01-01',hora:'09:15:00',duracion_minutos:30,estado:'confirmada'};
    const f=await fixture({session:true,admin:true,appointments:[cancelled,occupied]});t.after(()=>f.dom.window.close());
    await f.w.cargarDatosAdmin();await f.w.cambiarEstadoCita(71,'confirmada');
    assert.equal(f.operations.length,0);
    assert.match(f.w.document.body.textContent,/coincide con otra cita/);
});

test('concurrent appointment conflict gives a usable message without leaking SQL details',async t=>{
    const f=await fixture({session:true,admin:true,operation:()=>({error:{code:'23P01',message:'exclusion constraint citas_sin_solapamientos'}})});
    t.after(()=>f.dom.window.close());
    await assert.rejects(f.w.guardarCitaSalon(null,{fecha:'2030-01-01',hora:'09:00'}),/se acaba de ocupar/);
});

test('recovery uses Supabase Auth and failed delivery never shows the success step',async t=>{
    const f=await fixture();t.after(()=>f.dom.window.close());
    let calls=0;let finish;
    f.client.auth.resetPasswordForEmail=email=>{calls++;assert.equal(email,'clienta@example.test');return new Promise(resolve=>finish=resolve);};
    f.w.document.getElementById('loginUsuario').value=' Clienta@Example.test ';
    f.w.solicitarRecuperacion();
    const pending=f.w.enviarRecuperacion();await f.w.enviarRecuperacion();
    assert.equal(calls,1);finish({error:{status:429,code:'over_email_send_rate_limit'}});await pending;
    assert.equal(f.w.document.getElementById('recoveryStep2').style.display,'none');
    assert.match(f.w.document.body.textContent,/Espera un minuto/);
    f.client.auth.resetPasswordForEmail=async()=>({error:null});
    await f.w.enviarRecuperacion();
    assert.equal(f.w.document.getElementById('recoveryStep2').style.display,'block');
    assert.equal(f.w.verificarCodigoRecuperacion,undefined);
    assert.deepEqual(f.writes,[]);
});

test('ordinary account password changes preserve spaces, survive notification failure and keep the session',async t=>{
    const f=await fixture({session:true,hash:'#mi-cuenta'});t.after(()=>f.dom.window.close());
    let updates=0,signouts=0;
    f.client.auth.updateUser=async args=>{updates++;assert.equal(args.password,'  valid-password  ');return {data:{user:{email:'clienta@example.test'}},error:null};};
    f.client.auth.signOut=async()=>{signouts++;return {error:null};};
    f.client.rpc=async()=>{throw Error('notification service unavailable');};
    f.w.document.getElementById('inputNuevaClave').value='  valid-password  ';
    f.w.document.getElementById('inputNuevaClaveConfirm').value='different';
    await f.w.procesarCambioClave();assert.equal(updates,0);
    f.w.document.getElementById('inputNuevaClaveConfirm').value='  valid-password  ';
    await Promise.all([f.w.procesarCambioClave(),f.w.procesarCambioClave()]);
    assert.equal(updates,1);assert.equal(signouts,0);
    assert.equal(f.w.document.getElementById('inputNuevaClave').value,'');
    assert.equal(f.w.document.getElementById('modalClaveOk').classList.contains('show'),true);
});

test('recovery event works without a URL hash and closes only the recovery session after saving',async t=>{
    const f=await fixture({session:true});t.after(()=>f.dom.window.close());
    f.emitAuth('PASSWORD_RECOVERY');await settle();
    assert.equal(f.w.document.getElementById('modalCambiarClave').classList.contains('show'),true);
    let signout;
    f.client.auth.updateUser=async()=>({data:{user:{email:'clienta@example.test'}},error:null});
    f.client.auth.signOut=async args=>{signout=args;f.emitAuth('SIGNED_OUT',null);return {error:null};};
    f.w.document.getElementById('inputNuevaClave').value='new-password';
    f.w.document.getElementById('inputNuevaClaveConfirm').value='new-password';
    await f.w.procesarCambioClave();await settle();
    assert.equal(signout.scope,'local');
    assert.equal(f.w.document.getElementById('loginUsuario').value,'clienta@example.test');
    assert.equal(f.w.document.getElementById('modalClaveOk').classList.contains('show'),true);
});

test('login failures distinguish invalid credentials and unconfirmed email; resending opens verification',async t=>{
    const f=await fixture();t.after(()=>f.dom.window.close());
    f.client.auth.signInWithPassword=async()=>({error:{code:'invalid_credentials'}});
    await loginFixture(f.w);
    assert.match(f.w.document.body.textContent,/Correo o contraseña incorrectos/);
    assert.equal(f.w.document.getElementById('confirmacionPendiente').hidden,true);
    f.client.auth.signInWithPassword=async()=>({error:{code:'email_not_confirmed'}});
    await loginFixture(f.w);
    assert.equal(f.w.document.getElementById('confirmacionPendiente').hidden,false);
    let resend;
    f.client.auth.resend=async args=>{resend=args;return {error:null};};
    await f.w.reenviarConfirmacion(true);
    assert.equal(resend.type,'signup');assert.equal(resend.email,'clienta@example.test');
    assert.equal(f.w.document.getElementById('regStepOTP').style.display,'block');
});

test('admin login passes the exact password and prevents simultaneous submissions',async t=>{
    const f=await fixture({admin:true});t.after(()=>f.dom.window.close());
    let calls=0,finish;
    f.client.auth.signInWithPassword=args=>{calls++;assert.equal(args.email,'salon@example.test');assert.equal(args.password,' space-password ');return new Promise(resolve=>finish=resolve);};
    f.w.document.getElementById('adminUser').value=' Salon@Example.test ';
    f.w.document.getElementById('adminPass').value=' space-password ';
    const pending=f.w.loginAdmin();await f.w.loginAdmin();
    assert.equal(calls,1);finish({data:{user:{id:profile.id}},error:null});await pending;await settle();
    assert.equal(f.w.document.getElementById('vistaAdmin').style.display,'block');
});

function fillRegistration(w) {
    for(const [id,value] of Object.entries({citaNombre:'Clienta',citaTelefono:'000000000',citaEmail:'clienta@example.test',citaClave:'test-password',citaClaveConfirm:'test-password'}))w.document.getElementById(id).value=value;
    w.document.getElementById('aceptoPrivacidad').checked=true;
}

test('duplicate signup response never claims an email was sent',async t=>{
    const f=await fixture();t.after(()=>f.dom.window.close());fillRegistration(f.w);
    f.client.auth.signUp=async()=>({data:{user:{identities:[]},session:null},error:null});
    await f.w.crearCuenta();
    assert.equal(f.w.document.getElementById('regStepOTP').style.display,'none');
    assert.match(f.w.document.getElementById('regErrorMsg').textContent,/No necesitas crear otra/);
});

test('six-digit registration code and repeat clicks verify once using the original email',async t=>{
    const f=await fixture({session:true});t.after(()=>f.dom.window.close());fillRegistration(f.w);
    f.client.auth.signUp=async()=>({data:{user:{id:profile.id,identities:[{}]},session:null},error:null});
    await f.w.crearCuenta();
    f.w.document.getElementById('citaEmail').value='different@example.test';
    const inputs=[...f.w.document.querySelectorAll('#regOtpContainer .otp-digit')];
    inputs.forEach((input,i)=>input.value=i<6?String(i):'');
    let calls=0,finish;
    f.client.auth.verifyOtp=args=>{calls++;assert.equal(args.email,'clienta@example.test');assert.equal(args.token,'012345');return new Promise(resolve=>finish=resolve);};
    const pending=f.w.verificarRegistroOTP();await f.w.verificarRegistroOTP();
    assert.equal(calls,1);finish({data:{},error:null});await pending;
    assert.equal(f.w.document.getElementById('vistaCliente').style.display,'flex');
    assert.equal(f.w.document.getElementById('modalRegistroOk').classList.contains('show'),true);
});

test('signup with an immediate session does not ask for an impossible confirmation code',async t=>{
    const f=await fixture({session:true});t.after(()=>f.dom.window.close());fillRegistration(f.w);
    f.client.auth.signUp=async()=>({data:{user:{id:profile.id,identities:[{}]},session:{user:{id:profile.id}}},error:null});
    await f.w.crearCuenta();
    assert.equal(f.w.document.getElementById('regStepOTP').style.display,'none');
    assert.equal(f.w.document.getElementById('vistaCliente').style.display,'flex');
});

test('signing out while the profile loads cannot restore the previous account',async t=>{
    let finish;
    const f=await fixture({profileRead:()=>new Promise(resolve=>finish=resolve)});t.after(()=>f.dom.window.close());
    const pending=loginFixture(f.w);await settle();
    f.emitAuth('SIGNED_OUT',null);
    finish({data:profile,error:null});await pending;await settle();
    assert.equal(f.w.document.getElementById('vistaCliente').style.display,'none');
    assert.equal(f.w.document.getElementById('clienteNombre').textContent,'');
});

test('expired recovery links produce a useful message and are removed from the URL',async t=>{
    const f=await fixture({hash:'#error=access_denied&error_code=otp_expired'});t.after(()=>f.dom.window.close());
    assert.match(f.w.document.body.textContent,/Solicita uno nuevo/);
    assert.equal(f.w.location.hash,'');
});

test('a failed password update keeps the form open without success or signout',async t=>{
    const f=await fixture({session:true});t.after(()=>f.dom.window.close());
    f.emitAuth('PASSWORD_RECOVERY');await settle();
    let signouts=0;
    f.client.auth.updateUser=async()=>({error:{code:'weak_password'}});
    f.client.auth.signOut=async()=>{signouts++;return {error:null};};
    f.w.document.getElementById('inputNuevaClave').value='test-password';
    f.w.document.getElementById('inputNuevaClaveConfirm').value='test-password';
    await f.w.procesarCambioClave();
    assert.equal(signouts,0);
    assert.equal(f.w.document.getElementById('modalCambiarClave').classList.contains('show'),true);
    assert.equal(f.w.document.getElementById('modalClaveOk').classList.contains('show'),false);
});

test('a sign-in from another tab clears the previous profile and loads the new identity',async t=>{
    let row={...profile,visitas:8};
    const f=await fixture({session:true,hash:'#mi-cuenta',profileRead:()=>({data:row,error:null})});t.after(()=>f.dom.window.close());
    row={id:'another-client',nombre:'Nueva clienta',telefono:'111111111',visitas:2};
    f.emitAuth('SIGNED_IN',{user:{id:row.id,email:'other@example.test'}});
    assert.equal(f.w.document.getElementById('clienteNombre').textContent,'');
    await settle();
    assert.equal(f.w.document.getElementById('clienteNombre').textContent,'Nueva clienta');
    assert.equal(f.w.document.getElementById('stampCountText').textContent,'2');
    assert.deepEqual(f.errors,[]);
});

test('appointment service editor treats catalog group names as text', async t => {
    const group = '<img src=x onerror="window.catalogInjected=true">';
    const f = await fixture({ session: true, admin: true, services: [{ ...services[0], grupo: group }], appointments: [
        { id: 81, cliente_id: profile.id, fecha: '2030-01-01', hora: '10:00:00', estado: 'pendiente', servicio: 'Color', duracion_minutos: 75 }
    ] });
    t.after(() => f.dom.window.close());
    await f.w.cargarDatosAdmin();
    f.w.abrirEditarCita(81);
    f.w.edToggleServicios();
    const grid = f.w.document.getElementById('editServicioGrid');
    assert.equal(grid.querySelector('img'), null);
    assert.ok(grid.textContent.includes(group));
    assert.equal(grid.querySelectorAll('.nc-servicio-opcion').length, 1);
});
