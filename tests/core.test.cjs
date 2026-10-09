const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePrecio, bookingTotals, outsideHours, blocked, reviewCard } = require('../assets/core.js');
const groups = [{ items: [{ val: 'Suplemento retirada (de otro centro)', nombre: 'Retirada de producto de otro centro', dur: 30, precio: '+7 €' }] }];

test('prices preserve decimals and Spanish separators', () => {
    for (const [value, expected] of [['28,50 €', 28.5], ['Desde +10 €', 10], ['1.234,56 €', 1234.56], ['28.50', 28.5], [0, 0], [null, 0]]) {
        assert.equal(parsePrecio(value), expected);
    }
});
test('withdrawal uses catalog price and duration exactly once', () => {
    const total = bookingTotals('Manicura', 75, 25, [{ name: 'Flor 3D', dur: 10, precio: 3 }], 'otro', groups);
    assert.equal(total.precio, 35);
    assert.equal(total.duracion, 115);
    assert.match(total.servicio, /Suplemento retirada/);
    assert.equal(bookingTotals('Retirada completa', 45, 12, [], 'otro', groups).precio, 12);
    assert.equal(bookingTotals('Manicura', 75, 25, [{ name: 'Retirada de otro centro', dur: 30, precio: 7 }], 'otro', groups).precio, 32);
    assert.equal(bookingTotals('Manicura', 75, 25, [], 'local', groups).precio, 25);
    assert.throws(() => bookingTotals('Manicura', 75, 25, [], 'otro', []), /suplemento/);
});
test('opening hours reject lunch, early and invalid starts', () => {
    for (const [time, duration] of [['08:30', 30], ['14:00', 30], ['15:00', 30], ['13:30', 45], ['20:30', 45], ['25:00', 30], ['10:00', -1]]) {
        assert.equal(outsideHours(time, duration), true, time);
    }
    for (const [time, duration] of [['09:00', 75], ['13:30', 30], ['16:00', 120], ['20:30', 30]]) assert.equal(outsideHours(time, duration), false);
});
test('appointment and block overlap uses intervals, including non half-hour starts', () => {
    const date = '2026-10-15';
    const blocks = [{ tipo: 'hora_bloqueada', valor: date + 'T10:00' }];
    assert.equal(blocked('09:45', [], 30, date, blocks), true);
    assert.equal(blocked('10:15', [], 15, date, blocks), true);
    assert.equal(blocked('09:30', [], 30, date, blocks), false);
    assert.equal(blocked('10:30', [], 30, date, blocks), false);
    assert.equal(blocked('09:00', [{ hora: '09:30', duracion_minutos: 75, estado: 'confirmada' }], 60, date), true);
    assert.equal(blocked('09:00', [{ hora: '09:30', duracion_minutos: 75, estado: 'cancelada' }], 60, date), false);
    assert.equal(blocked('09:00', [], 30, date, [{ tipo: 'mes_bloqueado', valor: '2026-10' }]), true);
});
test('review markup escapes stored content and bounds ratings', () => {
    const rendered = reviewCard({ cliente_nombre: '<img src=x onerror=alert(1)> (Se hizo: <svg onload=alert(2)>)', comentario: '</p><script>evil()</script>', puntuacion: 999 });
    assert.doesNotMatch(rendered, /<script>|<img|<svg/);
    assert.match(rendered, /&lt;script&gt;/);
    assert.equal((rendered.match(/fa-solid fa-star/g) || []).length, 5);
    assert.doesNotThrow(() => reviewCard({ cliente_nombre: null, comentario: null, puntuacion: -2 }));
});
