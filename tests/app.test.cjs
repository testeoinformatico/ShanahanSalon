const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'assets/core.js'), 'utf8');
const services = [
    { id: 1, grupo: 'Manicura', val: 'Manicura · Color', nombre: 'Color', dur: 75, dur_txt: '1 h 15 min', precio: '25 €', orden_grupo: 1 },
    { id: 2, grupo: 'Retirada', val: 'Suplemento retirada (de otro centro)', nombre: 'Retirada de otro centro', dur: 30, dur_txt: '+30 min', precio: '+7 €', is_extra_addon: true, orden_grupo: 2 },
    { id: 3, grupo: 'Decoraciones', val: 'Flor', nombre: 'Flor', dur: 10, dur_txt: '+10 min', precio: '+3 €', is_extras_group: true, orden_grupo: 3 }
];
const profile = { id: 'client-test', nombre: 'Clienta', telefono: '000000000', visitas: 0 };
const settle = () => new Promise(resolve => setTimeout(resolve, 25));

async function fixture(options = {}) {
    const errors = [], writes = [];
    const console = new VirtualConsole();
    console.on('jsdomError', error => errors.push(error.message));
    const dom = new JSDOM(html, { url: 'https://example.test/' + (options.hash || ''), runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
    const w = dom.window;
    w.scrollTo = () => {};
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
    w.ResizeObserver = class { observe() {} disconnect() {} };
    w.alert = () => {};
    w.confirm = () => true;
    w.customElements.define('lottie-player', class extends w.HTMLElement { seek() {} play() {} });
    if (options.fakeAdmin) w.sessionStorage.setItem('adminAuth', 'true');
    let session = options.session ? { user: { id: profile.id } } : null;
    let callback;
    const client = {
        auth: {
            getSession: async () => ({ data: { session }, error: null }),
            onAuthStateChange: cb => { callback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
            signInWithPassword: async () => { session = { user: { id: profile.id } }; return { data: session, error: null }; },
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
                    const error = table === 'dias_disponibles' && options.failAvailability ? { message: 'offline' }
                        : mutation && options.failWrites ? { message: 'write rejected' } : null;
                    const data = table === 'servicios' ? services : table === 'clientas' ? (single ? profile : [profile])
                        : table === 'admins' ? (single ? null : []) : mutation ? { id: 1 } : [];
                    return Promise.resolve({ data, error }).then(resolve, reject);
                }
            };
            return query;
        },
        rpc: async () => ({ data: [], error: options.failOccupancy ? { message: 'offline' } : null }),
        storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) }
    };
    w.supabase = { createClient: () => client };
    w.eval(core);
    w.eval(app);
    await settle();
    return { w, dom, errors, writes, client };
}

test('app initializes without WebGL, renders catalog, and supports direct URLs', async t => {
    const f = await fixture({ hash: '#precios' }); t.after(() => f.dom.window.close());
    assert.deepEqual(f.errors, []);
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

test('authenticated profile is restored after page load', async t => {
    const f = await fixture({ session: true }); t.after(() => f.dom.window.close());
    assert.equal(f.w.document.getElementById('vistaCliente').style.display, 'flex');
    assert.equal(f.w.document.getElementById('clienteNombre').textContent, 'Clienta');
    assert.deepEqual(f.errors, []);
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
