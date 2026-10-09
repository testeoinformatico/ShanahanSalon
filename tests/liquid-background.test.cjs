const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../assets/liquid-background.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup({ reduced = false, available = true, home = false } = {}) {
    const dom = new JSDOM(`<body class="${home ? 'en-inicio' : ''}"><canvas id="liquidBackground" hidden></canvas></body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window, canvas = w.document.querySelector('canvas');
    let time = 0, id = 0, draws = 0, contexts = 0, hidden = false, liquidTime = 0;
    const frames = new Map(), timers = new Map();
    w.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
    w.cancelAnimationFrame = handle => frames.delete(handle);
    w.setTimeout = (callback, delay) => { timers.set(++id, { callback, due: time + delay }); return id; };
    w.clearTimeout = handle => timers.delete(handle);
    w.matchMedia = () => ({ matches: reduced, addEventListener() {} });
    Object.defineProperty(w.document, 'hidden', { get: () => hidden });
    Object.defineProperty(w, 'innerWidth', { value: 1920 });
    Object.defineProperty(w, 'innerHeight', { value: 1080 });
    Object.defineProperty(w, 'devicePixelRatio', { value: 3 });
    const gl = {
        createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
        createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => true,
        deleteShader() {}, deleteProgram() {}, useProgram() {}, bindBuffer() {}, createBuffer: () => ({}),
        bufferData() {}, getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {},
        getUniformLocation: (_, name) => name, viewport() {}, uniform2f() {}, uniform1f(name, value) { if (name === 'u_time') liquidTime = value; }, uniform3fv() {}, uniform1i() {},
        drawArrays() { draws++; }
    };
    canvas.getContext = () => { contexts++; return available ? gl : null; };
    function advance(ms, interval = 1000 / 60) {
        const until = time + ms;
        while (time < until) {
            time += interval;
            for (const [key, task] of [...timers]) if (task.due <= time) { timers.delete(key); task.callback(); }
            const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time));
        }
    }
    w.eval(source);
    return { dom, w, canvas, advance, liquidTime: () => liquidTime, counts: () => ({ draws, contexts, scheduled: frames.size + timers.size }), hide() { hidden = true; w.document.dispatchEvent(new w.Event('visibilitychange')); } };
}
test('liquid caps resolution and drawing rate, pauses for scroll, then resumes', () => {
    const f = setup();
    try {
        f.advance(1000);
        assert.ok(f.canvas.width * f.canvas.height <= 240000);
        assert.ok(f.counts().draws >= 59 && f.counts().draws <= 61);
        assert.equal(f.canvas.hidden, false);
        const before = f.counts().draws;
        f.w.dispatchEvent(new f.w.Event('scroll')); f.advance(160);
        assert.equal(f.counts().draws, before);
        f.advance(100); assert.ok(f.counts().draws > before);
        f.hide(); assert.equal(f.counts().scheduled, 0);
    } finally { f.dom.window.close(); }
});

test('high refresh displays stay near 60 draws per second and movement uses elapsed time', () => {
    const normal = setup(), fast = setup();
    try {
        normal.advance(1000); fast.advance(1000, 1000 / 120);
        assert.ok(fast.counts().draws >= 59 && fast.counts().draws <= 61);
        assert.ok(Math.abs(normal.liquidTime() - fast.liquidTime()) < .015);
        assert.ok(normal.liquidTime() > .4 && normal.liquidTime() < .43);
        const before = normal.liquidTime();
        normal.w.dispatchEvent(new normal.w.Event('scroll')); normal.advance(180);
        assert.ok(normal.liquidTime() - before < .02, 'resuming does not jump by the paused time');
    } finally { normal.dom.window.close(); fast.dom.window.close(); }
});

test('sustained slow frames lower rendering resolution instead of adding frame delays', () => {
    const f = setup();
    try {
        f.advance(100);
        const originalPixels = f.canvas.width * f.canvas.height;
        f.advance(2000, 1000 / 30);
        assert.ok(f.canvas.width * f.canvas.height < originalPixels);
        assert.ok(f.canvas.width * f.canvas.height >= 119000);
        assert.equal(f.canvas.dataset.state, 'running');
    } finally { f.dom.window.close(); }
});
test('covered homepage does not initialize WebGL and returning home cancels all work', async () => {
    const f = setup({ home: true });
    try {
        f.advance(1000); assert.deepEqual(f.counts(), { draws: 0, contexts: 0, scheduled: 0 });
        f.w.document.body.classList.remove('en-inicio'); await settle(); f.advance(100);
        assert.ok(f.counts().draws > 0);
        f.w.document.body.classList.add('en-inicio'); await settle();
        assert.equal(f.canvas.hidden, true); assert.equal(f.counts().scheduled, 0);
    } finally { f.dom.window.close(); }
});
test('reduced motion and unsupported graphics leave the static fallback without a render loop', () => {
    for (const options of [{ reduced: true }, { available: false }]) {
        const f = setup(options);
        try {
            f.advance(1000);
            assert.equal(f.canvas.hidden, true); assert.equal(f.counts().draws, 0);
            assert.equal(f.counts().scheduled, 0);
            assert.equal(f.counts().contexts, options.reduced ? 0 : 1);
        } finally { f.dom.window.close(); }
    }
});
