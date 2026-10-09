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
    const spider = `<svg viewBox="0 0 64 180" fill="none" aria-hidden="true" focusable="false">
        <path d="M32 0V130" stroke="#f1d5b0" stroke-width="1"/>
        <g stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M27 143L14 134L10 122M25 148L9 144L3 133M25 153L10 157L4 169M28 158L19 167L18 178M37 143L50 134L54 122M39 148L55 144L61 133M39 153L54 157L60 169M36 158L45 167L46 178"/>
        <ellipse cx="32" cy="151" rx="9" ry="13" fill="currentColor"/><circle cx="32" cy="136" r="6" fill="currentColor"/>
        </g><circle cx="29.5" cy="135" r="1.3" fill="#f1d5b0"/><circle cx="34.5" cy="135" r="1.3" fill="#f1d5b0"/></svg>`;
    const ghost = `<svg viewBox="0 0 80 90" aria-hidden="true" focusable="false"><path d="M15 75V34C15 3 65 3 65 34V75L55 67L45 78L35 69L25 78Z" fill="#fff0d9"/><ellipse cx="31" cy="37" rx="4" ry="6" fill="#432031"/><ellipse cx="49" cy="37" rx="4" ry="6" fill="#432031"/><ellipse cx="40" cy="54" rx="5" ry="7" fill="#432031"/></svg>`;
    const pumpkin = `<svg viewBox="0 0 90 90" aria-hidden="true" focusable="false"><path d="M43 24Q40 11 53 9" fill="none" stroke="#d3b17c" stroke-width="6" stroke-linecap="round"/><ellipse cx="45" cy="53" rx="37" ry="29" fill="#ce8551"/><ellipse cx="45" cy="53" rx="24" ry="29" fill="#e1a063"/><path d="M25 48L36 37L39 49ZM51 49L55 37L65 48ZM25 58L35 62L40 58L45 64L50 58L55 62L65 58Q46 86 25 58" fill="#432031"/></svg>`;
    layer.innerHTML = `<div class="halloween-web left">${web}</div><div class="halloween-web right">${web}</div>
        <div class="halloween-spider">${spider}</div>
        <div class="halloween-bat bat-one">${bat}</div><div class="halloween-bat bat-two">${bat}</div><div class="halloween-bat bat-three">${bat}</div>`;
    const badge = document.createElement('span');
    badge.className = 'halloween-badge';
    badge.textContent = '¡Feliz Halloween!';
    hero.append(layer);
    hero.querySelector('.hero-chip').after(badge);
    const charm = document.createElement('div');
    charm.className = 'halloween-charm';
    charm.innerHTML = `${ghost}<span>Uñas para hechizar<small>Un toque de magia oscura</small></span>${pumpkin}`;
    document.querySelector('#inmersivoTrabajos .nail-intro')?.append(charm);
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
            charm.remove();
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
