/* Fondo decorativo: hasta 60 fps, resolución adaptativa y pausa durante el scroll. */
(() => {
    'use strict';
    const canvas = document.getElementById('liquidBackground');
    if (!canvas) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const MAX_PIXELS = 240000, MIN_PIXELS = 120000, MAX_RIPPLES = 8, FRAME_MS = 1000 / 60;
    const vertexSource = 'attribute vec2 a_pos; void main(){gl_Position=vec4(a_pos,0.0,1.0);}';
    const fragmentSource = `
    precision highp float;
    uniform vec2  u_res;
    uniform float u_time;
    uniform float u_pixelScale;
    uniform vec3  u_ripples[8];
    uniform int   u_rippleCount;

    #define TAU 6.28318530718

    float hash(vec2 p){
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
                 mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
    }
    float fbm(vec2 p){
      float s = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.02; a *= 0.5; }
      return s;
    }
    mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

    vec3 caustic(vec2 uv){
      vec2 p = uv * TAU - 250.0;
      vec2 i = p;
      float c = 1.0;
      float inten = 0.0045;
      for (int n = 0; n < 5; n++){
        float t = u_time * 1.5 * (1.0 - (3.5 / float(n + 1)));
        i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
        c += 1.0 / length(vec2(-250.0 / (sin(i.x + t) / inten),
                               -250.0 / (cos(i.y + t) / inten)));
      }
      c /= 5.0;
      c = 1.17 - pow(c, 1.4);
      float col = pow(abs(c), 8.0);
      col = clamp(col, 0.0, 1.0);
      return vec3(col);
    }

    void main(){
      vec2 fragCoord = gl_FragCoord.xy;
      vec2 uv = fragCoord / u_res.xy;
      float aspect = u_res.x / u_res.y;

      float depth = uv.y;

      vec2 cuv = vec2(uv.x * aspect, uv.y);

      cuv *= mix(2.0, 4.0, depth);
      cuv += vec2(u_time * 0.02, u_time * 0.15);

      cuv += vec2(u_time * 0.02, u_time * 0.15);

      // Eliminadas las olas que van hacia abajo (swellX y swell)
      float swellX = 0.0;
      float swell = 0.0;

      vec2 distort = vec2(0.0);
      float ripWave = 0.0;
      for (int k = 0; k < 8; k++){
        if (k >= u_rippleCount) break;
        vec3 rp = u_ripples[k];
        vec2 d = fragCoord - rp.xy;
        float dist = length(d) / u_pixelScale;
        float radius = rp.z * 400.0;
        float band = 80.0;
        float falloff = exp(-rp.z * 1.2);
        float ring = exp(-abs(dist - radius) / band) * falloff;
        distort += normalize(d + 0.001) * sin((radius - dist) * 0.06) * ring * 2.5;
        ripWave += ring;
      }



      distort = clamp(distort, -20.0, 20.0);
      cuv += distort * 0.04;

      vec2 warp = vec2(
        fbm(cuv * 0.6 + u_time * 0.05) + 0.5 * fbm(cuv * 1.5 - u_time * 0.08),
        fbm(cuv * 0.6 + 7.3 - u_time * 0.05) + 0.5 * fbm(cuv * 1.5 + 3.1 + u_time * 0.08)
      );
      cuv += (warp - 0.75) * 3.5;

      vec3 ca = caustic(rot(0.618) * cuv * 1.0   + vec2(10.0, u_time * 0.1));
      vec3 cb = caustic(rot(2.399) * cuv * 1.618 + vec2(40.0, -u_time * 0.15));
      vec3 cc = caustic(rot(-1.732)* cuv * 0.732 + vec2(-15.0, u_time * 0.2));
      vec3 cd = caustic(rot(0.9)   * cuv * 1.25  + vec2(20.0, -u_time * 0.12));

      float light = (ca.r + cb.r + cc.r + cd.r) * 0.26;
      light = pow(light, 1.4) * 1.8;
      light *= 0.4 + 1.2 * fbm(cuv * 0.2 + u_time * 0.03);
      light += clamp(ripWave, 0.0, 1.5) * 0.05;
      // Eliminadas las crestas de las olas (crest)
      light = max(light, 0.0);
      light *= mix(1.0, 0.12, smoothstep(0.35, 1.0, depth));

      vec3 water = vec3(0.94, 0.91, 0.87); // Marfil cálido editorial

      vec3 col = water;

      col += vec3(light) * vec3(1.0, 0.97, 0.92) * 1.2;
      float sparkle = pow(max(0.0, light - 0.5), 2.0);
      col += sparkle * 0.4;
      float vig = smoothstep(1.3, 0.2, length(uv - vec2(0.5, 0.35)));
      col *= mix(0.82, 1.0, vig);

      gl_FragColor = vec4(col, 1.0);
    }
    `;
    let gl = null, program = null, uniforms = null, failed = false, lost = false;
    let frame = 0, resumeTimer = 0, scrolling = false, previous = null, elapsed = 0;
    let nextDraw = 0, lastFrame = null, sampleTime = 0, sampleCount = 0, pixelBudget = MAX_PIXELS;
    let width = 1, height = 1, scale = 1, needsResize = true, pendingPointer = null, lastRipple = -Infinity;
    const ripples = [];
    const rippleData = new Float32Array(MAX_RIPPLES * 3);

    function eligible() {
        return !document.hidden && !reduced.matches && !failed && !lost &&
            !document.body.classList.contains('en-inicio') &&
            !document.body.classList.contains('admin-mode') &&
            !document.body.classList.contains('menu-open');
    }
    function pause() {
        cancelAnimationFrame(frame);
        frame = 0; previous = lastFrame = null; nextDraw = 0;
        sampleTime = sampleCount = 0;
    }
    function initialize() {
        if (gl && program) return true;
        const options = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
        try {
            gl = canvas.getContext('webgl', options);
            if (!gl) throw new Error('WebGL unavailable');
            const shaders = [];
            try {
                for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
                    const shader = gl.createShader(type);
                    shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
                    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader unavailable');
                }
                program = gl.createProgram();
                shaders.forEach(shader => gl.attachShader(program, shader));
                gl.linkProgram(program);
                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program unavailable');
            } finally { shaders.forEach(shader => gl.deleteShader(shader)); }
            gl.useProgram(program);
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
            const location = gl.getAttribLocation(program, 'a_pos');
            gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
            uniforms = Object.fromEntries(['res','time','ripples','rippleCount','pixelScale'].map(name => [name, gl.getUniformLocation(program, 'u_' + name)]));
            return true;
        } catch {
            if (gl && program) gl.deleteProgram(program);
            failed = true; canvas.hidden = true; canvas.dataset.state = 'fallback';
            return false;
        }
    }
    function resize() {
        width = Math.max(1, innerWidth); height = Math.max(1, innerHeight);
        scale = Math.min(.75, Math.sqrt(pixelBudget / (width * height)));
        const w = Math.max(1, Math.floor(width * scale)), h = Math.max(1, Math.floor(height * scale));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h);
        gl.uniform2f(uniforms.res, w, h); gl.uniform1f(uniforms.pixelScale, scale);
        needsResize = false;
    }
    function queue() {
        if (!frame && eligible() && !scrolling) frame = requestAnimationFrame(draw);
    }
    function draw(now) {
        frame = 0;
        if (!eligible() || scrolling) { pause(); return; }
        // El reloj de pantalla evita sumar un temporizador entre fotogramas.
        // Si el dispositivo no mantiene el ritmo, reducir píxeles antes que fluidez.
        if (lastFrame !== null) {
            sampleTime += Math.min(100, now - lastFrame);
            if (++sampleCount >= 30) {
                if (sampleTime / sampleCount > 22 && pixelBudget > MIN_PIXELS) {
                    pixelBudget = Math.max(MIN_PIXELS, Math.floor(pixelBudget * .8));
                    needsResize = true;
                }
                sampleTime = sampleCount = 0;
            }
        }
        lastFrame = now;
        if (now + 1 < nextDraw) { queue(); return; }
        nextDraw = Math.max(nextDraw + FRAME_MS, now);
        if (!initialize()) return;
        if (needsResize) resize();
        if (previous !== null) elapsed += Math.min(100, now - previous);
        previous = now;
        if (pendingPointer && now - lastRipple >= 180) {
            ripples.push({ ...pendingPointer, born: elapsed });
            if (ripples.length > MAX_RIPPLES) ripples.shift();
            pendingPointer = null; lastRipple = now;
        }
        while (ripples.length && elapsed - ripples[0].born > 3500) ripples.shift();
        rippleData.fill(0);
        ripples.forEach((r, i) => {
            rippleData[i * 3] = r.x * canvas.width;
            rippleData[i * 3 + 1] = (1 - r.y) * canvas.height;
            rippleData[i * 3 + 2] = (elapsed - r.born) / 1000;
        });
        gl.uniform1f(uniforms.time, elapsed / 2400);
        gl.uniform3fv(uniforms.ripples, rippleData);
        gl.uniform1i(uniforms.rippleCount, ripples.length);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        canvas.hidden = false; canvas.dataset.state = 'running';
        queue();
    }
    function sync() {
        if (!eligible()) {
            pause(); clearTimeout(resumeTimer); resumeTimer = 0; scrolling = false;
            canvas.hidden = true; pendingPointer = null;
            canvas.dataset.state = failed ? 'fallback' : 'paused';
        } else if (!scrolling && !frame) queue();
    }
    function pointer(event) {
        if (!eligible() || scrolling || !program) return;
        if (event.type === 'pointermove' && event.pointerType !== 'mouse') return;
        pendingPointer = { x: event.clientX / width, y: event.clientY / height };
    }
    // Ninguna lectura de posición ni dibujo dentro de eventos de ratón/táctil.
    window.addEventListener('pointermove', pointer, { passive: true });
    window.addEventListener('pointerdown', pointer, { passive: true });
    window.addEventListener('scroll', () => {
        if (!eligible()) return;
        scrolling = true; pause(); pendingPointer = null;
        canvas.dataset.state = 'scroll-paused';
        clearTimeout(resumeTimer);
        resumeTimer = setTimeout(() => { resumeTimer = 0; scrolling = false; sync(); }, 180);
    }, { passive: true });
    window.addEventListener('resize', () => { needsResize = true; sync(); }, { passive: true });
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault(); lost = true; program = null; gl = null; sync();
    });
    canvas.addEventListener('webglcontextrestored', () => { lost = false; needsResize = true; sync(); });
    sync();
})();
