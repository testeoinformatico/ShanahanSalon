/* Shared business rules. No DOM, credentials or database access. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SalonCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';

    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[char]);
    }

    function parsePrecio(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
        let number = String(value ?? '').match(/[+-]?\d[\d.,]*/)?.[0];
        if (!number) return 0;
        if (number.includes(',')) number = number.replace(/\./g, '').replace(',', '.');
        return Number(number) || 0;
    }

    const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
    const minutes = time => {
        if (!/^\d{2}:\d{2}$/.test(time || '')) return NaN;
        const [hour, minute] = time.split(':').map(Number);
        return hour < 24 && minute < 60 ? hour * 60 + minute : NaN;
    };
    const overlaps = (start, end, otherStart, otherEnd) => start < otherEnd && end > otherStart;

    function outsideHours(time, duration) {
        const start = minutes(time), length = Number(duration), end = start + length;
        return !Number.isFinite(start) || !Number.isFinite(length) || length <= 0 ||
            !((start >= 540 && end <= 840) || (start >= 960 && end <= 1260));
    }

    function blocked(time, appointments, duration, date, blocks = []) {
        const start = minutes(time), end = start + Number(duration);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return true;
        if (appointments.some(c => c.estado !== 'cancelada' && overlaps(start, end,
            minutes(String(c.hora || '').slice(0, 5)),
            minutes(String(c.hora || '').slice(0, 5)) + (Number(c.duracion_minutos) || 30)))) return true;
        return blocks.some(block => {
            if (block.tipo === 'dia_bloqueado') return block.valor === date;
            if (block.tipo === 'mes_bloqueado') return date?.slice(0, 7) === block.valor;
            if (block.tipo !== 'hora_bloqueada' || !block.valor.startsWith(date + 'T')) return false;
            const blockedStart = minutes(block.valor.slice(11, 16));
            return overlaps(start, end, blockedStart, blockedStart + 30);
        });
    }

    function removalService(groups) {
        const item = groups.flatMap(group => group.items).find(item =>
            /retirada/i.test(item.val + ' ' + item.nombre) && /otro centro/i.test(item.val + ' ' + item.nombre));
        if (!item || !(Number(item.dur) > 0) || !(parsePrecio(item.precio) >= 0)) {
            throw new Error('No se pudo consultar el suplemento de retirada. Actualiza la página e inténtalo de nuevo.');
        }
        return { name: item.val || item.nombre, dur: Number(item.dur), precio: parsePrecio(item.precio) };
    }

    function bookingTotals(service, duration, price, extras, removal, groups) {
        const additions = extras.map(extra => ({ ...extra }));
        const hasRemoval = /retirada/i.test(service) || additions.some(extra => /retirada/i.test(extra.name));
        if (!hasRemoval && removal === 'otro') additions.push(removalService(groups));
        else if (!hasRemoval && removal === 'local') additions.push({ name: 'Retirada (local)', dur: 0, precio: 0 });
        return {
            servicio: [service, ...additions.map(extra => extra.name)].join(' + '),
            duracion: Number(duration) + additions.reduce((total, extra) => total + Number(extra.dur), 0),
            precio: money(parsePrecio(price) + additions.reduce((total, extra) => total + parsePrecio(extra.precio), 0))
        };
    }

    function reviewCard(review) {
        const rating = Math.max(0, Math.min(5, Math.trunc(Number(review.puntuacion) || 0)));
        const name = String(review.cliente_nombre ?? 'Clienta');
        const separator = name.indexOf('(Se hizo:');
        const customer = separator < 0 ? name : name.slice(0, separator).trim();
        const service = separator < 0 ? '' : name.slice(separator + 9).replace(/\)\s*$/, '').trim();
        return `<article class="resena-card-page">
            <div class="review-stars" aria-label="${rating} de 5 estrellas">${'<i class="fa-solid fa-star" aria-hidden="true"></i>'.repeat(rating)}</div>
            <p class="review-comment">“${escapeHTML(review.comentario)}”</p>
            <div class="review-author">${escapeHTML(customer)}</div>
            ${service ? `<div class="review-service">Se hizo: ${escapeHTML(service)}</div>` : ''}
        </article>`;
    }

    return { escapeHTML, parsePrecio, outsideHours, blocked, removalService, bookingTotals, reviewCard };
});
