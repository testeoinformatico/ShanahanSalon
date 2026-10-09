const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/home-motion.js'), 'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(reduced = false) {
    const dom = new JSDOM(html, { url: 'https://example.test', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window, requests = [];
    w.document.body.classList.add('en-inicio');
    w.matchMedia = () => ({ matches: reduced, addEventListener() {} });
    w.IntersectionObserver = class { observe() {} };
    w.Image = function() {
        const img = w.document.createElement('img');
        Object.defineProperty(img, 'complete', { get: () => false });
        Object.defineProperty(img, 'src', { set(src) { img.setAttribute('src', src); requests.push(img); } });
        return img;
    };
    const gallery = w.document.getElementById('galeriaPublica');
    const track = w.document.getElementById('nailTrack');
    function photos(names) {
        gallery.replaceChildren(...names.map(name => {
            const img = w.document.createElement('img');
            img.src = '/photos/' + name;
            return img;
        }));
    }
    return { dom, w, requests, gallery, track, photos, start: () => w.eval(script) };
}

test('reduced motion shows loaded photos without a pinned animation', async () => {
    const f = setup(true);
    try {
        f.photos(['one.jpg']); f.start();
        f.requests[0].onload(); await settle();
        assert.equal(f.track.hidden, false);
        assert.equal(f.track.classList.contains('nail-motion'), false);
        assert.equal(f.w.document.querySelector('#nailMural img').getAttribute('src'), 'https://example.test/photos/one.jpg');
        assert.equal(f.w.document.querySelector('.nail-heading').style.opacity, '');
    } finally { f.dom.window.close(); }
});

test('failed decorative photos leave the ordinary gallery available without an empty scroll track', async () => {
    const f = setup();
    try {
        f.photos(['missing.jpg']); f.start();
        f.requests[0].onerror(); await settle();
        assert.equal(f.track.hidden, true);
        assert.equal(f.gallery.children.length, 1);
        assert.equal(f.w.document.getElementById('trabajosInvita').hidden, false);
    } finally { f.dom.window.close(); }
});

test('an older photo load cannot restore images removed from the gallery', async () => {
    const f = setup();
    try {
        f.photos(['old.jpg']); f.start();
        f.photos(['new.jpg']); await settle();
        f.requests[1].onload(); await settle();
        f.requests[0].onload(); await settle();
        const images = [...f.w.document.querySelectorAll('#nailMural img')];
        assert.equal(images.length, 1);
        assert.match(images[0].getAttribute('src'), /new\.jpg$/);
        f.photos([]); await settle();
        assert.equal(f.track.hidden, true);
    } finally { f.dom.window.close(); }
});
