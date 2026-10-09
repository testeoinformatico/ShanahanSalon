/* Decoración temporal independiente: al caducar se retiran sus nodos y estilos. */
(() => {
    'use strict';
    // Campaña de 2026, sin repetición automática en años posteriores.
    // El 1 de noviembre Canarias está en UTC+00:00.
    const starts = Date.parse('2026-10-01T00:00:00+01:00');
    const ends = Date.parse('2026-11-01T00:00:00+00:00');
    const hero = document.querySelector('#login .hero-seccion');
    if (!hero || Date.now() < starts || Date.now() >= ends) return;

    const layer = document.createElement('div');
    layer.className = 'halloween-decor';
    layer.setAttribute('aria-hidden', 'true');
    const web = `<svg viewBox="0 0 240 240" fill="none" aria-hidden="true" focusable="false">
        <g stroke="currentColor" stroke-width="1.1">
        <path d="M0 0L238 0M0 0L228 61M0 0L205 119M0 0L168 168M0 0L119 205M0 0L61 228M0 0L0 238"/>
        <path d="M42 0Q35 5 41 11Q32 13 36 21Q28 21 30 30Q21 28 21 36Q13 32 11 41Q5 35 0 42M86 0Q72 10 83 22Q65 26 74 43Q56 43 61 61Q43 56 43 74Q26 65 22 83Q10 72 0 86M130 0Q109 15 126 34Q98 39 113 65Q84 65 92 92Q65 84 65 113Q39 98 34 126Q15 109 0 130M178 0Q149 21 172 46Q134 53 154 89Q115 89 126 126Q89 115 89 154Q53 134 46 172Q21 149 0 178M232 0Q194 27 224 60Q175 70 201 116Q150 116 164 164Q116 150 116 201Q70 175 60 224Q27 194 0 232"/>
        </g></svg>`;
    const bat = `<svg viewBox="0 0 120 60" aria-hidden="true" focusable="false"><path fill="currentColor" d="M60 23L54 13L51 23C36 22 19 10 3 4C9 17 9 28 7 37C18 29 27 32 30 43C40 35 48 40 51 50L60 57L69 50C72 40 80 35 90 43C93 32 102 29 113 37C111 28 111 17 117 4C101 10 84 22 69 23L66 13Z"/></svg>`;
    layer.innerHTML = `<div class="halloween-web left">${web}</div><div class="halloween-web right">${web}</div>
        <div class="halloween-bat bat-one">${bat}</div><div class="halloween-bat bat-two">${bat}</div><div class="halloween-bat bat-three">${bat}</div>`;
    const badge = document.createElement('span');
    badge.className = 'halloween-badge';
    badge.textContent = 'Edición Halloween · Octubre';
    hero.append(layer);
    hero.querySelector('.hero-chip').after(badge);
    document.body.classList.add('halloween-season');
    let timer;
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
        layer.classList.toggle('in-view', entries[0].isIntersecting);
    }) : null;
    observer?.observe(hero);

    function checkSeason() {
        clearTimeout(timer);
        const remaining = ends - Date.now();
        if (remaining <= 0 || Date.now() < starts) {
            layer.remove();
            badge.remove();
            document.body.classList.remove('halloween-season');
            observer?.disconnect();
            document.removeEventListener('visibilitychange', checkSeason);
            window.removeEventListener('pageshow', checkSeason);
            return;
        }
        layer.classList.toggle('is-visible', !document.hidden);
        // Una comprobación cada seis horas y en la hora exacta del final.
        // También se comprueba al volver a una pestaña suspendida o restaurada.
        timer = setTimeout(checkSeason, Math.min(remaining, 6 * 60 * 60 * 1000));
    }
    document.addEventListener('visibilitychange', checkSeason);
    window.addEventListener('pageshow', checkSeason);
    checkSeason();
})();
