/* Efectos decorativos: no modifican el scroll ni capturan rueda/táctil. */
(() => {
    'use strict';
    const track = document.getElementById('nailTrack');
    const stage = document.getElementById('nailStage');
    const path = document.getElementById('nailPath');
    const mural = document.getElementById('nailMural');
    const gallery = document.getElementById('galeriaPublica');
    if (!track || !stage || !path || !mural || !gallery) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktopNail = path.getAttribute('d');
    const labels = [...track.querySelectorAll('.nail-side,.nail-cue,.nail-shine')];
    const heading = track.querySelector('.nail-heading');
    const supportsMotion = typeof IntersectionObserver !== 'undefined';
    const clamp = value => Math.max(0, Math.min(1, value));
    let active = false, frame = 0, position = 0, target = 0, previousTime = 0;
    let sourcesKey = '', generation = 0;

    function stop() {
        cancelAnimationFrame(frame);
        frame = 0;
        previousTime = 0;
    }
    function canAnimate() {
        return active && !track.hidden && !reduced.matches && supportsMotion &&
            document.body.classList.contains('en-inicio') && !document.hidden;
    }
    function paint() {
        const q = clamp((position - .04) / .84);
        const scale = Math.pow(7, q * q * (3 - 2 * q));
        path.setAttribute('transform', `translate(.5 .5) scale(${scale}) translate(-.5 -.5)`);
        labels.forEach(el => { el.style.opacity = String(1 - clamp(position / .19)); });
        const reveal = clamp((position - .6) / .23);
        heading.style.opacity = String(reveal);
        heading.style.transform = `translateY(${(1 - reveal) * 24}px)`;
    }
    function tick(now) {
        frame = 0;
        if (!canAnimate()) return;
        const dt = Math.min(64, previousTime ? now - previousTime : 16);
        previousTime = now;
        position += (target - position) * (1 - Math.exp(-dt / 110));
        if (Math.abs(target - position) < .0002) position = target;
        paint();
        if (position !== target) frame = requestAnimationFrame(tick);
        else previousTime = 0;
    }
    function measure(snap = false) {
        if (!canAnimate()) { stop(); return; }
        const rect = track.getBoundingClientRect();
        const top = parseFloat(getComputedStyle(stage).top) || 0;
        target = clamp((top - rect.top) / Math.max(1, rect.height - stage.clientHeight));
        if (snap) { position = target; paint(); }
        if (!frame) frame = requestAnimationFrame(tick);
    }
    function configure() {
        stop();
        path.setAttribute('d', window.innerWidth <= 768
            ? 'M .5 .24 C .69 .24 .75 .31 .75 .43 L .73 .67 C .72 .73 .65 .76 .5 .76 C .35 .76 .28 .73 .27 .67 L .25 .43 C .25 .31 .31 .24 .5 .24 Z'
            : desktopNail);
        const enabled = !reduced.matches && supportsMotion;
        track.classList.toggle('nail-motion', enabled);
        if (!enabled) {
            heading.style.removeProperty('opacity');
            heading.style.removeProperty('transform');
        }
        measure(true);
    }

    // Usa la galería existente; una foto eliminada también desaparece del efecto.
    // Solo muestra el mural cuando hay al menos una imagen cargada correctamente.
    async function syncPhotos() {
        const sources = [...gallery.querySelectorAll('img')].slice(0, 3).map(img => img.src);
        const key = JSON.stringify(sources);
        if (key === sourcesKey) return;
        sourcesKey = key;
        const current = ++generation;
        const pictures = await Promise.all(sources.map(src => new Promise(resolve => {
            const img = new Image();
            img.alt = '';
            img.decoding = 'async';
            const finish = ok => { img.onload = img.onerror = null; resolve(ok ? img : null); };
            img.onload = () => finish(true);
            img.onerror = () => finish(false);
            img.src = src;
            if (img.complete) finish(img.naturalWidth > 0);
        })));
        if (current !== generation) return;
        const valid = pictures.filter(Boolean);
        mural.replaceChildren(...valid);
        mural.style.gridTemplateColumns = valid.length === 3 ? '' : `repeat(${Math.max(1, valid.length)}, minmax(0, 1fr))`;
        track.hidden = valid.length === 0;
        configure();
    }
    new MutationObserver(syncPhotos).observe(gallery, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    if (supportsMotion) {
        new IntersectionObserver(entries => {
            active = entries[0].isIntersecting;
            if (active) measure(true); else stop();
        }, { rootMargin: '120px' }).observe(track);
    }
    new MutationObserver(() => {
        if (document.body.classList.contains('en-inicio')) measure(true); else stop();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('scroll', () => measure(), { passive: true });
    window.addEventListener('resize', configure, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else measure(true); });
    reduced.addEventListener('change', configure);
    configure();
    syncPhotos();
})();
