const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/halloween.js'), 'utf8');
function setup(date) {
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    let now = Date.parse(date), callback, delay;
    w.Date.now = () => now;
    w.setTimeout = (fn, ms) => { callback = fn; delay = ms; return 1; };
    w.clearTimeout = () => {};
    const originalHero = w.document.querySelector('#login').outerHTML;
    w.eval(script);
    return { dom, w, originalHero, delay: () => delay, tick(date) { now = Date.parse(date); callback(); } };
}
test('Halloween expires at midnight in Canarias even with the page left open', () => {
    const f = setup('2026-10-31T23:59:59Z');
    try {
        assert.equal(f.w.document.querySelectorAll('.halloween-bat').length, 3);
        assert.equal(f.w.document.querySelectorAll('.halloween-web').length, 2);
        assert.equal(f.w.document.querySelector('.halloween-badge').textContent, '¡Feliz Halloween!');
        assert.equal(f.w.document.querySelectorAll('.halloween-spider').length, 1);
        assert.equal(f.w.document.querySelectorAll('.halloween-charm').length, 1);
        assert.equal(f.delay(), 1000);
        f.tick('2026-11-01T00:00:00Z');
        assert.equal(f.w.document.body.classList.contains('halloween-season'), false);
        assert.equal(f.w.document.querySelector('#login').outerHTML, f.originalHero);
    } finally { f.dom.window.close(); }
});
test('ordinary design before, after and in following years; no automatic recurrence', () => {
    for (const date of ['2026-09-30T22:59:59Z', '2026-11-01T00:00:00Z', '2027-10-15T12:00:00Z']) {
        const f = setup(date);
        try {
            assert.equal(f.w.document.querySelector('#login').outerHTML, f.originalHero);
            assert.equal(f.w.document.body.classList.contains('halloween-season'), false);
            assert.equal(f.delay(), undefined);
        } finally { f.dom.window.close(); }
    }
});
test('restoring a suspended page removes the expired decoration', () => {
    const f = setup('2026-10-15T12:00:00Z');
    try {
        f.w.Date.now = () => Date.parse('2026-11-02T12:00:00Z');
        f.w.dispatchEvent(new f.w.Event('pageshow'));
        assert.equal(f.w.document.querySelector('#login').outerHTML, f.originalHero);
    } finally { f.dom.window.close(); }
});
