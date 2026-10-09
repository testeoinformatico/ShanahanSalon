    // ═══════════════════════════════════════════════════════
    //  SHANAHAN NAILS — JS principal
    //  Columnas requeridas en Supabase:
    //  clientas : id (Auth), nombre, telefono, visitas
    //  citas    : id, nombre_cliente, telefono, servicio,
    //             duracion_minutos, fecha, hora, estado
    //  admins   : id (Auth); las contraseñas pertenecen a Supabase Auth.
    //  dias_disponibles : id, tipo, valor
    // ═══════════════════════════════════════════════════════

    const SUPABASE_URL     = "https://lofgjkrcgkqufqpybddn.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvZmdqa3JjZ2txdWZxcHliZGRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4OTc0MjQsImV4cCI6MjA5MzQ3MzQyNH0.8QC7Jq6_lwdGG-iWT0AGiFGl-izWAfIk2tfLC01vJoE";
    const sb               = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const SALON_WHATSAPP   = "34644911596";

    // ── Estado global ──────────────────────────────────────
    let clientas       = [];
    let citas          = [];
    let diasDisponibles = [];
    let disponibilidadCargada = false;
    const ocupacionCargada = new Set();
    let _adminAutenticada = false;
    let _reservaPendiente = false;
    let _reservaEnviando = false;
    let _huecoPendiente = null;
    const escapeHTML = SalonCore.escapeHTML;
    const inlineArg = value => escapeHTML(JSON.stringify(String(value ?? '')));
    const _citasGuardando = new Set();
    let agendaInitialized = false;
    let _clienteLogueado = null;  // datos del cliente logueado
    let _loginParaReservar = false;  // marca si llegamos al login desde "Reservar cita"
    let _irAlAcceso = false;         // pide desplazar hasta la tarjeta de acceso

    // Picker estado
    let calCursor    = null;   // se inicializa en initPicker
    let selectedDate = null;
    let selectedTime = null;
    let selectedServicio  = null;
    let selectedDuracion  = 0;
    let selectedExtras    = [];   // [{name, dur, precio}] — ÚNICA fuente de verdad (la usan getTotalDuracion y el bloqueo)
    let selectedPrecio    = 0;
    let activePeriod = "morning";

    // Agenda admin
    let agendaCursor   = null;
    let agendaSelected = null;
    let agendaFilter   = "all";
    let dCalCursor     = null;

    // ── Constantes ─────────────────────────────────────────
    const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    const DOW_ES    = ["L","M","X","J","V","S","D"];
    const SLOTS = {
        morning:   ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30"],
        afternoon: ["16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30"]
    };

    // ── Utilidades ─────────────────────────────────────────
    const pad2   = n => String(n).padStart(2,"0");
    const fmtISO = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    const fmtIso = fmtISO; // alias
    const toMin  = s => { const [h,m] = (s||"00:00").split(":").map(Number); return h*60+m; };

    const today = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();

    function fmtPretty(d) {
        const days = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
        return `${days[d.getDay()]} ${d.getDate()} de ${MONTHS_ES[d.getMonth()].toLowerCase()}`;
    }
    function fmtDayLong(d) {
        const days = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
        return `${days[d.getDay()]}, ${d.getDate()} de ${MONTHS_ES[d.getMonth()].toLowerCase()}`;
    }
    function fmtMes(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`; }
    function durStr(min) {
        const h = Math.floor(min/60), m = min%60;
        return h>0 ? (m>0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
    }

    // Extrae el numero de cualquier formato de precio ("25", "25 EUR", "Desde 35 EUR", 25).
    // Definida aqui, a nivel global, porque la usan tanto el historial como el editor de citas.
    const parsePrecio = SalonCore.parsePrecio;


    // Deja cualquier precio con el simbolo al final y un espacio: "28" -> "28 €",
    // "25€" -> "25 €"; "Desde 35 €" y "+7 €" se quedan igual. Misma regla que en la BD.
    // Devuelve "" si no hay ningun numero, para poder validar.
    function formatearPrecio(val) {
        const t = String(val === null || val === undefined ? "" : val).trim().replace(/ *€ *$/, "");
        return /[0-9]/.test(t) ? t + " €" : "";
    }

    // ── Slot helpers ───────────────────────────────────────
    function slotBloqueado(t, citasDelDia, durNueva, fechaISO) {
        return SalonCore.blocked(t, citasDelDia, durNueva, fechaISO, diasDisponibles);
    }
    const slotFueraDeHorario = SalonCore.outsideHours;

    async function checked(query) {
        const result = await query;
        if (result.error) throw result.error;
        return result;
    }

    async function cargarOcupacion(fecha) {
        ocupacionCargada.delete(fecha);
        const { data } = await checked(sb.rpc('horas_ocupadas', { p_fecha: fecha }));
        citas = citas.filter(c => c.fecha !== fecha);
        (data || []).forEach(c => citas.push({ ...c, fecha }));
        ocupacionCargada.add(fecha);
    }

    // ── Toast ──────────────────────────────────────────────
    function toast(message, type="info", title="") {
        if (type === "error") {
            const am = document.getElementById("alertModal");
            if(am) {
                document.getElementById("alertTitle").textContent = title || "Atención";
                document.getElementById("alertMsg").textContent = message;
                am.classList.add("show");
                return;
            }
        }
        const stack = document.getElementById("toastStack");
        if (!stack) return;
        const t = document.createElement("div");
        t.className = `toast ${type}`;
        const icons  = {success:"fa-circle-check", error:"fa-circle-exclamation", info:"fa-circle-info"};
        const titles = {success:title||"Hecho", error:title||"Atención", info:title||"Aviso"};
        t.innerHTML = `<i class="fa-solid ${icons[type]||icons.info}"></i><div><div class="msg-title">${escapeHTML(titles[type])}</div><div class="msg-body">${escapeHTML(message)}</div></div>`;
        stack.appendChild(t);
        setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 350); }, 4000);
    }

    // ── Confirm modal ──────────────────────────────────────
    let confirmResolver = null;
    function askConfirm(title, msg) {
        document.getElementById("confirmTitle").textContent = title;
        document.getElementById("confirmMsg").textContent   = msg;
        document.getElementById("confirmModal").classList.add("show");
        return new Promise(r => { confirmResolver = r; });
    }
    function closeConfirm(v) {
        document.getElementById("confirmModal").classList.remove("show");
        if (confirmResolver) confirmResolver(v);
    }
    document.getElementById("confirmModal").addEventListener("click", e => {
        if (e.target.id === "confirmModal") closeConfirm(false);
    });

    // ── Btn loading ────────────────────────────────────────
    function setBtnLoading(id, on) {
        const b = document.getElementById(id);
        if (!b) return;
        b.classList.toggle("loading", on);
        b.disabled = on;
    }

    // ── Toggle ver/ocultar contraseña ──────────────────────
    function togglePassVis(inputId, btn) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const isPass = input.type === "password";
        input.type = isPass ? "text" : "password";
        const icon = btn?.querySelector("i");
        if (icon) icon.className = isPass ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
    }

    // ── Vista switch ───────────────────────────────────────
    function toggleMobileMenu(forzarCierre) {
        const nav = document.getElementById("mainNavActions");
        if (!nav) return;
        const abierto = forzarCierre === true ? false : !nav.classList.contains("show-mobile");
        nav.classList.toggle("show-mobile", abierto);
        document.body.classList.toggle("menu-open", abierto);
        const btn = document.querySelector(".mobile-menu-btn");
        if (btn) {
            btn.setAttribute("aria-expanded", abierto ? "true" : "false");
            btn.setAttribute("aria-label", abierto ? "Cerrar menú" : "Abrir menú");
        }
    }

    // Escape cierra el menú móvil
    document.addEventListener("keydown", function(e) {
        if (e.key === "Escape" && document.body.classList.contains("menu-open")) toggleMobileMenu(true);
    });

    // Ancho real de la ventana (sin barra de desplazamiento) para que los
    // paneles de sección salgan a sangre exactos
    (function() {
        const raiz = document.documentElement;
        const topbar = document.querySelector("nav.topbar");
        const main = document.querySelector("main.container");

        function medir() {
            // Si medimos antes de que la página tenga ancho (carga temprana,
            // pestaña oculta), fijar --vw a 0 colapsaría todos los paneles y no
            // se recuperaría solo. Solo escribimos valores con sentido.
            const ancho = raiz.clientWidth || window.innerWidth || 0;
            if (ancho > 0) raiz.style.setProperty("--vw", ancho + "px");

            // El hero se sube hasta el borde de la página. En vez de sumar
            // cabecera + relleno (que se dejaba 20px por el camino), medimos
            // su posición natural anulando el tirón un instante: así es exacto
            // sea cual sea lo que haya encima.
            const hero = document.querySelector(".hero-seccion");
            if (hero) {
                const previo = hero.style.marginTop;
                hero.style.marginTop = "0px";
                const natural = hero.getBoundingClientRect().top + window.scrollY;
                hero.style.marginTop = previo;
                if (natural > 0) raiz.style.setProperty("--tope-hero", natural + "px");
            }
        }
        window.addEventListener("resize", medir, { passive: true });
        window.addEventListener("load", medir);        // por si al arrancar aún no había medidas
        window.addEventListener("pageshow", medir);    // al volver desde el historial
        medir();
    })();

    // Cabecera: transparente sobre el hero, marfil al desplazarse
    (function() {
        const topbar = document.querySelector("nav.topbar");
        if (!topbar) return;
        const onScroll = () => topbar.classList.toggle("scrolled", window.scrollY > 30);
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
    })();

    // Revelado al bajar: secciones y separadores entran al aparecer en pantalla
    (function() {
        const SEL = ".reveal:not(.in), .rule:not(.in)";

        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            document.querySelectorAll(SEL).forEach(el => el.classList.add("in"));
            window.revelarVisibles = function(){};
            return;
        }

        let pendiente = false;

        function comprobar() {
            pendiente = false;
            const limite = window.innerHeight * 0.92;
            document.querySelectorAll(SEL).forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) return;   // sigue oculto en otra vista
                if (r.top < limite && r.bottom > 0) el.classList.add("in");
            });
        }

        function programar() {
            if (pendiente) return;
            pendiente = true;
            requestAnimationFrame(comprobar);
        }

        window.addEventListener("scroll", programar, { passive: true });
        window.addEventListener("resize", programar, { passive: true });
        window.revelarVisibles = comprobar;   // comprobación inmediata al cambiar de vista
        comprobar();
    })();

    // El inicio es la vista que se muestra al cargar
    document.body.classList.add("en-inicio");

    // Persiana dorada del hero: al bajar, las barras engordan hasta tapar el vídeo
    (function() {
        const hero = document.querySelector(".hero-seccion");
        const persiana = document.getElementById("heroPersiana");
        if (!hero || !persiana) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        // Una barra cada ~40px: misma densidad en móvil y en escritorio
        const SEPARACION = 40;
        let barras = [];

        function construir() {
            const cuantas = Math.max(6, Math.round(window.innerWidth / SEPARACION));
            if (barras.length === cuantas) return;
            persiana.textContent = "";
            for (let i = 0; i < cuantas; i++) persiana.appendChild(document.createElement("span"));
            barras = Array.from(persiana.children);
        }

        const entre = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));
        let pendiente = false;

        function pintar() {
            pendiente = false;
            const recorrido = hero.offsetHeight * 0.85;
            if (recorrido <= 0) return;
            const p = Math.min(1, window.scrollY / recorrido);

            // Lamas de persiana veneciana girando sobre su eje vertical: de 90°
            // (de canto, invisibles) a 0° (planas, tapan el vídeo). En ola de
            // izquierda a derecha: cada lama arranca algo después que su vecina.
            const N = barras.length;
            barras.forEach((b, i) => {
                const inicio = 0.40 + (i / N) * 0.30;
                const prog = entre(p, inicio, inicio + 0.25);
                const grados = 90 * (1 - prog);
                // 1.02 de escala al cerrar: evita costuras de sub-píxel entre lamas
                b.style.transform = "rotateY(" + grados.toFixed(2) + "deg) scaleX(" + (prog < 1 ? 1 : 1.02) + ")";
                // aparece justo al empezar su giro, no antes
                b.style.opacity = Math.min(1, prog * 6).toFixed(3);
            });
        }

        function programar() {
            if (pendiente) return;
            pendiente = true;
            requestAnimationFrame(pintar);
        }

        window.addEventListener("scroll", programar, { passive: true });
        window.addEventListener("resize", () => { construir(); programar(); }, { passive: true });
        window.actualizarPersiana = pintar;   // recálculo inmediato al cambiar de vista
        construir();
        pintar();
    })();

    // Scroll inmersivo de Sobre Mí: mientras la sección está clavada, las
    // columnas de trabajos, la foto y los párrafos avanzan atados al scroll
    (function() {
        const pista = document.getElementById("inmersivoSobreMi");
        if (!pista) return;
        const columnas = Array.from(pista.querySelectorAll(".inm-col"));
        const foto = pista.querySelector(".inm-foto");
        const parrafos = Array.from(pista.querySelectorAll(".inm-parrafo"));
        const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        const entre = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));
        let pendiente = false;

        // Reparte las fotos reales de la galería en las tres columnas
        window.montarColumnasInmersivas = function() {
            const fuente = document.getElementById("galeriaPublica");
            if (!fuente || !columnas.length) return;
            const urls = Array.from(fuente.querySelectorAll("img")).map(i => i.src).filter(Boolean);
            if (!urls.length) return;
            columnas.forEach(c => c.textContent = "");
            // duplicamos la lista para que ninguna columna se quede corta al desplazarse
            urls.concat(urls).forEach((src, i) => {
                const img = document.createElement("img");
                img.src = src;
                img.alt = "";
                img.loading = "lazy";
                columnas[i % columnas.length].appendChild(img);
            });
            programar();
        };

        function pintar() {
            pendiente = false;
            if (sinMovimiento) return;
            const total = pista.offsetHeight - window.innerHeight;
            if (total <= 0) return;
            const p = Math.max(0, Math.min(1, -pista.getBoundingClientRect().top / total));

            // Columnas: cada una viaja a su ritmo (la del medio más rápida)
            columnas.forEach(c => {
                const vel = parseFloat(c.dataset.vel) || 1;
                c.style.transform = "translate3d(0," + (-p * vel * 26).toFixed(2) + "%,0)";
            });

            // Foto: se revela con máscara y se acerca despacio
            if (foto) {
                const q = entre(p, 0.04, 0.34);
                foto.style.clipPath = "inset(0 0 " + ((1 - q) * 100).toFixed(1) + "% 0)";
                foto.style.transform = "scale(" + (1.1 - 0.1 * q).toFixed(4) + ")";
            }

            // Párrafos: entran escalonados a lo largo del recorrido
            parrafos.forEach((el, i) => {
                const q = entre(p, 0.20 + i * 0.13, 0.20 + i * 0.13 + 0.15);
                el.style.opacity = q.toFixed(3);
                el.style.transform = "translateY(" + ((1 - q) * 24).toFixed(1) + "px)";
            });
        }

        function programar() {
            if (pendiente) return;
            pendiente = true;
            requestAnimationFrame(pintar);
        }

        window.addEventListener("scroll", programar, { passive: true });
        window.addEventListener("resize", programar, { passive: true });
        window.actualizarInmersivo = pintar;   // recálculo inmediato al cambiar de vista
        pintar();
    })();

    // Trabajos inmersivos: al bajar, las fotos entran una a una y al final
    // aparece la invitación a visitar el estudio
    (function() {
        const pista = document.getElementById("inmersivoTrabajos");
        if (!pista) return;
        const rejilla = document.getElementById("galeriaPublica");
        const invita = document.getElementById("trabajosInvita");
        const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        const entre = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));
        let piezas = [];
        let pendiente = false;

        window.montarTrabajos = function() {
            // solo las cuatro primeras son ventanas; el resto sigue en el DOM
            // porque alimenta las columnas del bloque de Sobre Mí
            piezas = Array.from(rejilla ? rejilla.querySelectorAll(".galeria-item") : []).slice(0, 4);
            programar();
        };

        function pintar() {
            pendiente = false;
            if (sinMovimiento) return;
            const total = pista.offsetHeight - window.innerHeight;
            if (total <= 0) return;
            const p = Math.max(0, Math.min(1, -pista.getBoundingClientRect().top / total));

            // cada ventana se abre de abajo arriba, una tras otra
            const n = piezas.length || 1;
            piezas.forEach((el, i) => {
                const desde = 0.08 + (i / n) * 0.52;
                const q = entre(p, desde, desde + 0.22);
                el.style.clipPath = "inset(" + ((1 - q) * 100).toFixed(1) + "% 0 0 0)";
                el.style.transform = "translateY(" + ((1 - q) * 22).toFixed(1) + "px)";
            });

            // la invitación entra cuando ya están las cuatro abiertas
            if (invita) {
                const q = entre(p, 0.74, 0.9);
                invita.style.opacity = q.toFixed(3);
                invita.style.transform = "translateY(" + ((1 - q) * 28).toFixed(1) + "px)";
            }
        }

        function programar() {
            if (pendiente) return;
            pendiente = true;
            requestAnimationFrame(pintar);
        }

        window.addEventListener("scroll", programar, { passive: true });
        window.addEventListener("resize", programar, { passive: true });
        window.actualizarTrabajos = pintar;
        pintar();
    })();

    // Dónde estamos: al bajar, la fila de paneles viaja de lado
    (function() {
        const pista = document.getElementById("lateralPista");
        const fila = document.getElementById("lateralFila");
        if (!pista || !fila) return;
        const puntos = Array.from(document.querySelectorAll("#lateralPuntos span"));
        const paneles = Array.from(fila.querySelectorAll(".lat-panel"));
        const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let pendiente = false;

        function pintar() {
            pendiente = false;
            if (sinMovimiento) return;
            const total = pista.offsetHeight - window.innerHeight;
            if (total <= 0) return;
            const p = Math.max(0, Math.min(1, -pista.getBoundingClientRect().top / total));

            // la fila se desplaza justo lo que sobresale de la pantalla
            const desplazable = fila.scrollWidth - window.innerWidth;
            fila.style.transform = "translate3d(" + (-p * desplazable).toFixed(1) + "px,0,0)";

            // el indicador marca en qué panel estamos
            if (puntos.length) {
                const i = Math.min(puntos.length - 1, Math.round(p * (paneles.length - 1)));
                puntos.forEach((s, k) => s.classList.toggle("activo", k === i));
            }
        }

        function programar() {
            if (pendiente) return;
            pendiente = true;
            requestAnimationFrame(pintar);
        }

        window.addEventListener("scroll", programar, { passive: true });
        window.addEventListener("resize", programar, { passive: true });
        window.actualizarLateral = pintar;
        pintar();
    })();

    // Próximos huecos reales: reutiliza el horario, los bloqueos y la RPC
    // "horas_ocupadas", que devuelve la ocupación sin datos personales
    async function cargarProximosHuecos() {
        const cuerpo = document.getElementById("latHuecosCuerpo");
        if (!cuerpo || typeof sb === "undefined") return;

        const DIAS_A_MOSTRAR = 3;      // días con hueco que enseñamos
        const HORAS_POR_DIA  = 3;      // huecos por día
        const DURACION_MIN   = 60;     // hueco útil mínimo, en minutos
        const SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00",
                       "16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00"];

        const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        const DIAS = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

        try {
            if (!disponibilidadCargada) throw new Error("Disponibilidad sin verificar");
            const hoy = new Date(); hoy.setHours(0,0,0,0);
            const encontrados = [];

            for (let salto = 1; salto <= 21 && encontrados.length < DIAS_A_MOSTRAR; salto++) {
                const d = new Date(hoy); d.setDate(d.getDate() + salto);
                const fecha = iso(d);
                if (typeof isDiaDisponible === "function" && !isDiaDisponible(fecha)) continue;

                const { data, error } = await sb.rpc("horas_ocupadas", { p_fecha: fecha });
                if (error) throw error;
                const ocupadas = (data || []).map(c => ({ ...c, fecha }));

                const todos = SLOTS.filter(t =>
                    !slotFueraDeHorario(t, DURACION_MIN) && !slotBloqueado(t, ocupadas, DURACION_MIN, fecha)
                );
                // repartidas a lo largo del día, no las tres primeras seguidas:
                // así se ve que hay hueco de mañana y de tarde
                const libres = todos.length <= HORAS_POR_DIA ? todos
                    : [...new Set(Array.from({length: HORAS_POR_DIA}, (_, i) =>
                        todos[Math.round(i * (todos.length - 1) / (HORAS_POR_DIA - 1))]))];

                if (libres.length) encontrados.push({ fecha, etiqueta: `${DIAS[d.getDay()]} ${d.getDate()}`, horas: libres });
            }

            if (!encontrados.length) {
                cuerpo.innerHTML = `<p class="lat-huecos-lleno">Estos días están completos.<br>
                    <a href="https://wa.me/34644911596" target="_blank" rel="noopener" style="color:var(--burgundy);font-weight:600;">Escríbeme por WhatsApp</a>
                    y te aviso si queda alguna cancelación.</p>`;
                return;
            }

            cuerpo.innerHTML = encontrados.map(d => `
                <div class="lat-dia">
                    <div class="lat-dia-nombre">${d.etiqueta}</div>
                    <div class="lat-horas">${d.horas.map(h =>
                        `<button type="button" class="lat-hora" onclick="reservarHueco('${d.fecha}', '${h}')">${h}</button>`
                    ).join("")}</div>
                </div>`).join("");

            // entran flotando, una tras otra
            cuerpo.querySelectorAll(".lat-dia").forEach((el, i) =>
                setTimeout(() => el.classList.add("in"), 120 * i));

        } catch (e) {
            console.error("Huecos:", e);
            cuerpo.innerHTML = `<p class="lat-huecos-lleno">Consulta la disponibilidad al reservar tu cita.</p>`;
        }
    }

    window.reservarHueco = function(fecha, hora) {
        _huecoPendiente = { fecha, hora };
        mostrarVista('vistaReservar');
    };

    // Menú "Sobre Mí": desliza suavemente hasta la sección del inicio
    window.irASobreMi = function() {
        toggleMobileMenu(true);

        const destino = document.getElementById("sobreMi");
        if (!destino) return;

        const inicio = document.getElementById("login");
        const inicioOculto = inicio && getComputedStyle(inicio).display === "none";

        const deslizar = () => destino.scrollIntoView({ behavior: "smooth", block: "start" });

        if (inicioOculto) {
            // Volvemos al inicio y esperamos a que mostrarVista termine su scroll al tope
            mostrarVista("login");
            setTimeout(deslizar, 90);
        } else {
            deslizar();
        }
    };

    // Acordeón de servicios en móvil (delegado, funciona con contenido dinámico)
    document.addEventListener("click", function(e) {
        if (window.innerWidth >= 768) return;
        const titulo = e.target.closest(".servicio-grupo-titulo");
        if (!titulo || !titulo.closest("#publicServicioGrid")) return;
        const grupo = titulo.closest(".servicio-grupo");
        if (grupo) grupo.classList.toggle("colapsado");
    });

    const RUTAS = {
        login: 'inicio', vistaPrecios: 'precios', vistaResenas: 'resenas',
        vistaReservar: 'reservar', vistaPedirCita: 'registro',
        vistaCliente: 'mi-cuenta', vistaAccesoAdmin: 'acceso-salon', vistaAdmin: 'salon'
    };
    function vistaDesdeURL() {
        return Object.keys(RUTAS).find(key => RUTAS[key] === location.hash.slice(1));
    }
    function mostrarVista(id, options = {}) {
        if (!Object.hasOwn(RUTAS, id)) id = 'login';
        if (id === 'vistaAccesoAdmin' && _adminAutenticada) id = 'vistaAdmin';
        if (id === 'vistaAdmin' && !_adminAutenticada) id = 'vistaAccesoAdmin';
        if (id === 'vistaCliente' && !_clienteLogueado) { id = 'login'; _irAlAcceso = true; }
        if (options.history !== false && location.hash !== '#' + RUTAS[id]) {
            history.pushState({ view: id }, '', '#' + RUTAS[id]);
        }
        // cierre completo del menú móvil: sin esto el body se quedaba con
        // overflow:hidden y el móvil no podía desplazar
        toggleMobileMenu(true);

        ["login","vistaCliente","vistaPedirCita","vistaReservar","vistaAccesoAdmin","vistaAdmin","vistaPrecios","vistaResenas"].forEach(v => {
            const el = document.getElementById(v);
            if (el) el.style.display = "none";
        });
        const adminMenu = document.getElementById("adminMenu");
        const body      = document.body;
        if (adminMenu) { adminMenu.classList.remove("show"); setTimeout(()=>{ if (!body.classList.contains("admin-mode")) adminMenu.style.display="none"; }, 400); }

        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = id === "vistaAdmin" ? "block" : "flex";
        el.querySelectorAll(".view-anim").forEach(a => { a.style.animation="none"; a.offsetHeight; a.style.animation=""; });
        body.classList.toggle("en-inicio", id === "login");
        // el agua solo se dibuja donde se ve: en el inicio queda tapada
        if (typeof window.ajustarAgua === "function") window.ajustarAgua(id !== "login");
        if (typeof window.revelarVisibles === "function") {
            window.revelarVisibles();
            // el scroll al tope de más abajo es suave: repasamos cuando haya terminado
            setTimeout(window.revelarVisibles, 600);
        }

        if (id === "vistaAdmin") {
            body.classList.add("admin-mode");
            el.classList.add("active-layout");
            if (adminMenu) { adminMenu.style.display="flex"; setTimeout(()=>adminMenu.classList.add("show"),50); }
            cargarDatosAdmin().then(()=>{ try{showWelcome();}catch(e){} });
        } else {
            body.classList.remove("admin-mode");
            document.getElementById("vistaAdmin")?.classList.remove("active-layout");
        }

        // El login se presenta según de dónde vengas
        if (id === "login") {
            const t = document.getElementById("loginTitulo");
            const s = document.getElementById("loginSubtitulo");
            if (t && s) {
                t.textContent = _loginParaReservar ? "Inicia sesión para reservar" : "Iniciar Sesión";
                s.textContent = _loginParaReservar
                    ? "¿Aún no tienes cuenta? Créala aquí abajo, tarda un minuto."
                    : "Accede para reservar tu cita y ver tus puntos";
            }
            _loginParaReservar = false;
        }

        // Se puede consultar el servicio y el hueco antes de identificarse.
        if (id === 'vistaReservar') {
            const label = document.querySelector('#btnEnviarReserva > span');
            if (label) label.textContent = _clienteLogueado ? 'Solicitar cita' : 'Continuar para reservar';
            (async () => {
                if (!NC_SERVICIOS.length) await cargarCatServicios();
                await cargarDisponibles();
                initPicker();
                if (_huecoPendiente) {
                    const { fecha, hora } = _huecoPendiente;
                    _huecoPendiente = null;
                    const [y, m, d] = fecha.split('-').map(Number);
                    selectedDate = new Date(y, m - 1, d);
                    selectedTime = hora;
                    calCursor = new Date(y, m - 1, 1);
                    activePeriod = toMin(hora) < 14 * 60 ? 'morning' : 'afternoon';
                    document.getElementById('pickedDateLabel').textContent = fmtPretty(selectedDate);
                    document.getElementById('pickedDateLabel').classList.remove('empty');
                    document.getElementById('pickedTimeLabel').textContent = hora + ' h';
                    document.getElementById('pickedTimeLabel').classList.remove('empty');
                    document.querySelectorAll('#vistaReservar .time-tab').forEach(t => t.classList.toggle('active', t.dataset.period === activePeriod));
                }
                if (selectedDate) {
                    try { await cargarOcupacion(fmtISO(selectedDate)); }
                    catch { selectedTime = null; toast('No se pudieron verificar las horas. Selecciona la fecha para reintentar.', 'error'); }
                }
                renderCalendar(); renderTimeSlots();
            })().catch(() => toast('No se pudo cargar la reserva. Inténtalo de nuevo.', 'error'));
        }


        // Al volver al perfil del cliente, refrescar datos
        if (id === "vistaCliente" && _clienteLogueado && !_renderingPerfil) {
            _renderingPerfil = true;
            mostrarPerfilCliente(_clienteLogueado, true).finally(() => { _renderingPerfil = false; });
        }

        // El inicio contiene toda la página (hero, acceso, Sobre Mí, trabajos,
        // ubicación). Si venimos a iniciar sesión, subir al tope deja la tarjeta
        // de acceso fuera de pantalla y parece que no ha pasado nada: vamos a ella.
        if (id === "login" && _irAlAcceso) {
            _irAlAcceso = false;
            const acceso = document.getElementById("bloqueAcceso");
            if (acceso) {
                setTimeout(() => {
                    acceso.scrollIntoView({ behavior: "smooth", block: "center" });
                    // la tarjeta se revela con el scroll: forzamos el repaso para
                    // que no llegue invisible si el desplazamiento es corto
                    if (typeof window.revelarVisibles === "function") {
                        window.revelarVisibles();
                        setTimeout(window.revelarVisibles, 500);
                    }
                }, 60);
                return;
            }
        }
        window.scrollTo({top:0,behavior:"smooth"});
    }

    function limpiarSesionLocal() {
        _clienteLogueado = null;
        _adminAutenticada = false;
        _reservaPendiente = false;
        clientas = []; citas = []; ocupacionCargada.clear();
        sessionStorage.removeItem('adminAuth');
    }
    async function cerrarSesionComun() {
        try {
            await checked(sb.auth.signOut());
            limpiarSesionLocal(); resetPicker(); mostrarVista('login');
        } catch { toast('No se pudo cerrar la sesión. Inténtalo de nuevo.', 'error'); }
    }
    window.cerrarSesion = cerrarSesionComun;
    window.cerrarSesionAdmin = cerrarSesionComun;

    async function restaurarSesion() {
        const { data: { session } } = await checked(sb.auth.getSession());
        if (!session) { limpiarSesionLocal(); return; }
        const { data: admin } = await checked(sb.from('admins').select('id').eq('id', session.user.id).maybeSingle());
        _adminAutenticada = !!admin;
        const { data: profile } = await checked(sb.from('clientas').select('*').eq('id', session.user.id).maybeSingle());
        if (profile) await mostrarPerfilCliente(profile, true);
    }
    sb.auth.onAuthStateChange((event) => {
        // Keep Supabase queries outside its auth callback/lock.
        if (event === 'SIGNED_OUT') {
            limpiarSesionLocal();
            setTimeout(() => mostrarVista('login'), 0);
        }
        if (event === 'PASSWORD_RECOVERY') {
            setTimeout(() => document.getElementById('modalCambiarClave').classList.add('show'), 0);
        }
    });
    window.addEventListener('popstate', () => mostrarVista(vistaDesdeURL() || 'login', { history: false }));


    // ── Admin sections ─────────────────────────────────────
    const ADMIN_SECTIONS = ["agenda","solicitudes","fidelizacion","disponibilidad","historial","usuarios","resenas","galeria","servicios"];
    function switchAdminSection(name) {
        ADMIN_SECTIONS.forEach(s => {
            const el = document.getElementById("asec"+s.charAt(0).toUpperCase()+s.slice(1));
            if (el) el.style.display = s===name ? "contents" : "none";
        });
        document.querySelectorAll(".admin-menu-item[data-section]").forEach(b => {
            b.classList.toggle("active", b.dataset.section===name);
        });
        if (name === "usuarios") {
            cargarEmailNotificacion();
        }

    }

    // ── Welcome modal ──────────────────────────────────────
    function showWelcome() {
        const pend = citas.filter(c=>(c.estado||"pendiente")==="pendiente").length;
        const hoy  = citas.filter(c=>c.fecha===fmtISO(today) && (c.estado||"pendiente")!=="cancelada").length;
        document.getElementById("welcomePendientes").textContent = pend;
        document.getElementById("welcomeHoy").textContent = hoy;
        const modal = document.getElementById("welcomeModal");
        modal.style.display = "flex";
        setTimeout(()=>modal.classList.add("show"),50);
    }
    function closeWelcome() {
        const modal = document.getElementById("welcomeModal");
        modal.classList.remove("show");
        setTimeout(()=>modal.style.display="none",500);
    }

    // ══════════════════════════════════════════════════════
    //  DÍAS DISPONIBLES
    // ══════════════════════════════════════════════════════
    function isDiaDisponible(iso) {
        if (!disponibilidadCargada) return false;
        // Solo se consideran abiertos los días tras verificar los bloqueos.
        const mes = iso.slice(0,7);
        // Comprobar si el día o su mes están explícitamente bloqueados
        const bloqueado = diasDisponibles.some(b =>
            (b.tipo === "dia_bloqueado" && b.valor === iso) ||
            (b.tipo === "mes_bloqueado" && b.valor === mes)
        );
        return !bloqueado;
    }

    async function cargarDisponibles() {
        disponibilidadCargada = false;
        try {
            const { data, error } = await sb.from("dias_disponibles").select("*");
            if (error) {
                console.error("Error cargando disponibilidad:", error.message);
                diasDisponibles = [];
            } else {
                diasDisponibles = data || [];
                disponibilidadCargada = true;
            }
        } catch(e) {
            console.error("Excepción cargando disponibilidad:", e);
            diasDisponibles = [];
        }
        try { renderDCalendar(); }    catch(e){}
        try { renderMesesGrid(); }    catch(e){}
        try { renderDispDiaItems(); } catch(e){}
        try { renderCalendar(); }     catch(e){}
        try { renderTimeSlots(); }    catch(e){}
        try { renderHCalendar(); }    catch(e){}
        try { renderHorasLista(); }   catch(e){}
        return disponibilidadCargada;
    }

    // ══════════════════════════════════════════════════════
    //  CALENDAR PICKER (formulario cita)
    // ══════════════════════════════════════════════════════
    function renderCalendar() {
        const monthEl = document.getElementById("calMonth");
        const grid    = document.getElementById("calGrid");
        if (!monthEl || !grid) return;

        monthEl.textContent = `${MONTHS_ES[calCursor.getMonth()]} ${calCursor.getFullYear()}`;
        document.getElementById("calPrev").disabled = calCursor <= new Date(today.getFullYear(), today.getMonth(), 1);

        grid.innerHTML = "";
        DOW_ES.forEach(d => grid.innerHTML += `<div class="cal-dow">${d}</div>`);

        const y = calCursor.getFullYear(), m = calCursor.getMonth();
        const firstDay = new Date(y,m,1);
        const offset   = (firstDay.getDay()+6)%7;
        const dim      = new Date(y,m+1,0).getDate();
        const prevDim  = new Date(y,m,0).getDate();

        for (let i=offset-1; i>=0; i--) grid.innerHTML += `<div class="cal-day muted">${prevDim-i}</div>`;

        for (let d=1; d<=dim; d++) {
            const dt  = new Date(y,m,d);
            const iso = fmtISO(dt);
            const past = dt < today;
            const disp = isDiaDisponible(iso);
            const isSel = selectedDate && fmtISO(selectedDate)===iso;
            let cls = "cal-day";
            if (past)  cls += " disabled";
            else if (!disp) cls += " no-disponible";
            if (dt.getTime()===today.getTime()) cls += " today";
            if (isSel) cls += " selected";
            grid.innerHTML += `<div class="${cls}" data-iso="${iso}">${d}</div>`;
        }
        const trail = (7-((offset+dim)%7))%7;
        for (let i=1; i<=trail; i++) grid.innerHTML += `<div class="cal-day muted">${i}</div>`;

        grid.querySelectorAll(".cal-day:not(.disabled):not(.muted):not(.no-disponible)").forEach(el => {
            el.addEventListener("click", async () => {
                const [y2,m2,d2] = el.dataset.iso.split("-").map(Number);
                selectedDate = new Date(y2,m2-1,d2);
                // Si cambia la fecha, limpiar hora
                if (selectedTime) {
                    selectedTime = null;
                    document.getElementById("pickedTimeLabel").textContent = "Sin elegir";
                    document.getElementById("pickedTimeLabel").classList.add("empty");
                }
                document.getElementById("pickedDateLabel").textContent = fmtPretty(selectedDate);
                document.getElementById("pickedDateLabel").classList.remove("empty");
                const fecha = el.dataset.iso;
                ocupacionCargada.delete(fecha);
                renderCalendar(); renderTimeSlots();
                try { await cargarOcupacion(fecha); }
                catch { toast('No se pudieron comprobar las horas. Vuelve a seleccionar la fecha.', 'error'); }
                if (!selectedDate || fmtISO(selectedDate) !== fecha) return;


                renderCalendar();
                renderTimeSlots();
            });
        });
    }

    function renderTimeSlots() {
        const wrap = document.getElementById("timeSlots");
        if (!wrap) return;
        wrap.innerHTML = "";

        if (!disponibilidadCargada) {
            wrap.innerHTML = `<div class="time-empty">No se pudo verificar la disponibilidad. <button type="button" onclick="mostrarVista('vistaReservar')">Reintentar</button></div>`;
            selectedTime = null;
            return;
        }
        if (!selectedDate) {
            wrap.innerHTML = `<div class="time-empty">Elige primero una fecha</div>`;
            return;
        }
        if (!selectedServicio) {
            wrap.innerHTML = `<div class="time-empty">Elige primero el servicio</div>`;
            return;
        }
        // Si el día está cerrado (mes no habilitado o día excluido), no mostrar horas
        const isoCheck = fmtISO(selectedDate);
        if (!isDiaDisponible(isoCheck)) {
            wrap.innerHTML = `<div class="time-empty">Este día no está disponible</div>`;
            selectedTime = null;
            const lbl = document.getElementById("pickedTimeLabel");
            if (lbl) { lbl.textContent = "Sin elegir"; lbl.classList.add("empty"); }
            return;
        }

        const iso = fmtISO(selectedDate);
        if (!ocupacionCargada.has(iso)) {
            wrap.innerHTML = '<div class="time-empty">Selecciona de nuevo la fecha para comprobar sus horas.</div>';
            return;
        }
        const citasDelDia = citas.filter(c => c.fecha===iso);
        const now   = new Date();
        const esHoy = iso === fmtISO(today);

        if (selectedTime && (slotFueraDeHorario(selectedTime, getTotalDuracion()) ||
            slotBloqueado(selectedTime, citasDelDia, getTotalDuracion(), iso) ||
            (esHoy && toMin(selectedTime) <= now.getHours() * 60 + now.getMinutes()))) {
            selectedTime = null;
            document.getElementById('pickedTimeLabel').textContent = 'Sin elegir';
            document.getElementById('pickedTimeLabel').classList.add('empty');
        }
        SLOTS[activePeriod].forEach(t => {
            const tMin    = toMin(t);
            const pasado  = esHoy && tMin <= now.getHours()*60+now.getMinutes();
            const totalDur = getTotalDuracion();
            const fuera   = slotFueraDeHorario(t, totalDur);
            const bloq    = slotBloqueado(t, citasDelDia, totalDur, iso);
            const noDisp  = pasado || fuera || bloq;
            const isSel   = selectedTime===t && !noDisp;
            const subtext = bloq ? `<span style="font-size:8px;display:block;line-height:1.2;opacity:.6;">ocupado</span>`
                          : fuera ? `<span style="font-size:8px;display:block;line-height:1.2;opacity:.6;">no cabe</span>`
                          : "";
            wrap.innerHTML += `<button type="button" class="time-slot${isSel?" selected":""}${noDisp?" disabled":""}" data-time="${t}"${noDisp?" disabled":""}>${t}${subtext}</button>`;
        });

        wrap.querySelectorAll(".time-slot:not([disabled])").forEach(el => {
            el.addEventListener("click", () => {
                selectedTime = el.dataset.time;
                document.getElementById("pickedTimeLabel").textContent = `${selectedTime} h`;
                document.getElementById("pickedTimeLabel").classList.remove("empty");
                renderTimeSlots();
            });
        });
    }

    let _pickerInitialized = false;
    function initPicker() {
        const date = selectedDate || today;
        calCursor = new Date(date.getFullYear(), date.getMonth(), 1);
        renderCalendar();
        renderTimeSlots();

        if (_pickerInitialized) return;  // evitar duplicar listeners
        _pickerInitialized = true;

        document.getElementById("calPrev").addEventListener("click", () => {
            const min = new Date(today.getFullYear(), today.getMonth(), 1);
            const cand = new Date(calCursor.getFullYear(), calCursor.getMonth()-1, 1);
            if (cand >= min) { calCursor = cand; renderCalendar(); }
        });
        document.getElementById("calNext").addEventListener("click", () => {
            calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth()+1, 1);
            renderCalendar();
        });
        document.querySelectorAll("#vistaReservar .time-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                document.querySelectorAll("#vistaReservar .time-tab").forEach(t=>t.classList.remove("active"));
                tab.classList.add("active");
                activePeriod = tab.dataset.period;
                renderTimeSlots();
            });
        });

        // Funciones para el Acordeón Dinámico de Servicios
        // (selectedExtras es global; aquí solo lo reiniciamos para esta sesión de picker)
        selectedExtras = [];

        window.renderClientAccordion = function() {
            const grid = document.getElementById("servicioGrid");
            const extrasGrid = document.getElementById("extrasGrid");
            if(!grid) return;

            let html = '';
            NC_SERVICIOS.forEach((g, idx) => {
                if (g.isExtras) return;
                html += `<div class="accordion-grupo" style="border:1px solid rgba(229,218,206,0.5);border-radius:12px;margin-bottom:12px;overflow:hidden;background:#fff;">
                    <div class="accordion-header" onclick="toggleAcc(${idx})" style="display:flex;justify-content:space-between;align-items:center;padding:16px;background:rgba(229,218,206,0.2);cursor:pointer;font-family:'Instrument Serif',serif;font-size:16px;color:var(--burgundy);font-weight:600;transition:background 0.2s;">
                        <span>${escapeHTML(g.grupo)}</span>
                        <i class="fa-solid fa-chevron-down accordion-icon" id="accIcon${idx}" style="transition:transform 0.3s ease;font-size:14px;"></i>
                    </div>
                    <div class="accordion-body" id="accBody${idx}" style="display:none;border-top:1px solid rgba(229,218,206,0.5);background:#fff;">`;

                g.items.filter(it => !it.isExtraAddon).forEach(it => {
                    const priceNum = parsePrecio(it.precio);
                    html += `<div style="border-bottom:1px solid rgba(229,218,206,0.3); padding-bottom:8px;">
                        <div class="servicio-opcion" onclick="selSrvAcc(${inlineArg(it.val)}, ${it.dur}, ${priceNum}, ${inlineArg(g.grupo)}, this)" style="border:none;border-radius:0;margin:0;padding-bottom:4px;">
                            <span class="servicio-opcion-nombre">${it.isExtraAddon ? '<i class="fa-solid fa-plus" style="margin-right:6px;font-size:10px;color:var(--burgundy);"></i>' : ''}${escapeHTML(it.nombre)}</span>
                            <span class="servicio-opcion-precio">${escapeHTML(it.precio)}</span>
                            <span class="servicio-opcion-dur">${escapeHTML(it.durTxt)}</span>
                        </div>
                        ${it.desc ? `<div style="font-size:11.5px; color:var(--muted); padding: 0 16px 4px 16px; line-height:1.4; text-align:justify;">${escapeHTML(it.desc)}</div>` : ''}
                    </div>`;
                });
                html += `</div></div>`;
            });
            grid.innerHTML = html;

            // Extras are rendered for the selected service in updateExtrasUI.
        };

        window.toggleAcc = function(idx) {
            const body = document.getElementById("accBody"+idx);
            const icon = document.getElementById("accIcon"+idx);
            const isO = body.style.display === "block";
            // Close all
            document.querySelectorAll(".accordion-body").forEach(b=>b.style.display="none");
            document.querySelectorAll(".accordion-icon").forEach(i=>i.style.transform="rotate(0deg)");
            if(!isO) {
                body.style.display = "block";
                icon.style.transform = "rotate(180deg)";
            }
        };

        window.selSrvAcc = function(val, dur, precio, grupo, el) {
            document.querySelectorAll("#servicioGrid .servicio-opcion").forEach(e=>e.classList.remove("selected"));
            el.classList.add("selected");
            selectedServicio = val;
            selectedDuracion = dur;
            selectedPrecio = precio;
            updateExtrasUI();


            recalcServicioLabel();
            checkHoraBloqueada();
        };

        window.selExtraAcc = function(name, dur, precio, el) {
            const idx = selectedExtras.findIndex(e => e.name === name);
            if(idx >= 0) {
                selectedExtras.splice(idx, 1);
                el.classList.remove("selected");
                el.querySelector("i").className = "fa-regular fa-square";
            } else {
                selectedExtras.push({name, dur, precio});
                el.classList.add("selected");
                el.querySelector("i").className = "fa-solid fa-square-check";
            }
            recalcServicioLabel();
            checkHoraBloqueada();
        };

        function checkHoraBloqueada() {
            if (selectedTime && selectedDate) {
                const citasDelDia = citas.filter(c=>c.fecha===fmtISO(selectedDate));
                if (slotBloqueado(selectedTime,citasDelDia,getTotalDuracion(),fmtISO(selectedDate))||slotFueraDeHorario(selectedTime,getTotalDuracion())) {
                    selectedTime = null;
                    document.getElementById("pickedTimeLabel").textContent="Sin elegir";
                    document.getElementById("pickedTimeLabel").classList.add("empty");
                }
            }
            renderTimeSlots();
        }

        renderClientAccordion();

    }

    function getTotalDuracion() {
        return selectedDuracion + selectedExtras.reduce((sum, e) => sum + e.dur, 0);
    }

    function getTotalPrecio() {
        return selectedPrecio + selectedExtras.reduce((sum, e) => sum + e.precio, 0);
    }

    function recalcServicioLabel() {
        const label = document.getElementById("pickedServiceLabel");
        if (!selectedServicio) { if (label) { label.innerHTML = "Sin elegir"; label.classList.add("empty"); } return; }
        let txt = selectedServicio.split(" · ")[1] || selectedServicio;
        if (selectedExtras.length) txt += " + " + selectedExtras.map(e => e.name).join(" + ");
        const totalPrecio = getTotalPrecio();
        txt = escapeHTML(txt);
        txt += ` <span style="color:var(--accent);font-weight:700;margin-left:6px;">${totalPrecio}€</span>`;
        if (label) { label.innerHTML = txt; label.classList.remove("empty"); }
    }

    function updateExtrasUI() {
        selectedExtras = [];
        const container = document.getElementById('extrasGrid');
        const baseGroup = NC_SERVICIOS.find(group => group.items.some(item => item.val === selectedServicio));
        const combo = /combo/i.test(baseGroup?.grupo || '');
        const groups = NC_SERVICIOS.filter(group => group.isExtras && (!/combo/i.test(group.grupo) || combo));
        container.style.display = groups.length ? 'block' : 'none';
        container.innerHTML = groups.map(group => '<div class="servicio-grupo-titulo">' + escapeHTML(group.grupo) + '</div>' +
            group.items.map(item => '<button type="button" class="servicio-opcion extra-addon" onclick="selExtraAcc(' +
                inlineArg(item.nombre) + ', ' + Number(item.dur) + ', ' + parsePrecio(item.precio) + ', this)">' +
                '<span><i class="fa-regular fa-square" aria-hidden="true"></i> ' + escapeHTML(item.nombre) + '</span>' +
                '<span>' + escapeHTML(item.precio) + ' · ' + escapeHTML(item.durTxt) + '</span></button>').join('')).join('');
    }

    function resetPicker() {
        selectedDate = null; selectedTime = null;
        selectedServicio = null; selectedDuracion = 0; selectedPrecio = 0;
        selectedExtras = [];
        activePeriod = "morning";
        calCursor = new Date(today.getFullYear(), today.getMonth(), 1);
        ["pickedDateLabel","pickedTimeLabel","pickedServiceLabel"].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.textContent="Sin elegir"; el.classList.add("empty"); }
        });
        document.querySelectorAll("#servicioGrid .servicio-opcion").forEach(e=>e.classList.remove("selected"));
        document.querySelectorAll("#extrasGrid .extra-addon i").forEach(i => i.className = "fa-regular fa-square");
        document.querySelectorAll("#extrasGrid .extra-addon").forEach(e=>e.classList.remove("selected"));
        if(document.getElementById("extrasGrid")) document.getElementById("extrasGrid").style.display = "none";
        document.querySelectorAll(".accordion-body").forEach(b=>b.style.display="none");
        document.querySelectorAll(".accordion-icon").forEach(i=>i.style.transform="rotate(0deg)");

        document.querySelectorAll("#vistaReservar .time-tab").forEach(t=>t.classList.toggle("active",t.dataset.period==="morning"));
        renderCalendar();
        renderTimeSlots();
    }


    // ══════════════════════════════════════════════════════
    //  HELPERS OTP — inputs de 8 dígitos
    // ══════════════════════════════════════════════════════
    function initOTPInputs(containerId, onComplete) {
        const container = document.getElementById(containerId);
        if (!container) return;
        // Clonar cada input para eliminar listeners anteriores
        const oldInputs = [...container.querySelectorAll('.otp-digit')];
        oldInputs.forEach(old => {
            const clone = old.cloneNode(true);
            clone.value = "";
            clone.classList.remove("filled");
            old.parentNode.replaceChild(clone, old);
        });
        const inputs = [...container.querySelectorAll('.otp-digit')];
        inputs.forEach((inp, i) => {
            inp.removeAttribute("maxlength"); // Permitir autocompletado en móviles
            inp.addEventListener("input", () => {
                let val = inp.value.replace(/\D/g,"");
                if (val.length > 1) {
                    val.slice(0,8).split("").forEach((ch,j) => {
                        if (inputs[i+j]) { inputs[i+j].value=ch; inputs[i+j].classList.add("filled"); }
                    });
                    inputs[Math.min(i+val.length, inputs.length-1)]?.focus();
                } else {
                    inp.value = val.slice(-1);
                    inp.classList.toggle("filled", !!inp.value);
                    if (inp.value && i < inputs.length-1) inputs[i+1].focus();
                }
                const code = inputs.map(x=>x.value).join("");
                if (code.length === 8 && onComplete) onComplete(code);
            });
            inp.addEventListener("keydown", e => {
                if (e.key==="Backspace" && !inp.value && i>0) inputs[i-1].focus();
            });
            inp.addEventListener("paste", e => {
                e.preventDefault();
                const pasted = (e.clipboardData||window.clipboardData).getData("text").replace(/\D/g,"").slice(0,8);
                pasted.split("").forEach((ch,j) => {
                    if (inputs[j]) { inputs[j].value=ch; inputs[j].classList.add("filled"); }
                });
                inputs[Math.min(pasted.length, inputs.length-1)]?.focus();
                const code = inputs.map(x=>x.value).join("");
                if (code.length===8 && onComplete) onComplete(code);
            });
        });
        setTimeout(() => inputs[0]?.focus(), 120);
    }
    function getOTPCode(containerId) {
        return [...document.querySelectorAll(`#${containerId} .otp-digit`)].map(x=>x.value).join("");
    }
    function clearOTPInputs(containerId) {
        document.querySelectorAll(`#${containerId} .otp-digit`).forEach(i=>{ i.value=""; i.classList.remove("filled"); });
    }

    // Countdown reusable
    let _cdIntervals = {};
    function startCountdown(spanId, btnId, seg=60) {
        clearInterval(_cdIntervals[btnId]);
        const span=document.getElementById(spanId), btn=document.getElementById(btnId);
        if (!span||!btn) return;
        btn.disabled=true; let s=seg; span.textContent=s;
        _cdIntervals[btnId] = setInterval(()=>{
            s--; span.textContent=s;
            if (s<=0) {
                clearInterval(_cdIntervals[btnId]);
                btn.disabled=false;
                btn.innerHTML="Reenviar código";
            }
        },1000);
    }


    window.solicitarRecuperacion = function() {
        document.getElementById('inputRecuperarEmail').value = '';
        document.getElementById('inputRecoveryCode').value = '';
        document.getElementById('inputRecoveryNewPass').value = '';
        document.getElementById('recoveryStep1').style.display = 'block';
        document.getElementById('recoveryStep2').style.display = 'none';
        document.getElementById('modalRecuperar').classList.add('show');
    }

    let _recoveryEmail = '';

    window.enviarRecuperacion = async function() {
        const email = document.getElementById('inputRecuperarEmail').value.trim().toLowerCase();
        if (!email) return toast("Introduce un correo válido", "error");

        setBtnLoading("btnRecuperar", true);
        try {
            const { data, error } = await sb.rpc('send_recovery_code', { p_email: email });
            if (error) {
                toast("Error: " + error.message, "error");
            } else {
                _recoveryEmail = email;
                toast("Código enviado a tu correo", "success");
                document.getElementById('recoveryStep1').style.display = 'none';
                document.getElementById('recoveryStep2').style.display = 'block';
            }
        } catch(e) {
            toast("Error de conexión", "error");
        } finally {
            setBtnLoading("btnRecuperar", false);
        }
    }

    window.verificarCodigoRecuperacion = async function() {
        const code = document.getElementById('inputRecoveryCode').value.trim();
        const newPass = document.getElementById('inputRecoveryNewPass').value;

        if (!code || code.length !== 6) return toast("Introduce el código de 6 dígitos", "error");
        if (!newPass || newPass.length < 6) return toast("La contraseña debe tener mínimo 6 caracteres", "error");

        setBtnLoading("btnVerifyRecovery", true);
        try {
            const { data, error } = await sb.rpc('verify_recovery_code', {
                p_email: _recoveryEmail,
                p_code: code,
                p_new_password: newPass
            });
            if (error) {
                toast("Error: " + error.message, "error");
            } else if (data && data.ok) {
                toast("¡Contraseña actualizada con éxito!", "success");
                document.getElementById('modalRecuperar').classList.remove('show');
                document.getElementById('modalClaveOk').classList.add('show');
            } else {
                toast(data?.error || "Código incorrecto o caducado", "error");
            }
        } catch(e) {
            toast("Error de conexión", "error");
        } finally {
            setBtnLoading("btnVerifyRecovery", false);
        }
    }

    // Cambiar clave desde perfil (admin o cliente logueado)
    window.procesarCambioClave = async function() {
        const nuevaClave = document.getElementById('inputNuevaClave').value;
        if (!nuevaClave || nuevaClave.length < 6) return toast("Mínimo 6 caracteres", "error");

        setBtnLoading("btnCambiarClave", true);
        try {
            const { error } = await sb.auth.updateUser({ password: nuevaClave });
            if (error) {
                toast("Error al actualizar: " + error.message, "error");
                setBtnLoading("btnCambiarClave", false);
                return;
            }

            // Enviar correo de confirmación
            const { error: rpcErr } = await sb.rpc('send_password_changed_email');
            if (rpcErr) console.log("RPC error:", rpcErr.message);

        } catch(e) {
            setBtnLoading("btnCambiarClave", false);
            toast("No se pudo cambiar la contraseña. Inténtalo de nuevo.", "error");
            return;
        }

        setBtnLoading("btnCambiarClave", false);
        document.getElementById('modalCambiarClave').classList.remove('show');
        document.getElementById('modalClaveOk').classList.add('show');

        // Si viene de un link de recuperación, cerrar sesión después
        if (window.location.hash) {
            setTimeout(() => { try { sb.auth.signOut(); } catch(e) {} }, 3000);
        }
    };

    async function iniciarSesionCliente() {
        const usuario = (document.getElementById("loginUsuario")?.value||"").trim().toLowerCase();
        const clave   = document.getElementById("loginPass")?.value||"";
        if (!usuario||!clave) return toast("Introduce correo y contraseña","error");

        setBtnLoading("btnLoginCliente",true);
        try {
            const { data: authData, error: authErr } = await sb.auth.signInWithPassword({
                email: usuario,
                password: clave
            });
            if (authErr) {
                toast("Error: " + (authErr.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : authErr.message), "error");
                return;
            }

            const userId = authData.user.id;
            const { data: profile, error: profErr } = await sb.from("clientas").select("*").eq("id", userId).maybeSingle();

            if (profErr || !profile) { toast("Error cargando perfil","error"); return; }

            toast("Bienvenida de nuevo","success");
            await mostrarPerfilCliente(profile, true);
            const destination = _reservaPendiente ? 'vistaReservar' : 'vistaCliente';
            _reservaPendiente = false;
            mostrarVista(destination);
        } catch(e) {
            toast("Error de conexión","error");
        } finally {
            setBtnLoading("btnLoginCliente",false);
        }
    }

    let _renderingPerfil = false;

    // Mostrar perfil cliente
    async function mostrarPerfilCliente(data, skipNavigation) {
        _clienteLogueado = data;  // Guardar datos del cliente logueado
        document.getElementById("clienteNombre").textContent = data.nombre;
        document.getElementById("stampCountText").textContent = data.visitas;
        const grid = document.getElementById("stampsGrid");
        grid.innerHTML = "";

        // Random rotations for a realistic hand-stamped look
        const rotations = [-12, 5, -8, 14, -5, 8, -15, 3, -4, 10];

        for (let i=1;i<=10;i++) {
            const isReward = (i===10 && data.visitas>=10);
            const isHalfReward = (i===5 && data.visitas>=5);
            const isActive = (i<=data.visitas);

            // Randomize rotation slightly for each stamp
            const rot = rotations[i-1] + "deg";

            // Stagger animation delay so they stamp one by one
            const delay = (i * 0.15) + "s";

            let stampHTML = "";
            if (isActive) {
                const markClass = (isReward || isHalfReward) ? "stamp-mark gold" : "stamp-mark";
                let icon = '<i class="fa-solid fa-check"></i>';
                if (isReward) icon = '<i class="fa-solid fa-gift"></i>';
                if (isHalfReward) icon = '<span style="font-size: 15px; font-weight: 900; letter-spacing: -1px; font-family: Arial, sans-serif;">-20%</span>';

                stampHTML = `<div class="${markClass}" style="--rot: ${rot}; animation-delay: ${delay};">${icon}</div>`;
            }

            grid.innerHTML += `<div class="stamp-guide">${stampHTML}</div>`;
        }
        const estado=document.getElementById("clienteEstado");
        if (data.visitas>=10) {
            estado.className="reward-info gold";
            estado.innerHTML=`
                <div style="display:flex; justify-content:center; margin-bottom:10px;">
                    <lottie-player src="reserva-success.json" background="transparent" speed="1" style="width: 100px; height: 100px;" loop autoplay></lottie-player>
                </div>
                <div style="font-size:16px; font-weight:700; margin-bottom:4px;"><i class="fa-solid fa-crown"></i> ¡Enhorabuena!</div>
                <div>Tienes un diseño de regalo en tu próxima cita.</div>
            `;
        } else if (data.visitas===5) {
            estado.className="reward-info gold";
            estado.innerHTML=`
                <div style="font-size:16px; font-weight:700; margin-bottom:4px;"><i class="fa-solid fa-gift"></i> ¡Premio Desbloqueado!</div>
                <div>Tienes un <strong style="font-size:18px; color:var(--accent);">20% de descuento</strong> en esta cita.</div>
            `;
        } else {
            const r = 10 - data.visitas;
            const r5 = 5 - data.visitas;
            let targetText = "";

            if (data.visitas < 5) {
                targetText = `Te ${r5===1?"queda":"quedan"} <strong>${r5}</strong> ${r5===1?"sello":"sellos"} para tu 20% de descuento.`;
            } else {
                targetText = `Te ${r===1?"queda":"quedan"} <strong>${r}</strong> ${r===1?"sello":"sellos"} para tu diseño de regalo.`;
            }

            estado.className="reward-info";
            estado.innerHTML=`<i class="fa-regular fa-star" style="margin-right:6px;"></i> ${targetText}`;
        }
        await renderMisCitas(data);
        if (!skipNavigation && !_renderingPerfil) {
            mostrarVista("vistaCliente");
        }
        // Reset login para próxima vez
        const lu=document.getElementById("loginUsuario"); if(lu) lu.value="";
        const lp=document.getElementById("loginPass"); if(lp) lp.value="";
    }

    // ══════════════════════════════════════════════════════
    //  REGISTRO — datos + usuario + contraseña + OTP email
    // ══════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════
    //  CREAR CUENTA (solo registro, sin cita)
    // ══════════════════════════════════════════════════════
    async function crearCuenta() {
        const nombre   = (document.getElementById("citaNombre")?.value||"").trim();
        const telefono = (document.getElementById("citaTelefono")?.value||"").trim();

        const clave    = document.getElementById("citaClave")?.value||"";
        const claveC   = document.getElementById("citaClaveConfirm")?.value||"";
        const email    = (document.getElementById("citaEmail")?.value||"").trim().toLowerCase();

        function showErr(msg) {
            const el=document.getElementById("regErrorMsg");
            if(el){el.textContent=msg;el.style.display="block";}
            toast(msg,"error");
        }
        function hideErr() {
            const el=document.getElementById("regErrorMsg"); if(el) el.style.display="none";
        }
        hideErr();

        if (!nombre)   return showErr("Introduce tu nombre completo");
        if (!telefono) return showErr("Introduce tu teléfono");

        if (clave.length<6) return showErr("La contraseña debe tener al menos 6 caracteres");
        if (clave!==claveC) return showErr("Las contraseñas no coinciden");
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr("Introduce un correo válido");
        if (!document.getElementById("aceptoPrivacidad")?.checked) return showErr("Debes aceptar la Política de Privacidad");

        setBtnLoading("btnCrearCuenta",true);
        try {
            let aliasFinal = email; // Usamos el email como identificador único

            // 1. Crear usuario seguro en Supabase Auth y pasarle los datos
            const { data: authData, error: authErr } = await sb.auth.signUp({
                email: email,
                password: clave,
                options: {
                    data: {
                        nombre: nombre,
                        telefono: telefono,
                        usuario: aliasFinal
                    }
                }
            });
            if (authErr) { showErr("No se pudo crear la cuenta: "+authErr.message); return; }
            if (!authData.user) { showErr("Error desconocido al registrar usuario."); return; }

            // 2. La base de datos creará automáticamente el perfil en la tabla 'clientas'
            // mediante un Trigger (ya no hacemos el insert desde aquí para evitar bloqueos de seguridad).

            toast("¡Código enviado a tu correo!", "info");

            document.getElementById("regDisplayEmail").textContent = email;
            initOTPInputs("regOtpContainer", verificarRegistroOTP);
            document.getElementById("regStepDatos").style.display = 'none';
            document.getElementById("regStepOTP").style.display = 'block';

        } catch(e) {
            showErr("Error inesperado: "+(e.message||String(e)));
        } finally {
            setBtnLoading("btnCrearCuenta",false);
        }
    }

    window.verificarRegistroOTP = async function() {
        const otp = getOTPCode("regOtpContainer");
        if (otp.length < 8) return;
        const email = (document.getElementById("citaEmail")?.value||"").trim().toLowerCase();

        setBtnLoading("btnVerificarRegOTP", true);

        const errorMsg = document.getElementById("regOtpErrorMsg");
        errorMsg.style.display = "none";

        try {
            const { data, error } = await sb.auth.verifyOtp({ email, token: otp, type: 'signup' });
            if (error) {
                errorMsg.textContent = "Código incorrecto o caducado";
                errorMsg.style.display = "block";
                clearOTPInputs("regOtpContainer");
            } else {
                ["citaNombre","citaTelefono","citaClave","citaClaveConfirm","citaEmail"]
                    .forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
                document.getElementById("regStepOTP").style.display = 'none';
                document.getElementById("regStepDatos").style.display = 'block';

                // Mostrar popup de éxito
                document.getElementById("modalRegistroOk").classList.add("show");

                const lu=document.getElementById("loginUsuario"); if(lu) lu.value=email;
                setTimeout(()=>{
                    restaurarSesion().then(() => {
                        const destination = _reservaPendiente && _clienteLogueado ? 'vistaReservar' : 'login';
                        if (destination === 'vistaReservar') _reservaPendiente = false;
                        mostrarVista(destination);
                    }).catch(() => mostrarVista('login'));
                }, 800);
            }
        } catch(e) {
            errorMsg.textContent = "Error de conexión";
            errorMsg.style.display = "block";
        } finally {
            setBtnLoading("btnVerificarRegOTP", false);
        }
    }

    // ══════════════════════════════════════════════════════
    //  ENVIAR RESERVA (solo cita, requiere login)
    // ══════════════════════════════════════════════════════
    let resolverRetiradaPromesa = null;

    function preguntarRetirada() {
        return new Promise((resolve) => {
            // Si ya seleccionó el servicio "Retirada + Limpieza de Cutícula" no preguntamos
            if (/retirada/i.test(selectedServicio || '') || selectedExtras.some(extra => /retirada/i.test(extra.name))) {
                resolve('nada');
                return;
            }
            const retirada = SalonCore.removalService(NC_SERVICIOS);
            document.getElementById('retiradaOtroLabel').textContent = 'Sí, vengo de otro centro (+' + retirada.precio + ' € / +' + retirada.dur + ' min)';
            resolverRetiradaPromesa = resolve;
            document.getElementById('modalRetirada').style.display = 'flex';
        });
    }

    window.resolverRetirada = function(opcion) {
        document.getElementById('modalRetirada').style.display = 'none';
        if (resolverRetiradaPromesa) {
            resolverRetiradaPromesa(opcion);
            resolverRetiradaPromesa = null;
        }
    }

    async function enviarReserva() {
        if (_reservaEnviando) return;
        if (!selectedServicio || !selectedDate || !selectedTime) {
            return toast('Selecciona un servicio, una fecha y una hora.', 'error');
        }
        if (!_clienteLogueado) {
            _reservaPendiente = true;
            _irAlAcceso = true;
            _loginParaReservar = true;
            toast("Debes iniciar sesión para reservar","error");
            mostrarVista("login");
            return;
        }

        function showErr(msg) {
            const el=document.getElementById("reservaErrorMsg");
            if(el){el.textContent=msg;el.style.display="block";}
            toast(msg,"error");
        }
        function hideErr() {
            const el=document.getElementById("reservaErrorMsg"); if(el) el.style.display="none";
        }
        hideErr();

        if (!selectedServicio) return showErr("Selecciona un servicio");
        if (!selectedDate)     return showErr("Selecciona una fecha");
        if (!selectedTime)     return showErr("Selecciona una hora");

        _reservaEnviando = true;
        setBtnLoading("btnEnviarReserva",true);
        try {
            // Preguntar si necesita retirada de otro centro o local
            const opcionRetirada = await preguntarRetirada();

            const total = SalonCore.bookingTotals(selectedServicio, selectedDuracion, selectedPrecio,
                selectedExtras, opcionRetirada, NC_SERVICIOS);
            const servicioFinal = total.servicio;
            const duracionFinal = total.duracion;
            if (!await cargarDisponibles() || !isDiaDisponible(fmtISO(selectedDate))) {
                showErr('No se pudo verificar que el día esté disponible. Inténtalo de nuevo.'); return;
            }


            // ── Revalidar disponibilidad contra la BD justo antes de insertar ──
            // Vía RPC: ve TODAS las citas (no solo las de esta clienta) sin exponer datos personales.
            const fechaISO = fmtISO(selectedDate);
            const { data: citasFrescas, error: chkErr } = await sb.rpc("horas_ocupadas", { p_fecha: fechaISO });
            if (chkErr) { showErr("No se pudo verificar la disponibilidad. Inténtalo de nuevo."); return; }
            const citasDia = (citasFrescas || []).map(c => ({ ...c, fecha: fechaISO }));
            if (slotFueraDeHorario(selectedTime, duracionFinal) ||
                slotBloqueado(selectedTime, citasDia, duracionFinal, fechaISO)) {
                // Refrescar el grid para que la clienta vea la ocupación actualizada
                citas = citas.filter(c => c.fecha !== fechaISO);
                citasDia.forEach(c => citas.push(c));
                selectedTime = null;
                const lbl = document.getElementById("pickedTimeLabel");
                if (lbl) { lbl.textContent = "Sin elegir"; lbl.classList.add("empty"); }
                try { renderTimeSlots(); } catch(e) {}
                showErr("Esa hora se acaba de ocupar. Elige otra, por favor.");
                return;
            }

            const totalPrecio = total.precio;
            const { error: aErr } = await sb.from("citas").insert([{
                cliente_id: _clienteLogueado.id,
                nombre_cliente: _clienteLogueado.nombre,
                telefono: _clienteLogueado.telefono,
                servicio: servicioFinal,
                duracion_minutos: duracionFinal,
                precio: totalPrecio,
                fecha: fmtISO(selectedDate),
                hora: selectedTime,
                estado: "pendiente"
            }]);
            if (aErr) {
                const msg = (aErr.message||"").toLowerCase();
                if (msg.includes("ocupado") || msg.includes("overlap") || aErr.code === "23P01") {
                    showErr("Esa hora se acaba de ocupar. Elige otra, por favor.");
                } else {
                    showErr("Error al guardar la cita: "+aErr.message);
                }
                return;
            }

            toast("¡Solicitud enviada! Te confirmaremos pronto.", "success","¡Reserva enviada!");
            resetPicker();
            hideErr();

            // Refrescar datos del cliente y volver a su perfil
            try {
                const { data: freshData } = await sb.from("clientas").select("*").eq("id", _clienteLogueado.id).maybeSingle();
                if (freshData) _clienteLogueado = freshData;
            } catch(e) {}

            const successOverlay = document.getElementById("reservaSuccessOverlay");
            if (successOverlay) {
                successOverlay.style.display = "flex";
                const player = successOverlay.querySelector("lottie-player");
                if (player) { player.seek(0); player.play(); }

                setTimeout(()=>{
                    successOverlay.style.display = "none";
                    mostrarVista("vistaCliente");
                }, 4000); // 4 segundos para ver el baile!
            } else {
                setTimeout(()=>{
                    mostrarVista("vistaCliente");
                },1200);
            }
        } catch(e) {
            showErr("Error inesperado: "+(e.message||String(e)));
        } finally {
            _reservaEnviando = false;
            setBtnLoading("btnEnviarReserva",false);
        }
    }

    async function renderMisCitas(cliente) {
        const list = document.getElementById("misCitasList");
        const histList = document.getElementById("misCitasHistorial");
        if (!list) return;
        list.innerHTML = `<div class="mis-citas-empty"><i class="fa-regular fa-hourglass-half"></i><div class="label">Cargando…</div></div>`;
        if (histList) histList.innerHTML = list.innerHTML;
        try {
            const { data, error } = await sb.from("citas")
                .select("*").eq("cliente_id", cliente.id)
                .order("fecha",{ascending:false}).order("hora",{ascending:false});
            if (error) throw error;
            const allCitas = data || [];
            const todayISO = fmtISO(today);

            // Próximas: fecha >= hoy y no cancelada
            const upcoming = allCitas
                .filter(c => c.fecha >= todayISO && !["cancelada", "completada"].includes(c.estado||"pendiente"))
                .sort((a,b) => (a.fecha+a.hora).localeCompare(b.fecha+b.hora));

            // Historial: fecha < hoy O completada/cancelada
            const history = allCitas
                .filter(c => c.fecha < todayISO || (c.estado||"pendiente") === "completada" || (c.estado||"pendiente") === "cancelada");

            // Render próximas
            if (!upcoming.length) {
                list.innerHTML = `<div class="mis-citas-empty"><i class="fa-regular fa-calendar"></i><div class="label">No tienes citas próximas</div></div>`;
            } else {
                list.innerHTML = upcoming.map(c => renderCitaCard(c, cliente, false)).join("");
            }

            // Render historial
            if (histList) {
                if (!history.length) {
                    histList.innerHTML = `<div class="mis-citas-empty"><i class="fa-solid fa-clock-rotate-left"></i><div class="label">Aún no tienes citas anteriores</div></div>`;
                } else {
                    histList.innerHTML = history.map(c => renderCitaCard(c, cliente, true)).join("");
                }
            }
        } catch(e) {
            list.innerHTML = `<div class="mis-citas-empty"><i class="fa-regular fa-circle-xmark"></i><div class="label">No se pudieron cargar las citas</div></div>`;
        }
    }

    function renderCitaCard(c, cliente, isHistory) {
        const dt = new Date(c.fecha+"T00:00:00");
        const dias = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
        const fullDay = `${dias[dt.getDay()]}, ${dt.getDate()} de ${MONTHS_ES[dt.getMonth()].toLowerCase()}`;
        const hora = (c.hora||"").slice(0,5);
        const estado = c.estado||"pendiente";
        const msg = `Hola Shanahan Nails ✨\nSoy ${cliente.nombre}, quería modificar mi cita del ${dt.getDate()} de ${MONTHS_ES[dt.getMonth()].toLowerCase()} a las ${hora}h. ¿Podríamos cambiar?`;
        const actions = isHistory ? "" : `
            <div class="mi-cita-actions">
                <a href="https://wa.me/${SALON_WHATSAPP}?text=${encodeURIComponent(msg)}" target="_blank" class="btn-whatsapp">
                    <i class="fa-brands fa-whatsapp"></i> Cambiar
                </a>
            </div>`;
        return `<div class="mi-cita-card ${escapeHTML(estado)}" ${isHistory ? 'style="opacity:.85;"' : ''}>
            <div class="mi-cita-date"><span class="day">${dt.getDate()}</span><span class="month">${MONTHS_ES[dt.getMonth()].slice(0,3)}</span></div>
            <div class="mi-cita-info">
                <span class="weekday">${fullDay}</span>
                ${c.servicio ? `<span style="font-size:10.5px;color:var(--accent);font-weight:600;">${escapeHTML(c.servicio)}</span>` : ""}
                <span class="hora">${hora} h${c.duracion_minutos ? ` · ${durStr(c.duracion_minutos)}` : ""}  </span>
                <span class="estado-pill ${escapeHTML(estado)}">${escapeHTML(estado)}</span>
            </div>
            ${actions}
        </div>`;
    }

    function switchCitasTab(tab) {
        document.querySelectorAll(".mis-citas-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
        const listProx = document.getElementById("misCitasList");
        const listHist = document.getElementById("misCitasHistorial");
        if (listProx) listProx.style.display = tab === "proximas" ? "flex" : "none";
        if (listHist) listHist.style.display = tab === "historial" ? "flex" : "none";
    }

    // ══════════════════════════════════════════════════════
    //  ADMIN
    // ══════════════════════════════════════════════════════
    async function loginAdmin() {
        const user = (document.getElementById("adminUser")?.value||"").trim();
        const pass = (document.getElementById("adminPass")?.value||"").trim();
        if (!user||!pass) return toast("Completa correo y contraseña","error");
        setBtnLoading("btnLoginAdmin",true);
        try {
            const { data: authData, error: authErr } = await sb.auth.signInWithPassword({
                email: user,
                password: pass
            });
            if (authErr) {
                toast("Error: " + (authErr.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : authErr.message), "error");
                return;
            }

            const userId = authData.user.id;
            const { data: adminData } = await sb.from("admins").select("id").eq("id", userId).maybeSingle();
            if (adminData) {
                _adminAutenticada = true;
                toast("Bienvenida al panel","success");
                mostrarVista("vistaAdmin");
            }
            else {
                await sb.auth.signOut();
                toast("No tienes permisos de administradora","error");
            }
        } catch(e) { toast("Error al iniciar sesión","error"); }
        finally { setBtnLoading("btnLoginAdmin",false); }
    }

    async function cargarDatosAdmin() {
        try {
            const [rC, rCi] = await Promise.all([
                sb.from("clientas").select("*").order("nombre",{ascending:true}),
                sb.from("citas").select("*").order("fecha",{ascending:true})
            ]);
            if (rC.error)  { toast("Error cargando clientas: "+rC.error.message,"error"); return; }
            if (rCi.error) { toast("Error cargando citas: "+rCi.error.message,"error"); return; }
            clientas = rC.data||[];
            citas    = rCi.data||[];
            console.log(`Admin data: ${clientas.length} clientas, ${citas.length} citas`);
            if (!agendaInitialized) { try{initAgenda();}catch(e){} agendaInitialized=true; }
            try { initDispPanel(); } catch(e){}
            try { await cargarDisponibles(); } catch(e){}
            try { await cargarEmailNotificacion(); } catch(e){}
            try { await cargarResenas(); } catch(e){}
            renderAdmin();
            try { renderHistorialAdmin(); } catch(e){}
        } catch(e) {
            toast("Error cargando datos: "+(e.message||""),"error");
        }
    }

    // ── Historial admin ─────────────────────────────────────
    let historialFilter = "all";
    function setHistorialFilter(f) {
        historialFilter = f;
        document.querySelectorAll("[data-hfilter]").forEach(b => b.classList.toggle("active", b.dataset.hfilter === f));
        renderHistorialAdmin();
    }
    function renderHistorialAdmin() {
        const emptyEl = document.getElementById("historialEmpty");
        const search = (document.getElementById("historialSearch")?.value || "").toLowerCase();
        const dias = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

        // Todas las citas ordenadas de más reciente a más antigua
        let filtered = [...citas].sort((a,b) => (b.fecha+b.hora).localeCompare(a.fecha+a.hora));

        // Filtro por estado
        if (historialFilter !== "all") {
            filtered = filtered.filter(c => (c.estado||"pendiente") === historialFilter);
        }
        // Filtro por búsqueda
        if (search) {
            filtered = filtered.filter(c => (c.nombre_cliente||"").toLowerCase().includes(search));
        }


        // Calcular el balance: sumamos todas las citas que NO estén canceladas
        const balanceTotal = filtered.reduce((sum, c) => {
            if ((c.estado||"pendiente") !== "cancelada") {
                return sum + parsePrecio(c.precio);
            }
            return sum;
        }, 0);

        const balanceEl = document.getElementById("historialBalance");
        if (balanceEl) balanceEl.textContent = balanceTotal + "€";

        const container = document.getElementById("historialContenedor");
        if (!container) return;

        if (!filtered.length) {
            container.innerHTML = "";
            if (emptyEl) { emptyEl.style.display = "block"; }
            return;
        }
        if (emptyEl) emptyEl.style.display = "none";

        // Agrupar por mes
        const meses = {};
        filtered.forEach(c => {
            const dt = new Date(c.fecha+"T00:00:00");
            const mesKey = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
            const mesNombre = `${MONTHS_ES[dt.getMonth()]} ${dt.getFullYear()}`;
            if (!meses[mesKey]) meses[mesKey] = { nombre: mesNombre, citas: [], sum: 0 };
            meses[mesKey].citas.push(c);
            if ((c.estado||"pendiente") !== "cancelada") {
                meses[mesKey].sum += parsePrecio(c.precio);
            }
        });

        const keys = Object.keys(meses).sort((a,b) => b.localeCompare(a)); // Meses más recientes primero
        let html = "";
        keys.forEach((k, idx) => {
            const mes = meses[k];
            // Solo el primer mes abierto por defecto para no saturar la pantalla
            const isOpen = idx === 0 ? "open" : "";
            html += `<details class="disp-month-details" ${isOpen} style="margin-bottom:12px; border:1px solid rgba(229,218,206,0.8); border-radius:12px; background:#fff; overflow:hidden;">
                <summary style="padding:16px; background:rgba(229,218,206,0.2); font-weight:600; color:var(--burgundy); cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-family:'Instrument Serif',serif; font-size:16px;"><i class="fa-regular fa-calendar-days" style="margin-right:8px;"></i>${mes.nombre} (${mes.citas.length})</span>
                    <span style="font-size:14px; font-weight:700; color:var(--accent); background:#fff; padding:4px 10px; border-radius:20px; border:1px solid rgba(229,218,206,0.5);">Generado: ${mes.sum}€</span>
                </summary>
                <div style="padding:16px; border-top:1px solid rgba(229,218,206,0.4); overflow-x:auto;">
                    <table class="admin-table" style="margin:0;">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Hora</th>
                                <th>Clienta</th>
                                <th>Servicio</th>
                                <th>Precio</th>
                                <th>Estado</th>
                            </tr>
                        </thead>
                        <tbody>`;

            html += mes.citas.map(c => {
                const dt = new Date(c.fecha+"T00:00:00");
                const fechaBonita = `${dias[dt.getDay()]}, ${dt.getDate()}`;
                const hora = (c.hora||"").slice(0,5);
                const estado = c.estado||"pendiente";
                const precioStr = parsePrecio(c.precio) + "€";
                return `<tr style="cursor:pointer;" onclick="abrirEditarCita(${c.id})">
                    <td><span style="font-weight:600;">${fechaBonita}</span></td>
                    <td>${hora} h</td>
                    <td>${escapeHTML(c.nombre_cliente||"")} <span style="font-size:10px;color:var(--muted);">${escapeHTML(c.telefono||"")}</span></td>
                    <td><span style="color:var(--accent);font-weight:600;font-size:12px;">${escapeHTML(c.servicio||"—")}</span></td>
                    <td><span style="font-weight:600;">${precioStr}</span></td>
                    <td><span class="estado-pill ${escapeHTML(estado)}">${escapeHTML(estado)}</span></td>
                </tr>`;
            }).join("");

            html += `</tbody></table></div></details>`;
        });

        container.innerHTML = html;
    }

    // ── Gestión de Servicios Admin ─────────────────────────────────────
    function renderAdminServicios() {
        const container = document.getElementById("serviciosContenedor");
        if (!container) return;

        if (!NC_SERVICIOS || NC_SERVICIOS.length === 0) {
            container.innerHTML = `<div class="mis-citas-empty"><i class="fa-solid fa-list-ul"></i><div class="label">No hay servicios configurados</div></div>`;
            return;
        }

        let html = "";
        NC_SERVICIOS.forEach((grupo, idx) => {
            const isOpen = idx === 0 ? "open" : "";
            html += `<details class="disp-month-details" ${isOpen} style="margin-bottom:12px; border:1px solid rgba(229,218,206,0.8); border-radius:12px; background:#fff; overflow:hidden;">
                <summary style="padding:16px; background:rgba(229,218,206,0.2); font-weight:600; color:var(--burgundy); cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-family:'Instrument Serif',serif; font-size:16px;"><i class="fa-solid fa-layer-group" style="margin-right:8px;"></i>${escapeHTML(grupo.grupo)}</span>
                </summary>
                <div style="padding:16px; border-top:1px solid rgba(229,218,206,0.4); overflow-x:auto;">
                    <table class="admin-table" style="margin:0;">
                        <thead>
                            <tr>
                                <th>Servicio</th>
                                <th>Precio</th>
                                <th>Duración</th>
                                <th>Acción</th>
                            </tr>
                        </thead>
                        <tbody>`;

            grupo.items.forEach(s => {
                html += `<tr>
                    <td><div style="font-weight:600; color:var(--accent);">${escapeHTML(s.nombre)}</div><div style="font-size:11px; color:var(--muted); max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(s.desc||"")}</div></td>
                    <td><span style="font-weight:600;">${escapeHTML(s.precio)}</span></td>
                    <td>${escapeHTML(s.durTxt)}</td>
                    <td style="text-align:right;">
                        <button class="cita-btn reject" onclick="abrirEditarServicio(${s.id})" title="Editar"><i class="fa-solid fa-pen"></i></button>
                    </td>
                </tr>`;
            });
            html += `</tbody></table></div></details>`;
        });
        container.innerHTML = html;
    }

    function abrirCrearServicio() {
        document.getElementById("servicioModalTitle").textContent = "Crear Nuevo Servicio";
        document.getElementById("editServicioId").value = "";
        document.getElementById("editServicioNombre").value = "";
        document.getElementById("editServicioGrupo").value = "";
        document.getElementById("editServicioPrecio").value = "";
        document.getElementById("editServicioDuracionNum").value = "";
        document.getElementById("editServicioDuracionTxt").value = "";
        document.getElementById("editServicioDesc").value = "";
        document.getElementById("btnEliminarServicio").style.display = "none";
        document.getElementById("editServicioModal").classList.add("show");
    }

    function abrirEditarServicio(id) {
        let servicio = null;
        for (const g of NC_SERVICIOS) {
            const f = g.items.find(i => i.id === id);
            if (f) { servicio = f; servicio.grupo = g.grupo; break; }
        }
        if (!servicio) return;

        document.getElementById("servicioModalTitle").textContent = "Editar Servicio";
        document.getElementById("editServicioId").value = servicio.id;
        document.getElementById("editServicioNombre").value = servicio.nombre || "";
        document.getElementById("editServicioGrupo").value = servicio.grupo || "";
        document.getElementById("editServicioPrecio").value = formatearPrecio(servicio.precio);
        document.getElementById("editServicioDuracionNum").value = servicio.dur || 0;
        document.getElementById("editServicioDuracionTxt").value = servicio.durTxt || "";
        document.getElementById("editServicioDesc").value = servicio.desc || "";
        document.getElementById("btnEliminarServicio").style.display = "block";

        document.getElementById("editServicioModal").classList.add("show");
    }

    function closeEditServicio() { document.getElementById("editServicioModal").classList.remove("show"); }
    document.getElementById("editServicioModal").addEventListener("click",e=>{ if(e.target.id==="editServicioModal") closeEditServicio(); });

    async function guardarServicio() {
        const id = document.getElementById("editServicioId").value;
        const nombre = document.getElementById("editServicioNombre").value.trim();
        const grupo = document.getElementById("editServicioGrupo").value.trim();
        const precio = formatearPrecio(document.getElementById("editServicioPrecio").value); // "28" -> "28 €"
        const duracion_minutos = parseInt(document.getElementById("editServicioDuracionNum").value, 10);
        const duracion_texto = document.getElementById("editServicioDuracionTxt").value.trim();
        const descripcion = document.getElementById("editServicioDesc").value.trim();

        if (!nombre || !grupo || !precio || isNaN(duracion_minutos)) {
            return toast("Rellena todos los campos obligatorios", "error");
        }

        const payload = { nombre, grupo, precio, dur: duracion_minutos, dur_txt: duracion_texto, descrip: descripcion };

        setBtnLoading("btnGuardarServicio", true);
        try {
            if (id) {
                const { error } = await sb.from("servicios").update(payload).eq("id", parseInt(id, 10));
                if (error) throw error;
                toast("Servicio actualizado", "success");
            } else {
                // Determine `val` based on name for new services
                payload.val = nombre.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const { error } = await sb.from("servicios").insert([payload]);
                if (error) throw error;
                toast("Servicio creado", "success");
            }
            closeEditServicio();
            await cargarCatServicios(); // Recargar array global
            renderAdminServicios();
            try { renderPublicServicios(); } catch(e){} // Actualizar UI de cliente si procede
        } catch(e) {
            toast("Error: " + e.message, "error");
        } finally {
            setBtnLoading("btnGuardarServicio", false);
        }
    }

    async function eliminarServicio() {
        const id = parseInt(document.getElementById("editServicioId").value, 10);
        if (!id) return;
        const ok = await askConfirm("Eliminar Servicio", "¿Estás segura de eliminar este servicio? Desaparecerá del catálogo para las clientas.");
        if (!ok) return;

        setBtnLoading("btnEliminarServicio", true);
        try {
            const { error } = await sb.from("servicios").delete().eq("id", id);
            if (error) throw error;
            toast("Servicio eliminado", "success");
            closeEditServicio();
            await cargarCatServicios();
            renderAdminServicios();
            try { renderPublicServicios(); } catch(e){}
        } catch(e) {
            toast("Error: " + e.message, "error");
        } finally {
            setBtnLoading("btnEliminarServicio", false);
        }
    }

    // ── Correo de notificaciones ─────────────────────────────
    async function cargarEmailNotificacion() {
        const { data } = await sb.from("configuracion").select("valor").eq("clave","notif_email").maybeSingle();
        const input = document.getElementById("adminNotifEmail");
        const status = document.getElementById("notifEmailStatus");
        if (data && data.valor) {
            if (input) input.value = data.valor;
            if (status) { status.style.display="block"; status.querySelector("span").textContent = "Guardado: " + data.valor; }
        } else {
            if (status) status.style.display = "none";
        }
    }

    async function guardarEmailNotificacion() {
        const email = (document.getElementById("adminNotifEmail")?.value||"").trim();
        if (!email || !email.includes("@")) return toast("Introduce un correo válido","error");
        setBtnLoading("btnGuardarNotifEmail", true);
        try {
            // Upsert: si ya existe la clave, la actualiza; si no, la crea
            const { error } = await sb.from("configuracion").upsert({ clave: "notif_email", valor: email }, { onConflict: "clave" });
            if (error) { toast("No se pudo guardar: "+error.message,"error"); return; }
            toast("Correo de notificaciones guardado","success");
            const status = document.getElementById("notifEmailStatus");
            if (status) { status.style.display="block"; status.querySelector("span").textContent = "Guardado: " + email; }
        } catch(e) { toast("Error al guardar","error"); }
        finally { setBtnLoading("btnGuardarNotifEmail", false); }
    }

    // ── Agenda admin ───────────────────────────────────────
    function citasOfDay(iso) {
        return citas.filter(c=>c.fecha===iso && (agendaFilter==="all"||(c.estado||"pendiente")===agendaFilter));
    }

    function renderAgenda() {
        const monthEl=document.getElementById("agendaMonth");
        const grid=document.getElementById("agendaGrid");
        if (!monthEl||!grid) return;
        monthEl.textContent=`${MONTHS_ES[agendaCursor.getMonth()]} ${agendaCursor.getFullYear()}`;
        grid.innerHTML="";
        DOW_ES.forEach(d=>grid.innerHTML+=`<div class="cal-dow">${d}</div>`);
        const y=agendaCursor.getFullYear(), m=agendaCursor.getMonth();
        const offset=(new Date(y,m,1).getDay()+6)%7;
        const dim=new Date(y,m+1,0).getDate();
        const prevDim=new Date(y,m,0).getDate();
        for (let i=offset-1;i>=0;i--) grid.innerHTML+=`<div class="cal-day muted">${prevDim-i}</div>`;
        for (let d=1;d<=dim;d++) {
            const dt=new Date(y,m,d), iso=fmtISO(dt);
            const dayCitas=citasOfDay(iso);
            const pend=dayCitas.filter(c=>(c.estado||"pendiente")==="pendiente").length;
            const isToday=dt.getTime()===today.getTime();
            const isSel=fmtISO(agendaSelected)===iso;
            let cls="cal-day";
            if(isToday) cls+=" today";
            if(isSel) cls+=" selected";
            if(dayCitas.length>0) cls+=" has-citas";
            const badge=dayCitas.length>0?`<span class="cnt ${pend>0?"pendiente":""}">${dayCitas.length}</span>`:"";
            grid.innerHTML+=`<div class="${cls}" data-iso="${iso}">${d}${badge}</div>`;
        }
        const trail=(7-((offset+dim)%7))%7;
        for(let i=1;i<=trail;i++) grid.innerHTML+=`<div class="cal-day muted">${i}</div>`;
        grid.querySelectorAll(".cal-day:not(.muted)").forEach(el=>{
            el.addEventListener("click",()=>{
                const [y2,m2,d2]=el.dataset.iso.split("-").map(Number);
                agendaSelected=new Date(y2,m2-1,d2);
                renderAgenda(); renderAgendaDay();
            });
        });
    }

    // Período activo del timeline admin
    let tlPeriod = "morning";

    function renderAgendaDay() {
        const iso = fmtISO(agendaSelected);
        const todasCitas = citas.filter(c => c.fecha === iso);
        const dayCitas   = citasOfDay(iso); // filtradas por agendaFilter

        document.getElementById("dayTitle").textContent = fmtDayLong(agendaSelected);
        document.getElementById("daySub").textContent   = iso === fmtISO(today) ? "Hoy" : "";

        // Badges de estado
        const counts = {pendiente:0, confirmada:0, completada:0, cancelada:0};
        todasCitas.forEach(c => { const k=c.estado||"pendiente"; counts[k]=(counts[k]||0)+1; });
        const cntEl = document.getElementById("dayCount");
        cntEl.innerHTML = "";
        Object.entries(counts).forEach(([k,v]) => {
            if (v>0) cntEl.innerHTML += `<span class="estado-pill ${k}">${v} ${k}</span>`;
        });

        const grid = document.getElementById("timelineGrid");
        if (!grid) return;

        const slots = {
            morning:   ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30"],
            afternoon: ["16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30"]
        }[tlPeriod];

        // Precalcular qué slots están bloqueados por citas existentes (todas, no filtradas)
        const toCitas = todasCitas.filter(c => (c.estado||"pendiente") !== "cancelada");

        grid.innerHTML = "";

        if (!slots.length) return;

        let hayAlgo = false;

        slots.forEach(t => {
            const tMin = toMin(t);

            // ¿Hay una cita que empieza en este slot?
            const citaAqui = toCitas.find(c => (c.hora||"").slice(0,5) === t);

            // ¿Este slot está bloqueado por una cita que empezó antes?
            const bloqueadoPor = !citaAqui ? toCitas.find(c => {
                const inicio = toMin((c.hora||"").slice(0,5));
                const fin    = inicio + (parseInt(c.duracion_minutos,10)||30);
                return tMin > inicio && tMin < fin;
            }) : null;

            const libre = !citaAqui && !bloqueadoPor;

            // Filtro de admin: si hay filtro activo solo mostrar slots con citas del filtro
            const citaFiltrada = dayCitas.find(c => (c.hora||"").slice(0,5) === t);
            const mostrarSlot  = agendaFilter === "all" || citaAqui || bloqueadoPor;
            if (!mostrarSlot && libre) {
                // Slot libre and no coincide con filtro — mostrar igual pero tenue
            }

            hayAlgo = true;

            let bodyHTML = "";

            if (citaAqui) {
                const estado = citaAqui.estado || "pendiente";
                const durMin = parseInt(citaAqui.duracion_minutos,10)||30;
                bodyHTML = `
                    <div class="tl-cita ${escapeHTML(estado)}" onclick="abrirEditarCita(${citaAqui.id})">
                        <div class="tl-cita-name">${escapeHTML(citaAqui.nombre_cliente||"—")}</div>
                        ${citaAqui.servicio?`<div class="tl-cita-servicio">${escapeHTML(citaAqui.servicio)}</div>`:""}
                        <div class="tl-cita-meta">
                            <span><i class="fa-solid fa-phone" style="margin-right:4px;font-size:9px;"></i>${escapeHTML(citaAqui.telefono||"—")}</span>
                            <span style="color:var(--burgundy); font-weight:600;"><i class="fa-solid fa-tag" style="margin-right:4px;font-size:9px;"></i>${(Number(citaAqui.precio)||0)}€</span>
                            <span class="estado-pill ${escapeHTML(estado)}" style="font-size:9px;padding:1px 7px;">${escapeHTML(estado)}</span>
                        </div>
                        <span class="tl-cita-dur">${durStr(durMin)}</span>
                        <div class="tl-actions" onclick="event.stopPropagation()">
                            ${estado==="pendiente"?`<button class="tl-btn approve" onclick="aprobarCita(${citaAqui.id})"><i class="fa-solid fa-check"></i> Aprobar</button>`:""}
                            ${estado==="confirmada"?`<button class="tl-btn done" onclick="completarCita(${citaAqui.id})"><i class="fa-solid fa-circle-check"></i> Completar</button>`:""}
                            <button class="tl-btn edit" onclick="abrirEditarCita(${citaAqui.id})"><i class="fa-solid fa-pen"></i></button>
                            <button class="tl-btn del"  onclick="eliminarCita(${citaAqui.id})"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>`;
            } else if (bloqueadoPor) {
                const durMin = parseInt(bloqueadoPor.duracion_minutos,10)||30;
                const inicioB = toMin((bloqueadoPor.hora||"").slice(0,5));
                const finB    = inicioB + durMin;
                const restMin = finB - tMin;
                bodyHTML = `<div class="tl-bloqueado"><i class="fa-solid fa-lock" style="font-size:10px;"></i>Bloqueado — ${escapeHTML(bloqueadoPor.nombre_cliente||"")} (${durStr(restMin)} restantes)</div>`;
            } else {
                bodyHTML = `<div class="tl-libre" onclick="abrirNuevaCita('${iso}','${t}')"><i class="fa-regular fa-circle" style="font-size:10px;color:#4A7C59;"></i>Libre<span class="tl-libre-action"><i class="fa-solid fa-plus" style="margin-right:4px;"></i>Agendar</span></div>`;
            }

            grid.innerHTML += `
                <div class="tl-slot">
                    <div class="tl-slot-time">${t}</div>
                    <div class="tl-slot-body">${bodyHTML}</div>
                </div>`;
        });

        if (!hayAlgo) {
            grid.innerHTML = `<div class="tl-empty"><i class="fa-regular fa-calendar-xmark"></i><div class="lbl">Sin citas para este día</div></div>`;
        }
    }

    function initAgenda() {
        agendaCursor   = new Date(today.getFullYear(), today.getMonth(), 1);
        agendaSelected = new Date(today);
        const aPrev=document.getElementById("agendaPrev");
        const aNext=document.getElementById("agendaNext");
        const aTod=document.getElementById("agendaToday");
        if(aPrev) aPrev.addEventListener("click",()=>{ agendaCursor=new Date(agendaCursor.getFullYear(),agendaCursor.getMonth()-1,1); renderAgenda(); });
        if(aNext) aNext.addEventListener("click",()=>{ agendaCursor=new Date(agendaCursor.getFullYear(),agendaCursor.getMonth()+1,1); renderAgenda(); });
        if(aTod)  aTod.addEventListener("click",()=>{ agendaCursor=new Date(today.getFullYear(),today.getMonth(),1); agendaSelected=new Date(today); renderAgenda(); renderAgendaDay(); });
        document.querySelectorAll(".agenda-filters .filter-chip").forEach(chip=>{
            chip.addEventListener("click",()=>{
                document.querySelectorAll(".agenda-filters .filter-chip").forEach(c=>c.classList.remove("active"));
                chip.classList.add("active");
                agendaFilter=chip.dataset.filter;
                renderAgenda(); renderAgendaDay();
            });
        });
        // Tabs mañana/tarde del timeline
        document.querySelectorAll(".tl-tab").forEach(tab=>{
            tab.addEventListener("click",()=>{
                document.querySelectorAll(".tl-tab").forEach(t=>t.classList.remove("active"));
                tab.classList.add("active");
                tlPeriod=tab.dataset.tperiod;
                renderAgendaDay();
            });
        });
    }

    // ── renderAdmin ────────────────────────────────────────
    let clientasPage = 1;
    const CLIENTAS_PER_PAGE = 10;

    window.changeClientasPage = function(delta) {
        clientasPage += delta;
        renderAdmin();
    }

    function renderAdmin() {
        const search=(document.getElementById("adminSearch")?.value||"").toLowerCase();
        let filtered=search?clientas.filter(c=>(c.nombre||"").toLowerCase().includes(search)||(c.telefono||"").includes(search)):[...clientas];

        // Orden alfabético
        filtered.sort((a,b) => (a.nombre||"").localeCompare(b.nombre||""));

        const todayISO=fmtISO(today);
        const startWeek=new Date(today); startWeek.setDate(today.getDate()-((today.getDay()+6)%7));
        const endWeek=new Date(startWeek); endWeek.setDate(startWeek.getDate()+6);
        const pendCount=citas.filter(c=>(c.estado||"pendiente")==="pendiente").length;
        const todayCount=citas.filter(c=>c.fecha===todayISO&&(c.estado||"pendiente")!=="cancelada").length;
        const weekCount=citas.filter(c=>{ if(!c.fecha) return false; const d=new Date(c.fecha+"T00:00:00"); return d>=startWeek&&d<=endWeek&&(c.estado||"pendiente")!=="cancelada"; }).length;

        document.getElementById("statClientas").textContent=clientas.length;
        document.getElementById("statPendientes").textContent=pendCount;
        document.getElementById("statHoy").textContent=todayCount;
        document.getElementById("statSemana").textContent=weekCount;
        const badge=document.getElementById("menuBadgePendientes");
        if(badge){ badge.textContent=pendCount; badge.style.display=pendCount>0?"flex":"none"; }

        renderAgenda(); renderAgendaDay();

        // Tabla clientas
        const tb=document.querySelector("#tablaClientes tbody");
        const pagEl=document.getElementById("clientasPagination");
        if(tb) {
            tb.innerHTML="";
            if(!filtered.length) {
                tb.innerHTML=`<tr><td colspan="3"><div class="empty-state"><i class="fa-regular fa-folder-open"></i><div class="label">${search?"Sin resultados":"Sin clientas registradas"}</div></div></td></tr>`;
                if(pagEl) pagEl.innerHTML = "";
            } else {
                const totalPages = Math.ceil(filtered.length / CLIENTAS_PER_PAGE) || 1;
                if(clientasPage > totalPages) clientasPage = totalPages;
                if(clientasPage < 1) clientasPage = 1;
                const startIdx = (clientasPage - 1) * CLIENTAS_PER_PAGE;
                const paged = filtered.slice(startIdx, startIdx + CLIENTAS_PER_PAGE);

                paged.forEach(c=>{
                    const v=c.visitas||0, pct=Math.min(v,10)*10;
                    tb.innerHTML+=`<tr>
                        <td><div class="client-name">${escapeHTML(c.nombre)}</div><div class="client-phone">${c.usuario?`@${escapeHTML(c.usuario)} · `:""} ${escapeHTML(c.telefono||"—")}</div></td>
                        <td><span class="stamps-pill ${v>=10?"full":""}"><span>${v}/10</span><span class="bar" style="--p:${pct}%"></span></span></td>
                        <td style="text-align:right;">
                            <button class="action-icon success" title="Sumar sello" onclick="sumarVisita(${inlineArg(c.id)},${v})"><i class="fa-solid fa-plus"></i></button>
                            <button class="action-icon" style="color:var(--burgundy);" title="Restar sello" onclick="restarVisita(${inlineArg(c.id)},${v})"><i class="fa-solid fa-minus"></i></button>
                            ${v >= 10 ? `<button class="btn-ghost" onclick="canjearRegalo(${inlineArg(c.id)})">Canjear regalo</button>` : ''}
                            <button class="action-icon" title="Reiniciar" onclick="reiniciarVisitas(${inlineArg(c.id)})"><i class="fa-solid fa-rotate-left"></i></button>
                            <button class="action-icon danger" title="Eliminar" onclick="borrarCliente(${inlineArg(c.id)})"><i class="fa-solid fa-trash"></i></button>
                        </td></tr>`;
                });

                if(pagEl) {
                    pagEl.innerHTML = `
                        <div>Mostrando ${startIdx + 1}-${Math.min(startIdx + CLIENTAS_PER_PAGE, filtered.length)} de ${filtered.length} clientas</div>
                        <div style="display:flex; gap:8px;">
                            <button class="cal-nav" style="width:32px;height:32px;font-size:12px;" onclick="changeClientasPage(-1)" ${clientasPage===1?'disabled':''}><i class="fa-solid fa-chevron-left"></i></button>
                            <span style="display:flex; align-items:center; font-weight:600; font-size:13px; color:var(--text); padding:0 8px;">Pág. ${clientasPage} de ${totalPages}</span>
                            <button class="cal-nav" style="width:32px;height:32px;font-size:12px;" onclick="changeClientasPage(1)" ${clientasPage===totalPages?'disabled':''}><i class="fa-solid fa-chevron-right"></i></button>
                        </div>
                    `;
                }
            }
        }

        // Lista solicitudes pendientes
        const lista=document.getElementById("listaCitasPendientes");
        if(lista) {
            const pendientes=citas.filter(c=>(c.estado||"pendiente")==="pendiente");
            lista.innerHTML="";
            if(!pendientes.length) {
                lista.innerHTML=`<div class="empty-state"><i class="fa-regular fa-calendar"></i><div class="label">Sin solicitudes pendientes</div></div>`;
            } else {
                pendientes.forEach(cita=>{
                    const fecha=cita.fecha?new Date(cita.fecha+"T00:00:00").toLocaleDateString("es-ES",{day:"numeric",month:"long"}):"—";
                    lista.innerHTML+=`<div class="cita-card">
                        <div class="cita-name">${escapeHTML(cita.nombre_cliente||"—")}</div>
                        ${cita.servicio?`<div style="font-size:11px;color:var(--accent);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;font-weight:600;">${escapeHTML(cita.servicio)}</div>`:""}
                        <div class="cita-meta">
                            <span><i class="fa-regular fa-calendar"></i>${fecha}</span>
                            <span><i class="fa-regular fa-clock"></i>${(cita.hora||"—").slice(0,5)}${cita.duracion_minutos?` · ${durStr(cita.duracion_minutos)}`:""}</span>
                            <span><i class="fa-solid fa-phone"></i>${escapeHTML(cita.telefono||"—")}</span>
                        </div>
                        <div class="cita-actions">
                            <button class="cita-btn approve" onclick="aprobarCita(${cita.id})"><i class="fa-solid fa-check" style="margin-right:5px;"></i>Aprobar</button>
                            <button class="cita-btn reject" onclick="abrirEditarCita(${cita.id})" title="Editar"><i class="fa-solid fa-pen"></i></button>
                            <button class="cita-btn reject" onclick="rechazarCita(${cita.id})" title="Rechazar"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </div>`;
                });
            }
        }
    }

    // Todas las acciones de fidelidad se guardan en una transacción del servidor.
    const operacionesPendientes = new Map();
    const operacionesEnCurso = new Map();
    async function operacionSalon(tipo, datos) {
        const key = JSON.stringify([tipo, datos]);
        if (operacionesEnCurso.has(key)) return operacionesEnCurso.get(key);
        const ejecutar = async () => {
            if (!operacionesPendientes.has(key)) operacionesPendientes.set(key, crypto.randomUUID());
            const { data, error } = await sb.rpc('salon_operar', {
                p_operacion: operacionesPendientes.get(key), p_tipo: tipo, p_datos: datos
            });
            if (error) {
                if (error.hint === 'CONFIRMAR_SIN_SELLO') {
                    const ok = await askConfirm('Revisar tarjeta', error.message);
                    if (!ok) throw new Error('No se guardaron cambios.');
                    const result = await operacionSalon(tipo, { ...datos, conservar_sellos: true });
                    operacionesPendientes.delete(key);
                    return result;
                }
                if (error.code === 'PGRST202') throw new Error('Falta activar la actualización del salón. Contacta con la persona que gestiona la web.');
                throw error;
            }
            operacionesPendientes.delete(key);
            return data;
        };
        const promise = ejecutar();
        operacionesEnCurso.set(key, promise);
        try { return await promise; }
        finally { operacionesEnCurso.delete(key); }
    }
    function resultadoSalon(result, mensaje) {
        toast(result?.aviso || mensaje, result?.aviso ? 'info' : 'success');
    }
    async function guardarCitaSalon(cita, cambios) {
        return operacionSalon('guardar_cita', { id: cita?.id || null, antes: cita || null, cita: cambios });
    }
    async function cambiarEstadoCita(id, estado) {
        if (_citasGuardando.has(id)) return;
        const cita = citas.find(c => c.id === id);
        if (!cita || cita.estado === estado) return;
        _citasGuardando.add(id);
        try {
            const result = await guardarCitaSalon(cita, { estado });
            resultadoSalon(result, estado === 'completada' ? 'Cita completada y tarjeta actualizada' : 'Cita confirmada');
        } catch (e) { toast(e.message || 'No se pudo guardar la cita', 'error'); }
        finally { try { await cargarDatosAdmin(); } finally { _citasGuardando.delete(id); } }
    }
    async function aprobarCita(id) { return cambiarEstadoCita(id, 'confirmada'); }
    async function completarCita(id) { return cambiarEstadoCita(id, 'completada'); }
    async function eliminarCita(id) {
        if (_citasGuardando.has(id)) return false;
        const cita = citas.find(c => c.id === id);
        if (!cita) return false;
        _citasGuardando.add(id);
        try {
            if (!await askConfirm('Eliminar cita', 'Se eliminará la cita y se revisará su movimiento de sellos.')) return false;
            const result = await operacionSalon('eliminar_cita', { id, antes: cita });
            resultadoSalon(result, 'Cita eliminada y tarjeta actualizada');
            await cargarDatosAdmin();
            return true;
        } catch (e) { toast(e.message || 'No se pudo eliminar', 'error'); return false; }
        finally { _citasGuardando.delete(id); }
    }
    async function rechazarCita(id) { return eliminarCita(id); }

    // ── Editar cita modal ──────────────────────────────────
    function setEditEstado(estado) {
        document.getElementById("editCitaEstado").value=estado;
        document.querySelectorAll("#editEstadoGroup .estado-opt").forEach(b=>b.classList.toggle("active",b.dataset.estado===estado));
    }
    function abrirEditarCita(id) {
        const cita=citas.find(c=>c.id===id);
        if (!cita) return;
        document.getElementById("editCitaId").value=cita.id;
        document.getElementById("editCitaNombre").value=cita.nombre_cliente||"";
        document.getElementById("editCitaTelefono").value=cita.telefono||"";
        document.getElementById("editCitaFecha").value=cita.fecha||"";
        document.getElementById("editCitaHora").value=cita.hora||"";
        document.getElementById("editCitaPrecio").value=parsePrecio(cita.precio) || 0;
        edCargarServicioDeCita(cita);
        setEditEstado(cita.estado||"pendiente");
        document.getElementById("editCitaModal").classList.add("show");
    }

    // ── Selector de servicio del editor de cita ────────────
    // Arranca con el servicio que ya tiene la cita; si no se toca, se guarda igual que estaba.
    let edSelServicio = null, edSelDuracion = 0, edSelPrecio = 0, edSelExtras = [];

    function edTextoServicio() {
        if (!edSelServicio) return "";
        return edSelExtras.length
            ? edSelServicio + " + " + edSelExtras.map(e => e.name).join(" + ")
            : edSelServicio;
    }
    function edDuracionTotal() { return edSelDuracion + edSelExtras.reduce((s, e) => s + e.dur, 0); }
    function edPrecioTotal()   { return edSelPrecio   + edSelExtras.reduce((s, e) => s + e.precio, 0); }

    function edPintarResumen() {
        const txt = document.getElementById("editServicioTexto");
        if (!txt) return;
        const nombre = edTextoServicio();
        txt.textContent = nombre ? nombre + " · " + durStr(edDuracionTotal()) : "Sin servicio asignado";
    }

    window.edToggleServicios = function() {
        const grid = document.getElementById("editServicioGrid");
        const btn  = document.getElementById("btnCambiarServicio");
        if (!grid) return;
        const abierto = grid.style.display !== "none";
        grid.style.display = abierto ? "none" : "grid";
        if (btn) btn.textContent = abierto ? "Cambiar" : "Cerrar";
        if (!abierto) edRenderServicios();
    };

    function edRenderServicios() {
        const grid = document.getElementById("editServicioGrid");
        if (!grid) return;
        if (!NC_SERVICIOS || !NC_SERVICIOS.length) {
            grid.innerHTML = '<div class="nc-servicio-grupo-titulo">No se pudo cargar el catalogo de servicios</div>';
            return;
        }
        grid.innerHTML = "";
        NC_SERVICIOS.forEach(g => {
            const titulo = g.isExtras ? g.grupo + " (se suman al servicio)" : g.grupo;
            grid.innerHTML += `<div class="nc-servicio-grupo-titulo">${titulo}</div>`;
            g.items.forEach(it => {
                const sel = g.isExtras ? edSelExtras.some(e => e.name === it.val) : edSelServicio === it.val;
                const caja = g.isExtras ? `<i class="${sel?'fa-solid fa-square-check':'fa-regular fa-square'}" style="margin-right:6px;"></i>` : "";
                grid.innerHTML += `<div class="nc-servicio-opcion${sel?" selected":""}" data-esextra="${g.isExtras?1:0}" data-val="${escapeHTML(it.val)}" data-dur="${it.dur}" data-precio="${escapeHTML(it.precio)}"${g.isExtras?' style="border-style:dashed;"':''}>
                    <span>${caja}${escapeHTML(it.nombre)}</span>
                    <span class="servicio-opcion-precio" style="margin-left:auto;margin-right:8px;">${escapeHTML(it.precio)}</span>
                    <span class="nc-srv-dur">${escapeHTML(it.durTxt)}</span>
                </div>`;
            });
        });
        grid.querySelectorAll(".nc-servicio-opcion").forEach(el => {
            el.addEventListener("click", () => {
                const dur    = parseInt(el.dataset.dur, 10) || 0;
                const precio = parsePrecio(el.dataset.precio);
                if (el.dataset.esextra === "1") {
                    const i = edSelExtras.findIndex(e => e.name === el.dataset.val);
                    if (i >= 0) edSelExtras.splice(i, 1);
                    else edSelExtras.push({ name: el.dataset.val, dur, precio });
                } else {
                    edSelServicio = el.dataset.val;
                    edSelDuracion = dur || 30;
                    edSelPrecio   = precio;
                    edSelExtras   = [];
                }
                edRenderServicios();
                edPintarResumen();
                const campoPrecio = document.getElementById("editCitaPrecio");
                if (campoPrecio) campoPrecio.value = edPrecioTotal();
            });
        });
    }

    function edCargarServicioDeCita(cita) {
        edSelExtras   = [];
        edSelServicio = cita.servicio || null;
        edSelDuracion = parseInt(cita.duracion_minutos, 10) || 0;
        edSelPrecio   = parsePrecio(cita.precio) || 0;
        const grid = document.getElementById("editServicioGrid");
        const btn  = document.getElementById("btnCambiarServicio");
        if (grid) { grid.style.display = "none"; grid.innerHTML = ""; }
        if (btn) btn.textContent = "Cambiar";
        edPintarResumen();
    }
    function closeEditCita() { document.getElementById("editCitaModal").classList.remove("show"); }
    document.getElementById("editCitaModal").addEventListener("click",e=>{ if(e.target.id==="editCitaModal") closeEditCita(); });
    document.querySelectorAll("#editEstadoGroup .estado-opt").forEach(b=>b.addEventListener("click",()=>setEditEstado(b.dataset.estado)));

    async function confirmarEliminarCita() {
        const id = parseInt(document.getElementById('editCitaId').value, 10);
        if (await eliminarCita(id)) closeEditCita();
    }
    let edGuardando = false;
    async function guardarEdicionCita() {
        if (edGuardando) return;
        edGuardando = true;
        try { await guardarEdicionCitaImpl(); }
        finally { edGuardando = false; }
    }

    async function guardarEdicionCitaImpl() {
        const id=parseInt(document.getElementById("editCitaId").value,10);
        const nuevoEstado=document.getElementById("editCitaEstado").value||"pendiente";
        const previa=citas.find(c=>c.id===id);
        if (!previa) return toast("La cita ya no está disponible. Actualiza la agenda.", "error");
        const payload={
            nombre_cliente:document.getElementById("editCitaNombre").value.trim(),
            telefono:document.getElementById("editCitaTelefono").value.trim(),
            fecha:document.getElementById("editCitaFecha").value,
            hora:document.getElementById("editCitaHora").value,
            precio:document.getElementById("editCitaPrecio").value.trim(),
            estado:nuevoEstado,
            duracion_minutos:edDuracionTotal()||(previa?(parseInt(previa.duracion_minutos,10)||30):30),
            servicio:edTextoServicio()||(previa?(previa.servicio||""):"")
        };
        if (!payload.nombre_cliente||!payload.telefono||!payload.fecha||!payload.hora) return toast("Completa todos los campos","error");

        // No bloquear correcciones de nombre/precio de citas históricas sin cambiar su horario.
        const cambiaHorario = payload.fecha !== previa.fecha || payload.hora.slice(0,5) !== previa.hora.slice(0,5) || payload.duracion_minutos !== (previa.duracion_minutos || 30);
        if (nuevoEstado !== "cancelada" && cambiaHorario) {
        if (nuevoEstado !== "cancelada" && (!await cargarDisponibles() || !isDiaDisponible(payload.fecha))) return toast("No se pudo verificar que el día esté disponible.", "error");
        const _durEdit = payload.duracion_minutos;
        const _horaEdit = (payload.hora||"").slice(0,5);
        if (slotFueraDeHorario(_horaEdit, _durEdit)) return toast("El servicio no cabe en ese horario","error");
        try {
            const { data: _frescas, error: _chk } = await sb.from("citas")
                .select("id,hora,duracion_minutos,estado")
                .eq("fecha", payload.fecha)
                .neq("estado", "cancelada");
            if (_chk) return toast("No se pudo verificar la disponibilidad. Inténtalo de nuevo.","error");
            // Excluir la propia cita que se está editando
            const _otras = (_frescas||[]).filter(c => c.id !== id).map(c => ({...c, fecha: payload.fecha}));
            if (slotBloqueado(_horaEdit, _otras, _durEdit, payload.fecha)) return toast("Ese horario ya está ocupado o bloqueado","error");
        } catch(e) { return toast("No se pudo verificar la disponibilidad.","error"); }

        }
        setBtnLoading("btnGuardarEdicion",true);
        try {
            const result = await guardarCitaSalon(previa, payload);
            resultadoSalon(result, 'Cita y tarjeta actualizadas');
            closeEditCita();
            await cargarDatosAdmin();
        } catch(e) {
            toast(e.message || 'No se pudo guardar la cita', 'error');
        }
        finally { setBtnLoading("btnGuardarEdicion",false); }
    }

    // ── Clientas acciones ──────────────────────────────────
    const tarjetasGuardando = new Set();
    async function ajustarTarjeta(id, accion) {
        if (tarjetasGuardando.has(id)) return;
        const cliente = clientas.find(c => c.id === id);
        if (!cliente) return;
        tarjetasGuardando.add(id);
        try {
            if (accion === 'canjear' && !await askConfirm('Canjear regalo', 'Confirma que se ha entregado el diseño de regalo. La nueva tarjeta empezará con cero sellos.')) return;
            if (accion === 'reiniciar' && !await askConfirm('Reiniciar tarjeta', 'Se pondrán los sellos a cero como ajuste manual. Esta acción no registra un regalo entregado.')) return;
            const result = await operacionSalon('ajustar_sellos', { cliente_id: id, accion, antes: Number(cliente.visitas) || 0 });
            resultadoSalon(result, accion === 'canjear' ? 'Regalo canjeado. Nueva tarjeta iniciada.' : 'Tarjeta actualizada');
            await cargarDatosAdmin();
        } catch (e) { toast(e.message || 'No se pudo actualizar la tarjeta', 'error'); }
        finally { tarjetasGuardando.delete(id); }
    }
    async function sumarVisita(id) { return ajustarTarjeta(id, 'sumar'); }
    async function restarVisita(id) { return ajustarTarjeta(id, 'restar'); }
    async function reiniciarVisitas(id) { return ajustarTarjeta(id, 'reiniciar'); }
    async function canjearRegalo(id) { return ajustarTarjeta(id, 'canjear'); }
    async function borrarCliente(id) {
        if (!await askConfirm('Eliminar clienta', 'Se eliminarán su perfil, citas y movimientos de sellos. Esta acción no se puede deshacer.')) return;
        try {
            await operacionSalon('eliminar_clienta', { cliente_id: id });
            toast('Clienta eliminada', 'success');
            await cargarDatosAdmin();
        } catch (e) { toast(e.message || 'No se pudo eliminar la clienta', 'error'); }
    }

    // ── Días disponibles ───────────────────────────────────
    function renderDCalendar() {
        const monthEl=document.getElementById("dCalMonth");
        const grid=document.getElementById("dCalGrid");
        if(!monthEl||!grid) return;
        monthEl.textContent=`${MONTHS_ES[dCalCursor.getMonth()]} ${dCalCursor.getFullYear()}`;
        grid.innerHTML="";
        DOW_ES.forEach(d=>grid.innerHTML+=`<div class="cal-dow">${d}</div>`);
        const y=dCalCursor.getFullYear(), m=dCalCursor.getMonth();
        const offset=(new Date(y,m,1).getDay()+6)%7;
        const dim=new Date(y,m+1,0).getDate();
        const prevDim=new Date(y,m,0).getDate();
        for(let i=offset-1;i>=0;i--) grid.innerHTML+=`<div class="cal-day muted">${prevDim-i}</div>`;
        for(let d=1;d<=dim;d++){
            const iso=`${y}-${pad2(m+1)}-${pad2(d)}`;
            const isBloqueado=diasDisponibles.some(b=>b.tipo==="dia_bloqueado"&&b.valor===iso);
            const isToday=new Date(y,m,d).getTime()===today.getTime();
            let cls="cal-day";
            if(isToday) cls+=" today";
            if(isBloqueado) cls+=" bloqueado";
            grid.innerHTML+=`<div class="${cls}" data-iso="${iso}">${d}</div>`;
        }
        const trail=(7-((offset+dim)%7))%7;
        for(let i=1;i<=trail;i++) grid.innerHTML+=`<div class="cal-day muted">${i}</div>`;
        grid.querySelectorAll(".cal-day:not(.muted)").forEach(el=>{
            el.addEventListener("click",()=>toggleDisponible("dia_bloqueado",el.dataset.iso));
        });
    }
    function renderDispDiaItems() {
        const el=document.getElementById("dispDiaItems"); if(!el) return;
        const dias=diasDisponibles.filter(b=>b.tipo==="dia_bloqueado").sort((a,b)=>a.valor.localeCompare(b.valor));
        if(!dias.length){ el.innerHTML=`<div class="empty-state" style="padding:14px 0;font-size:12px;">Sin días bloqueados</div>`; el.style.display="block"; return; }

        const porMes = {};
        dias.forEach(b => {
            const dt = new Date(b.valor+"T00:00:00");
            const mesStr = `${MONTHS_ES[dt.getMonth()]} ${dt.getFullYear()}`;
            if (!porMes[mesStr]) porMes[mesStr] = [];
            porMes[mesStr].push({dt, b});
        });

        el.style.display = "block";
        el.innerHTML = Object.entries(porMes).map(([mes, arr]) => {
            const pills = arr.map(({dt, b}) => `
                <div style="display:inline-flex; align-items:center; background:#fff; border:1px solid rgba(59,33,28,0.3); border-radius:20px; padding:6px 12px; font-size:12px; font-weight:600; color:var(--burgundy); box-shadow:0 2px 5px rgba(0,0,0,0.03); margin:4px;">
                    <span>${dt.getDate()} ${MONTHS_ES[dt.getMonth()].slice(0,3)}</span>
                    <button onclick="toggleDisponible('dia_bloqueado','${b.valor}')" style="background:none; border:none; padding:0; margin-left:8px; color:var(--burgundy); cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
                </div>
            `).join("");

            return `
            <details style="margin-bottom:10px; background:#fafafa; border:1px solid var(--line); border-radius:10px; overflow:hidden;" open>
                <summary style="padding:10px 14px; font-size:13px; font-weight:600; cursor:pointer; outline:none; color:var(--text-main); user-select:none; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center;">
                    <span><i class="fa-regular fa-calendar" style="margin-right:6px; color:var(--burgundy);"></i>${mes}</span>
                    <span style="font-size:11px; background:rgba(59,33,28,0.1); color:var(--burgundy); padding:2px 8px; border-radius:12px;">${arr.length}</span>
                </summary>
                <div style="padding:10px; display:flex; flex-wrap:wrap; gap:4px;">
                    ${pills}
                </div>
            </details>`;
        }).join("");
    }
    function renderMesesGrid() {
        const grid=document.getElementById("mesesGrid"); if(!grid) return;
        grid.innerHTML="";
        [today.getFullYear(), today.getFullYear()+1].forEach((year,yi)=>{
            for(let m=0;m<12;m++){
                const valor=`${year}-${pad2(m+1)}`;
                const isBloqueado=diasDisponibles.some(b=>b.tipo==="mes_bloqueado"&&b.valor===valor);
                grid.innerHTML+=`<button type="button" class="mes-chip ${isBloqueado?"bloqueado":""}" onclick="toggleDisponible('mes_bloqueado','${valor}')" style="${yi>0?"opacity:.75":""}">${MONTHS_ES[m]}${yi>0?` '${String(year).slice(2)}`:""}</button>`;
            }
        });
    }
    async function toggleDisponible(tipo,valor){
        let res;
        const ex=diasDisponibles.find(b=>b.tipo===tipo&&b.valor===valor);
        if(ex){
            res=await checked(sb.from("dias_disponibles").delete().eq("id",ex.id).select('id').single());
            if(!res.error) toast(tipo==="mes_bloqueado"?"Mes desbloqueado":"Día desbloqueado","success");
        } else {
            res=await sb.from("dias_disponibles").insert([{tipo,valor}]);
            if(!res.error) toast(tipo==="mes_bloqueado"?"Mes bloqueado":"Día bloqueado","info");
        }

        if (res && res.error) {
            toast("No se pudo guardar: "+res.error.message,"error");
            return;
        }
        await cargarDisponibles();
    }
    // ══════════════════════════════════════════════════════
    //  HORAS BLOQUEADAS
    // ══════════════════════════════════════════════════════
    let hCalCursor     = null;
    let hCalSelected   = null; // fecha ISO seleccionada en el mini-cal de horas

    const ALL_SLOTS_H = [
        "09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30",
        "16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30"
    ];

    function renderHCalendar() {
        const monthEl = document.getElementById("hCalMonth");
        const grid    = document.getElementById("hCalGrid");
        if (!monthEl || !grid) return;
        monthEl.textContent = `${MONTHS_ES[hCalCursor.getMonth()]} ${hCalCursor.getFullYear()}`;
        grid.innerHTML = "";
        DOW_ES.forEach(d => grid.innerHTML += `<div class="cal-dow">${d}</div>`);
        const y = hCalCursor.getFullYear(), m = hCalCursor.getMonth();
        const offset  = (new Date(y,m,1).getDay()+6)%7;
        const dim     = new Date(y,m+1,0).getDate();
        const prevDim = new Date(y,m,0).getDate();
        for (let i=offset-1; i>=0; i--) grid.innerHTML += `<div class="cal-day muted">${prevDim-i}</div>`;
        for (let d=1; d<=dim; d++) {
            const iso = `${y}-${pad2(m+1)}-${pad2(d)}`;
            const dt  = new Date(y,m,d);
            const isSel  = hCalSelected === iso;
            const isToday = dt.getTime()===today.getTime();
            // ¿Tiene alguna hora bloqueada?
            const tieneBloqueo = diasDisponibles.some(b=>b.tipo==="hora_bloqueada"&&b.valor.startsWith(iso));
            let cls = "cal-day";
            if (isToday) cls += " today";
            if (isSel)   cls += " selected";
            if (tieneBloqueo && !isSel) cls += " has-citas"; // reutilizar estilo de punto
            grid.innerHTML += `<div class="${cls}" data-iso="${iso}">${d}</div>`;
        }
        const trail = (7-((offset+dim)%7))%7;
        for (let i=1; i<=trail; i++) grid.innerHTML += `<div class="cal-day muted">${i}</div>`;
        grid.querySelectorAll(".cal-day:not(.muted)").forEach(el => {
            el.addEventListener("click", () => {
                hCalSelected = el.dataset.iso;
                renderHCalendar();
                renderHorasSlots();
            });
        });
    }

    function renderHorasSlots() {
        const mGrid = document.getElementById("horasSlotsManana");
        const tGrid = document.getElementById("horasSlotsTarde");
        const titulo = document.getElementById("horasFechaSel");
        if (!mGrid || !tGrid) return;

        if (!hCalSelected) {
            titulo.textContent = "Elige un día";
            mGrid.innerHTML = tGrid.innerHTML = `<div style="grid-column:1/-1;font-size:12px;color:var(--muted);padding:8px 0;">Selecciona un día en el calendario</div>`;
            return;
        }

        const dt = new Date(hCalSelected+"T00:00:00");
        const dias = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
        titulo.textContent = `${dias[dt.getDay()]} ${dt.getDate()} de ${MONTHS_ES[dt.getMonth()].toLowerCase()}`;

        // Citas existentes ese día (slots con cita no se pueden bloquear manualmente)
        const citasEseDia = citas.filter(c => c.fecha===hCalSelected && (c.estado||"pendiente")!=="cancelada");

        function renderSlots(slots, container) {
            container.innerHTML = "";
            slots.forEach(t => {
                const key = `${hCalSelected}T${t}`;
                const bloqueada = diasDisponibles.some(b=>b.tipo==="hora_bloqueada"&&b.valor===key);
                // ¿Hay cita en ese slot o está cubierto por duración?
                const tMin = toMin(t);
                const conCita = citasEseDia.some(c => {
                    const ini = toMin((c.hora||"").slice(0,5));
                    const fin = ini + (parseInt(c.duracion_minutos,10)||30);
                    return tMin >= ini && tMin < fin;
                });
                let cls = "hora-slot-btn";
                if (bloqueada) cls += " bloqueada";
                if (conCita)   cls += " con-cita";
                const title = conCita ? "Hay una cita en este horario" : bloqueada ? "Clic para desbloquear" : "Clic para bloquear";
                container.innerHTML += `<button type="button" class="${cls}" data-key="${key}" data-t="${t}" ${conCita?"disabled":""} title="${title}">${t}${bloqueada?'<br><span style="font-size:8px;letter-spacing:1px;">BLOQUEADA</span>':""}</button>`;
            });
            container.querySelectorAll(".hora-slot-btn:not([disabled])").forEach(btn => {
                btn.addEventListener("click", () => toggleHoraBloqueada(btn.dataset.key, btn.dataset.t));
            });
        }

        renderSlots(["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30"], mGrid);
        renderSlots(["16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30","20:00","20:30"], tGrid);
    }

    async function toggleHoraBloqueada(key, t) {
        const existing = diasDisponibles.find(b=>b.tipo==="hora_bloqueada"&&b.valor===key);
        if (existing) {
            const { error } = await sb.from("dias_disponibles").delete().eq("id",existing.id);
            if (!error) toast(`Hora ${t} desbloqueada`,"success");
            else { toast("Error: "+error.message,"error"); return; }
        } else {
            const { error } = await sb.from("dias_disponibles").insert([{tipo:"hora_bloqueada", valor:key}]);
            if (!error) toast(`Hora ${t} bloqueada`,"info");
            else { toast("Error: "+error.message,"error"); return; }
        }
        await cargarDisponibles();
        renderHorasSlots();
        renderHCalendar();
        renderHorasLista();
    }

    function renderHorasLista() {
        const el = document.getElementById("horasListaBloqueadas");
        if (!el) return;
        const bloqueadas = diasDisponibles
            .filter(b=>b.tipo==="hora_bloqueada")
            .sort((a,b)=>a.valor.localeCompare(b.valor));
        if (!bloqueadas.length) {
            el.innerHTML = `<div class="empty-state" style="padding:14px 0;font-size:12px;">Sin horas bloqueadas</div>`;
            return;
        }

        // Agrupar por mes, y luego por fecha
        const porMes = {};
        bloqueadas.forEach(b => {
            const [fecha, hora] = b.valor.split("T");
            const dt = new Date(fecha+"T00:00:00");
            const mesStr = `${MONTHS_ES[dt.getMonth()]} ${dt.getFullYear()}`;
            if (!porMes[mesStr]) porMes[mesStr] = {};
            if (!porMes[mesStr][fecha]) porMes[mesStr][fecha] = [];
            porMes[mesStr][fecha].push({hora, id:b.id, key:b.valor});
        });

        el.innerHTML = Object.entries(porMes).map(([mes, fechasObj]) => {
            let totalHorasMes = 0;
            const fechasHTML = Object.entries(fechasObj).map(([fecha, horas]) => {
                totalHorasMes += horas.length;
                const dt = new Date(fecha+"T00:00:00");
                const label = `${dt.getDate()} de ${MONTHS_ES[dt.getMonth()].toLowerCase()}`;
                const pills = horas.map(h =>
                    `<span style="display:inline-flex;align-items:center;gap:5px;background:rgba(59,33,28,.08);border:1px solid rgba(59,33,28,.2);color:var(--burgundy);border-radius:15px;padding:4px 10px;font-size:11px;font-weight:600;margin:3px;">
                        ${h.hora}
                        <button onclick="desbloquearHora('${h.key}','${h.hora}')" style="background:none;border:none;cursor:pointer;color:var(--burgundy);font-size:10px;padding:0;line-height:1;"><i class="fa-solid fa-xmark"></i></button>
                    </span>`
                ).join("");
                return `
                <div style="margin-bottom:12px;">
                    <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:6px;"><i class="fa-solid fa-calendar-day" style="margin-right:4px;"></i>${label}</div>
                    <div style="display:flex; flex-wrap:wrap;">${pills}</div>
                </div>`;
            }).join("");

            return `
            <details style="margin-bottom:10px; background:#fafafa; border:1px solid var(--line); border-radius:10px; overflow:hidden;" open>
                <summary style="padding:10px 14px; font-size:13px; font-weight:600; cursor:pointer; outline:none; color:var(--text-main); user-select:none; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center;">
                    <span><i class="fa-regular fa-clock" style="margin-right:6px; color:var(--burgundy);"></i>${mes}</span>
                    <span style="font-size:11px; background:rgba(59,33,28,0.1); color:var(--burgundy); padding:2px 8px; border-radius:12px;">${totalHorasMes} bloqueos</span>
                </summary>
                <div style="padding:12px 14px 4px 14px;">
                    ${fechasHTML}
                </div>
            </details>`;
        }).join("");
    }

    async function desbloquearHora(key, hora) {
        const existing = diasDisponibles.find(b=>b.tipo==="hora_bloqueada"&&b.valor===key);
        if (!existing) return;
        const { error } = await sb.from("dias_disponibles").delete().eq("id",existing.id);
        if (!error) { toast(`Hora ${hora} desbloqueada`,"success"); await cargarDisponibles(); renderHorasLista(); renderHorasSlots(); renderHCalendar(); }
        else toast("Error: "+error.message,"error");
    }

        function initDispPanel(){
        dCalCursor = new Date(today.getFullYear(),today.getMonth(),1);
        hCalCursor = new Date(today.getFullYear(),today.getMonth(),1);

        const dPrev=document.getElementById("dCalPrev");
        const dNext=document.getElementById("dCalNext");
        if(dPrev) dPrev.addEventListener("click",()=>{ dCalCursor=new Date(dCalCursor.getFullYear(),dCalCursor.getMonth()-1,1); renderDCalendar(); });
        if(dNext) dNext.addEventListener("click",()=>{ dCalCursor=new Date(dCalCursor.getFullYear(),dCalCursor.getMonth()+1,1); renderDCalendar(); });

        const hPrev=document.getElementById("hCalPrev");
        const hNext=document.getElementById("hCalNext");
        if(hPrev) hPrev.addEventListener("click",()=>{ hCalCursor=new Date(hCalCursor.getFullYear(),hCalCursor.getMonth()-1,1); renderHCalendar(); });
        if(hNext) hNext.addEventListener("click",()=>{ hCalCursor=new Date(hCalCursor.getFullYear(),hCalCursor.getMonth()+1,1); renderHCalendar(); });

        document.querySelectorAll(".disp-tab").forEach(tab=>{
            tab.addEventListener("click",()=>{
                document.querySelectorAll(".disp-tab").forEach(t=>t.classList.remove("active"));
                document.querySelectorAll(".disp-panel").forEach(p=>p.classList.remove("active"));
                tab.classList.add("active");
                const id = "dpanel"+tab.dataset.dtab.charAt(0).toUpperCase()+tab.dataset.dtab.slice(1);
                const target=document.getElementById(id);
                if(target) target.classList.add("active");
                if(tab.dataset.dtab==="horas") {
                    renderHCalendar();
                    renderHorasSlots();
                    renderHorasLista();
                }
            });
        });
    }

    // ══════════════════════════════════════════════════════
    //  NUEVA CITA (admin) — agendar directamente
    // ══════════════════════════════════════════════════════
    let ncSelectedClient = null;
    let ncSelectedServicio = null;
    let ncSelectedDuracion = 0;

    // Lista de servicios para el selector (reutilizamos los que ya existen en el HTML del cliente)
    let NC_SERVICIOS = [];
    let ncSelectedPrecio = 0;
    let ncSelectedExtras = []; // [{name, dur, precio}]

    function ncRenderServicios() {
        const grid = document.getElementById("ncServicioGrid");
        if (!grid) return;
        grid.innerHTML = "";
        NC_SERVICIOS.forEach(g => {
            if (g.isExtras) {
                grid.innerHTML += `<div class="nc-servicio-grupo-titulo" style="color:var(--burgundy);"><i class="fa-solid fa-plus-circle" style="margin-right:4px;"></i>${escapeHTML(g.grupo)} (añadir al servicio)</div>`;
                g.items.forEach(it => {
                    const isSel = ncSelectedExtras.some(e => e.name === it.val);
                    grid.innerHTML += `<div style="margin-bottom:8px;">
                        <div class="nc-servicio-opcion nc-extra-addon${isSel?" selected":""}" data-extra="${escapeHTML(it.val)}" data-extradur="${it.dur}" data-precio="${escapeHTML(it.precio)}" style="border-style:dashed;${isSel?'border-color:var(--burgundy);background:rgba(59,33,28,.06);':'border-color:rgba(59,33,28,.25);'} margin-bottom:4px;">
                            <span><i class="${isSel?'fa-solid fa-square-check':'fa-regular fa-square'}" style="margin-right:6px;font-size:13px;"></i>${escapeHTML(it.nombre)}</span>
                            <span class="servicio-opcion-precio" style="margin-left:auto;margin-right:8px;">${escapeHTML(it.precio)}</span>
                            <span class="nc-srv-dur"${isSel?' style="background:var(--burgundy);color:#fff;"':''}>${escapeHTML(it.durTxt)}</span>
                        </div>
                        ${it.desc ? `<div style="font-size:11px; color:var(--muted); padding: 0 10px; line-height:1.3; text-align:justify;">${escapeHTML(it.desc)}</div>` : ''}
                    </div>`;
                });
            } else {
                grid.innerHTML += `<div class="nc-servicio-grupo-titulo">${escapeHTML(g.grupo)}</div>`;
                g.items.forEach(it => {
                    const isSel = ncSelectedServicio === it.val;
                    grid.innerHTML += `<div style="margin-bottom:8px;">
                        <div class="nc-servicio-opcion${isSel?" selected":""}" data-val="${escapeHTML(it.val)}" data-dur="${it.dur}" data-precio="${escapeHTML(it.precio)}" style="margin-bottom:4px;">
                            <span>${escapeHTML(it.nombre)}</span>
                            <span class="servicio-opcion-precio" style="margin-left:auto;margin-right:8px;">${escapeHTML(it.precio)}</span>
                            <span class="nc-srv-dur">${escapeHTML(it.durTxt)}</span>
                        </div>
                        ${it.desc ? `<div style="font-size:11px; color:var(--muted); padding: 0 10px; line-height:1.3; text-align:justify;">${escapeHTML(it.desc)}</div>` : ''}
                    </div>`;
                });
            }
        });
        // Click handler para servicios principales
        grid.querySelectorAll(".nc-servicio-opcion:not(.nc-extra-addon)").forEach(el => {
            el.addEventListener("click", () => {
                ncSelectedServicio = el.dataset.val;
                ncSelectedDuracion = parseInt(el.dataset.dur, 10) || 30;
                ncSelectedPrecio = parsePrecio(el.dataset.precio);
                ncSelectedExtras = [];
                ncRenderServicios();
                ncValidarSlot();
            });
        });
        // Click handler para extras (toggle)
        grid.querySelectorAll(".nc-extra-addon").forEach(el => {
            el.addEventListener("click", () => {
                const name = el.dataset.extra;
                const dur = parseInt(el.dataset.extradur, 10);
                const precio = parsePrecio(el.dataset.precio);
                const idx = ncSelectedExtras.findIndex(e => e.name === name);
                if (idx >= 0) ncSelectedExtras.splice(idx, 1);
                else ncSelectedExtras.push({ name, dur, precio });
                ncRenderServicios();
                ncValidarSlot();
            });
        });
    }

    function ncRenderResults(term) {
        const box = document.getElementById("ncClientResults");
        if (!box) return;
        term = (term||"").trim().toLowerCase();
        if (!term) { box.classList.remove("show"); box.innerHTML=""; return; }

        const matches = clientas.filter(c =>
            (c.nombre||"").toLowerCase().includes(term) ||
            (c.telefono||"").toLowerCase().includes(term) ||
            (c.usuario||"").toLowerCase().includes(term)
        ).slice(0, 8);

        let html = "";
        matches.forEach(c => {
            html += `<div class="nc-client-item" data-id="${c.id}">
                <span class="nc-cn">${escapeHTML(c.nombre||"—")}</span>
                <span class="nc-cm">${c.usuario?`@${escapeHTML(c.usuario)} · `:""}${escapeHTML(c.telefono||"—")}</span>
            </div>`;
        });
        // Opción "crear nueva"
        html += `<div class="nc-client-item new-client" data-new="1">
            <span class="nc-cn"><i class="fa-solid fa-user-plus"></i>Agendar para "${escapeHTML(term)}" sin cuenta</span>
            <span class="nc-cm">Guardar nombre y teléfono en esta cita; sin tarjeta de sellos</span>
        </div>`;
        box.innerHTML = html;
        box.classList.add("show");

        box.querySelectorAll(".nc-client-item[data-id]").forEach(el => {
            el.addEventListener("click", () => {
                const id = el.dataset.id;
                const c = clientas.find(x => String(x.id)===id);
                if (c) ncSetClient(c);
            });
        });
        const newBtn = box.querySelector(".nc-client-item[data-new]");
        if (newBtn) newBtn.addEventListener("click", () => ncMostrarNuevoCliente(term));
    }

    function ncSetClient(c) {
        ncSelectedClient = c;
        document.getElementById("ncScName").textContent = c.nombre || "—";
        document.getElementById("ncScMeta").textContent =
            (c.usuario?`@${escapeHTML(c.usuario)} · `:"") + (c.telefono||"—") +
            (c.visitas!=null ? ` · ${c.visitas}/10 sellos` : "");
        document.getElementById("ncClientSelected").style.display = "flex";
        document.getElementById("ncClientSelector").style.display = "none";
        document.getElementById("ncNewClientForm").style.display = "none";
        document.getElementById("ncClientResults").classList.remove("show");
    }

    function ncClearClient() {
        ncSelectedClient = null;
        document.getElementById("ncClientSelected").style.display = "none";
        document.getElementById("ncClientSelector").style.display = "block";
        document.getElementById("ncNewClientForm").style.display = "none";
        const search = document.getElementById("ncClientSearch");
        if (search) { search.value = ""; search.focus(); }
        document.getElementById("ncClientResults").classList.remove("show");
    }

    function ncMostrarNuevoCliente(nombrePrefill) {
        document.getElementById("ncClientResults").classList.remove("show");
        document.getElementById("ncNewClientForm").style.display = "block";
        const nn = document.getElementById("ncNewNombre");
        if (nn) { nn.value = nombrePrefill || ""; nn.focus(); }
        document.getElementById("ncNewTelef").value = "";
    }

    function ncCancelNewClient() {
        document.getElementById("ncNewClientForm").style.display = "none";
        document.getElementById("ncNewNombre").value = "";
        document.getElementById("ncNewTelef").value = "";
    }

    async function ncCrearYUsarCliente() {
        const nombre = document.getElementById('ncNewNombre').value.trim();
        const telefono = document.getElementById('ncNewTelef').value.trim();
        if (!nombre || !telefono) return toast('Introduce nombre y teléfono', 'error');
        ncSetClient({ id: null, nombre, telefono });
        ncCancelNewClient();
        toast('Se guardará como cita sin cuenta ni tarjeta de sellos.', 'info');
    }

    function ncValidarSlot() {
        const info = document.getElementById("ncSlotInfo");
        if (!info) return;
        const fecha = document.getElementById("ncFecha").value;
        const hora  = document.getElementById("ncHora").value;
        if (!fecha || !hora || !ncSelectedServicio) {
            info.classList.remove("show","error","ok");
            return;
        }
        const horaStr = hora.slice(0,5);
        const citasDelDia = citas.filter(c => c.fecha === fecha);
        const ncTotalDur = ncSelectedDuracion + ncSelectedExtras.reduce((s, e) => s + e.dur, 0);
        const fuera = slotFueraDeHorario(horaStr, ncTotalDur);
        const bloq  = slotBloqueado(horaStr, citasDelDia, ncTotalDur, fecha);

        info.classList.add("show");
        if (fuera) {
            info.className = "nc-slot-info show error";
            info.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> El servicio (${durStr(ncSelectedDuracion)}) no cabe en este horario.`;
        } else if (bloq) {
            info.className = "nc-slot-info show error";
            info.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Este horario ya está ocupado o bloqueado.`;
        } else {
            info.className = "nc-slot-info show ok";
            info.innerHTML = `<i class="fa-solid fa-circle-check"></i> Horario disponible · ${durStr(ncSelectedDuracion)}`;
        }
    }

    function abrirNuevaCita(prefillFecha, prefillHora) {
        document.body.style.overflow = "hidden";
        // Reset
        ncSelectedClient = null;
        ncSelectedServicio = null;
        ncSelectedDuracion = 0;
        ncSelectedExtras = [];
        document.getElementById("ncClientSelected").style.display = "none";
        document.getElementById("ncClientSelector").style.display = "block";
        document.getElementById("ncNewClientForm").style.display = "none";
        document.getElementById("ncClientSearch").value = "";
        document.getElementById("ncClientResults").classList.remove("show");
        document.getElementById("ncFecha").value = prefillFecha || fmtISO(today);
        document.getElementById("ncHora").value = prefillHora || "";
        document.getElementById("ncSlotInfo").classList.remove("show","error","ok");
        document.querySelectorAll("#ncEstadoGroup .estado-opt").forEach(b=>{
            b.classList.toggle("active", b.dataset.estado==="confirmada");
        });
        document.getElementById("ncEstado").value = "confirmada";
        ncRenderServicios();
        document.getElementById("nuevaCitaModal").classList.add("show");
    }

    function cerrarNuevaCita() {
        document.body.style.overflow = "";
        document.getElementById("nuevaCitaModal").classList.remove("show");
    }

    let ncGuardando = false;
    async function guardarNuevaCita() {
        if (ncGuardando) return;
        ncGuardando = true;
        try { await guardarNuevaCitaImpl(); }
        finally { ncGuardando = false; }
    }
    async function guardarNuevaCitaImpl() {
        if (!ncSelectedClient) return toast("Selecciona una clienta primero","error");
        if (!ncSelectedServicio) return toast("Selecciona un servicio","error");
        const fecha = document.getElementById("ncFecha").value;
        const hora  = document.getElementById("ncHora").value;
        if (!fecha || !hora) return toast("Introduce fecha y hora","error");
        if (!await cargarDisponibles() || !isDiaDisponible(fecha)) return toast("No se pudo verificar que el día esté disponible.", "error");

        const horaStr = hora.slice(0,5);
        const ncTotalDurFinal = ncSelectedDuracion + ncSelectedExtras.reduce((s, e) => s + e.dur, 0);
        if (slotFueraDeHorario(horaStr, ncTotalDurFinal)) return toast("El servicio no cabe en ese horario","error");

        // Revalidar contra la BD (datos frescos) para evitar solapamientos.
        const { data: ncFrescas, error: ncChkErr } = await sb.from("citas")
            .select("hora,duracion_minutos,estado")
            .eq("fecha", fecha)
            .neq("estado", "cancelada");
        if (ncChkErr) return toast("No se pudo verificar la disponibilidad. Inténtalo de nuevo.","error");
        const ncCitasDia = (ncFrescas || []).map(c => ({ ...c, fecha }));
        if (slotBloqueado(horaStr, ncCitasDia, ncTotalDurFinal, fecha)) return toast("Ese horario ya está ocupado o bloqueado","error");

        const estado = document.getElementById("ncEstado").value || "confirmada";


        setBtnLoading("btnGuardarNuevaCita", true);
        try {
            const ncServicioFinal = ncSelectedExtras.length
                ? ncSelectedServicio + " + " + ncSelectedExtras.map(e => e.name).join(" + ")
                : ncSelectedServicio;
            const ncDuracionFinal = ncSelectedDuracion + ncSelectedExtras.reduce((s, e) => s + e.dur, 0);
            const ncPrecioFinal = ncSelectedPrecio + ncSelectedExtras.reduce((s, e) => s + e.precio, 0);
            const result = await guardarCitaSalon(null, {
                cliente_id: ncSelectedClient.id,
                nombre_cliente: ncSelectedClient.nombre,
                telefono: ncSelectedClient.telefono,
                servicio: ncServicioFinal,
                duracion_minutos: ncDuracionFinal,
                precio: ncPrecioFinal,
                fecha,
                hora: horaStr,
                estado
            });
            resultadoSalon(result, 'Cita agendada y tarjeta actualizada');
            cerrarNuevaCita();
            await cargarDatosAdmin();
        } catch(e) {
            toast(e.message || 'No se pudo agendar la cita', 'error');
        } finally {
            setBtnLoading("btnGuardarNuevaCita", false);
        }
    }

    // Listeners del modal nueva cita
    document.addEventListener("DOMContentLoaded", () => {
        const search = document.getElementById("ncClientSearch");
        if (search) search.addEventListener("input", () => ncRenderResults(search.value));
        const fecha = document.getElementById("ncFecha");
        const hora  = document.getElementById("ncHora");
        if (fecha) fecha.addEventListener("change", ncValidarSlot);
        if (hora)  hora.addEventListener("change", ncValidarSlot);

        document.querySelectorAll("#ncEstadoGroup .estado-opt").forEach(b => {
            b.addEventListener("click", () => {
                document.querySelectorAll("#ncEstadoGroup .estado-opt").forEach(x=>x.classList.remove("active"));
                b.classList.add("active");
                document.getElementById("ncEstado").value = b.dataset.estado;
            });
        });

        const modal = document.getElementById("nuevaCitaModal");
        if (modal) modal.addEventListener("click", e => {
            if (e.target.id === "nuevaCitaModal") cerrarNuevaCita();
        });
    });

    // ══════════════════════════════════════════════════════
    //  USUARIOS ADMIN (crear cuentas de acceso al salón)
    // ══════════════════════════════════════════════════════


    // ══════════════════════════════════════════════════════
    //  INIT
    // ══════════════════════════════════════════════════════
    // initPicker se llama al entrar en vistaReservar
    // Check usuario disponible (en vista registro)

    // Initialization is awaited below, after the DOM and service catalog are ready.

    // ══════════════════════════════════════════════════════
    //  WEBGL BACKGROUND (Agua Caribeña)
    // ══════════════════════════════════════════════════════
    (function initBackground() {
    const canvasGL = document.getElementById('gl');
    const gl = canvasGL.getContext('webgl') || canvasGL.getContext('experimental-webgl');
    if (!gl || matchMedia('(prefers-reduced-motion: reduce)').matches) { canvasGL.style.display = 'none'; return; }

    const MAX_RIPPLES = 48;

    const vert = `
    attribute vec2 a_pos;
    void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;

    const frag = `
    precision highp float;
    uniform vec2  u_res;
    uniform float u_time;
    uniform vec2  u_mouse;
    uniform float u_mouseOn;
    uniform vec3  u_ripples[${MAX_RIPPLES}];
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
      for (int k = 0; k < ${MAX_RIPPLES}; k++){
        if (k >= u_rippleCount) break;
        vec3 rp = u_ripples[k];
        vec2 d = fragCoord - rp.xy;
        float dist = length(d);
        float radius = rp.z * 400.0;
        float band = 80.0;
        float falloff = exp(-rp.z * 1.2);
        float ring = exp(-abs(dist - radius) / band) * falloff;
        distort += normalize(d + 0.001) * sin((radius - dist) * 0.06) * ring * 2.5;
        ripWave += ring;
      }

      if (u_mouseOn > 0.5){
        vec2 dm = fragCoord - u_mouse;
        float dist = length(dm);
        float h = exp(-dist / 120.0);
        distort += normalize(dm + 0.001) * h * sin(u_time * 4.0 - dist * 0.08) * 0.6;
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

    function compile(type, src){
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
        console.error(gl.getShaderInfoLog(s));
      }
      return s;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vert));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = {
      res:        gl.getUniformLocation(prog, 'u_res'),
      time:       gl.getUniformLocation(prog, 'u_time'),
      mouse:      gl.getUniformLocation(prog, 'u_mouse'),
      mouseOn:    gl.getUniformLocation(prog, 'u_mouseOn'),
      ripples:    gl.getUniformLocation(prog, 'u_ripples'),
      rippleCount:gl.getUniformLocation(prog, 'u_rippleCount'),
    };

    let DPR = Math.min(window.devicePixelRatio || 1, 2);
    function resizeGL(){
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      canvasGL.width  = canvasGL.clientWidth  * DPR;
      canvasGL.height = canvasGL.clientHeight * DPR;
      gl.viewport(0,0,canvasGL.width,canvasGL.height);
    }
    window.addEventListener('resize', resizeGL);
    resizeGL();

    let bgMouseX = -999, bgMouseY = -999, bgMouseOn = 0, bgLastX = 0, bgLastY = 0;
    const bgRipples = [];

    function addRipple(x, y){
      bgRipples.push({ x, y, born: performance.now() });
      if (bgRipples.length > MAX_RIPPLES) bgRipples.shift();
    }

    window.addEventListener('mousemove', e=>{
      const r = canvasGL.getBoundingClientRect();
      bgMouseX = (e.clientX - r.left) * DPR;
      bgMouseY = (r.height - (e.clientY - r.top)) * DPR;
      bgMouseOn = 1;
      if (Math.hypot(bgMouseX-bgLastX, bgMouseY-bgLastY) > 25*DPR){
        addRipple(bgMouseX, bgMouseY);
        bgLastX = bgMouseX; bgLastY = bgMouseY;
      }
    });
    window.addEventListener('mouseleave', ()=> bgMouseOn = 0);
    window.addEventListener('click', e=>{
      const r = canvasGL.getBoundingClientRect();
      addRipple((e.clientX-r.left)*DPR, (r.height-(e.clientY-r.top))*DPR);
    });
    window.addEventListener('touchmove', e=>{
      const r = canvasGL.getBoundingClientRect();
      const t = e.touches[0];
      bgMouseX = (t.clientX - r.left) * DPR;
      bgMouseY = (r.height - (t.clientY - r.top)) * DPR;
      bgMouseOn = 1;
      if (Math.hypot(bgMouseX-bgLastX, bgMouseY-bgLastY) > 25*DPR){
        addRipple(bgMouseX, bgMouseY);
        bgLastX = bgMouseX; bgLastY = bgMouseY;
      }
    }, {passive:true});
    window.addEventListener('touchend', ()=> bgMouseOn = 0);

    // El agua es un shader pesado a pantalla completa. En el inicio queda
    // totalmente tapada por el hero y los paneles, y en una pestaña de fondo
    // no se ve: en esos casos paramos el bucle en vez de gastar GPU.
    let aguaEncendida = true, aguaRAF = null;
    window.ajustarAgua = function(encender) {
      if (encender === aguaEncendida) return;
      aguaEncendida = encender;
      if (encender && aguaRAF === null) renderGL();
    };
    document.addEventListener("visibilitychange", () => {
      const enInicio = document.body.classList.contains("en-inicio");
      window.ajustarAgua(!document.hidden && !enInicio);
    });

    const startGL = performance.now();
    function renderGL(){
      if (!aguaEncendida) { aguaRAF = null; return; }
      const now = performance.now();
      const time = (now - startGL) / 3500; // Ralentizado 3.5x para que sea más relajante

      const data = [];
      let count = 0;
      for (let i = bgRipples.length-1; i>=0; i--){
        const age = (now - bgRipples[i].born)/1000;
        if (age > 3.5){ bgRipples.splice(i,1); continue; }
      }
      for (let i=0; i<bgRipples.length && count<MAX_RIPPLES; i++){
        const age = (now - bgRipples[i].born)/1000;
        data.push(bgRipples[i].x, bgRipples[i].y, age);
        count++;
      }
      while (data.length < MAX_RIPPLES*3) data.push(0,0,99);

      gl.uniform2f(U.res, canvasGL.width, canvasGL.height);
      gl.uniform1f(U.time, time);
      gl.uniform2f(U.mouse, bgMouseX, bgMouseY);
      gl.uniform1f(U.mouseOn, bgMouseOn);
      gl.uniform3fv(U.ripples, data);
      gl.uniform1i(U.rippleCount, count);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      aguaRAF = requestAnimationFrame(renderGL);
    }
    if(gl) {
      // el inicio se muestra al cargar y tapa el canvas: arrancamos parados
      aguaEncendida = !document.body.classList.contains("en-inicio");
      if (aguaEncendida) renderGL();
    }

    // ═══════════════════════════════════════════════════════
    //  GESTIÓN DE COOKIES Y TEXTOS LEGALES (RGPD / LSSI-CE)
    // ═══════════════════════════════════════════════════════

    })();

    function checkCookies() {
        const banner = document.getElementById("cookieBanner");
        if (!localStorage.getItem("shanahan_cookies_accepted")) {
            setTimeout(() => { banner.classList.add("show"); }, 1000);
        }
    }

    function aceptarCookies() {
        localStorage.setItem("shanahan_cookies_accepted", "all");
        document.getElementById("cookieBanner").classList.remove("show");
    }

    function rechazarCookies() {
        localStorage.setItem("shanahan_cookies_accepted", "essential");
        document.getElementById("cookieBanner").classList.remove("show");
    }

    const textosLegales = {
        aviso: {
            titulo: "Aviso Legal",
            html: `
                <p>En cumplimiento de la Ley 34/2002, de 11 de julio, de Servicios de la Sociedad de la Información y de Comercio Electrónico (LSSI-CE), se informa que este sitio web es propiedad de <strong>Estudio Shanahan Nails</strong>.</p>
                <h4>1. Datos Identificativos</h4>
                <p>Titular: Estudio Shanahan Nails<br>
                Contacto: Vía WhatsApp (al número indicado en nuestro perfil)<br>
                Actividad: Salón de manicura y estética.</p>
                <h4>2. Condiciones de Uso</h4>
                <p>El acceso y/o uso de este portal atribuye la condición de USUARIO. El usuario asume la responsabilidad del uso del portal y se compromete a hacer un uso adecuado de los contenidos y servicios.</p>
                <h4>3. Propiedad Intelectual e Industrial</h4>
                <p>Todos los derechos de propiedad intelectual del contenido de esta página web y su diseño gráfico, son propiedad exclusiva de Estudio Shanahan Nails.</p>
            `
        },
        privacidad: {
            titulo: "Política de Privacidad",
            html: `
                <p>De conformidad con lo dispuesto en el Reglamento (UE) 2016/679 de 27 de abril de 2016 (RGPD) y la Ley Orgánica 3/2018 (LOPDGDD), te informamos sobre el tratamiento de tus datos personales.</p>
                <h4>1. Responsable del Tratamiento</h4>
                <p>Estudio Shanahan Nails es el Responsable del tratamiento de los datos personales del Usuario.</p>
                <h4>2. Finalidad del Tratamiento</h4>
                <p>Tus datos personales (nombre, teléfono, correo) serán utilizados exclusivamente con la finalidad de: gestionar tus reservas, crear tu cuenta de cliente en nuestra plataforma, y enviarte comunicaciones estrictamente necesarias relacionadas con tus citas.</p>
                <h4>3. Legitimación</h4>
                <p>La base legal para el tratamiento de tus datos es la ejecución de la prestación del servicio (la reserva) y tu consentimiento expreso otorgado al registrarte.</p>
                <h4>4. Conservación y Derechos ARCO</h4>
                <p>Tus datos se conservarán mientras exista un interés mutuo para mantener el fin del tratamiento. Tienes derecho a retirar tu consentimiento en cualquier momento. También puedes ejercer tus derechos de Acceso, Rectificación, Portabilidad y Supresión (derecho al olvido) de tus datos escribiéndonos a nuestro WhatsApp de contacto.</p>
            `
        },
        cookies: {
            titulo: "Política de Cookies",
            html: `
                <p>Una cookie es un pequeño fichero que se almacena en el navegador del usuario al acceder a determinadas páginas web.</p>
                <h4>1. ¿Qué tipo de cookies utiliza esta página web?</h4>
                <p><strong>Cookies Técnicas / Necesarias:</strong> Son aquellas necesarias para la navegación y el buen funcionamiento de la página web. Nos permiten gestionar el inicio de sesión de tu cuenta y recordar tus preferencias básicas como la aceptación de este aviso. (No se pueden desactivar).</p>
                <p><strong>Cookies de Terceros:</strong> Podemos utilizar herramientas externas que depositen cookies con fines analíticos básicos para mejorar el servicio.</p>
                <h4>2. Revocación y eliminación de cookies</h4>
                <p>Puedes permitir, bloquear o eliminar las cookies instaladas en tu equipo mediante la configuración de las opciones del navegador instalado en tu ordenador o dispositivo móvil (Chrome, Safari, Firefox, Edge...).</p>
            `
        }
    };

    function abrirLegal(tipo) {
        document.getElementById('legalModalTitle').innerHTML = textosLegales[tipo].titulo;
        document.getElementById('legalModalBody').innerHTML = textosLegales[tipo].html;
        document.getElementById('legalModal').style.display = 'flex';
    }

    // --- LÓGICA GALERÍA ---
    window.cargarGaleria = async function() {
        try {
            const { data, error } = await sb.storage.from('galeria').list();
            if (error || !data) return;

            const contPub = document.getElementById('galeriaPublica');
            const contAdm = document.getElementById('adminGaleriaGrid');

            let htmlPub = '';
            let htmlAdm = '';

            const files = data.filter(f => f.name !== '.emptyFolderPlaceholder' && f.name !== '.keep' && f.name !== 'perfil.jpg');

            if (files.length === 0) {
                const defaults = [
                    "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&q=80&w=400&h=500",
                    "https://images.unsplash.com/photo-1522337660859-02fbefca4702?auto=format&fit=crop&q=80&w=400&h=500"
                ];
                htmlPub = `<div style="color:var(--muted); font-size:14px; text-align:center; width:100%;">Aún no hay fotos en la galería. Configura el Storage para subir fotos.</div>`;
                htmlAdm = htmlPub;
            } else {
                files.forEach(f => {
                    const { data: { publicUrl } } = sb.storage.from('galeria').getPublicUrl(f.name);

                    htmlPub += `
                        <div class="galeria-item" onclick="abrirFotoZoom(${inlineArg(publicUrl)})">
                            <img src="${escapeHTML(publicUrl)}" alt="Trabajo de manicura — Shanahan Nails" loading="lazy" style="transition:transform 0.6s var(--ease);" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'">
                        </div>
                    `;

                    htmlAdm += `
                        <div style="position:relative; border-radius:12px; overflow:hidden; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                            <img src="${escapeHTML(publicUrl)}" alt="Foto de galería" loading="lazy" style="width:100%; height:150px; object-fit:cover; display:block;">
                            <button onclick="borrarFotoGaleria(${inlineArg(f.name)})" aria-label="Borrar foto" style="position:absolute; top:8px; right:8px; background:rgba(255,0,0,0.8); color:#fff; border:none; width:30px; height:30px; border-radius:50%; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    `;
                });
            }
            if(contPub) {
                contPub.innerHTML = htmlPub;
                // las mismas fotos alimentan las columnas del scroll inmersivo
                if (typeof window.montarColumnasInmersivas === "function") window.montarColumnasInmersivas();
                // y la rejilla de trabajos recuenta sus piezas para revelarlas una a una
                if (typeof window.montarTrabajos === "function") window.montarTrabajos();
            }
            if(contAdm) contAdm.innerHTML = htmlAdm;
        } catch (e) {
            console.error("Error cargando galería:", e);
        }
    }

    window.abrirFotoZoom = function(url) {
        document.getElementById('lightboxImg').src = url;
        document.getElementById('lightboxModal').style.display = 'flex';
    }

    window.subirFotoGaleria = async function(e) {
        const file = e.target.files[0];
        if(!file) return;
        toast("Subiendo foto...", "info");
        const fileExt = file.name.split('.').pop();
        const fileName = `foto_${Date.now()}.${fileExt}`;
        const { error } = await sb.storage.from('galeria').upload(fileName, file);
        if(error) {
            toast("Error al subir: " + error.message, "error");
        } else {
            toast("¡Foto subida con éxito!", "success");
            cargarGaleria();
        }
    }

    window.borrarFotoGaleria = async function(fileName) {
        if(confirm("¿Segura que quieres borrar esta foto?")) {
            const { error } = await sb.storage.from('galeria').remove([fileName]);
            if(error) toast("Error al borrar: " + error.message, "error");
            else {
                toast("Foto borrada", "success");
                cargarGaleria();
            }
        }
    }

    // Inicializar banners al cargar
    document.addEventListener("DOMContentLoaded", async () => {
        checkCookies();
        document.getElementById('footerYear').textContent = new Date().getFullYear();
        cargarVistaResenas();
        cargarGaleria();
        await cargarDisponibles();
        cargarProximosHuecos();
        try { await restaurarSesion(); }
        catch { limpiarSesionLocal(); toast('No se pudo recuperar la sesión. Vuelve a iniciar sesión.', 'error'); }
        await cargarCatServicios(); // Cargar catálogo desde BD primero
        renderPublicServicios();
        if(typeof renderAcordeon === 'function') renderAcordeon();
        if(typeof ncRenderServicios === 'function') ncRenderServicios();
        const view = vistaDesdeURL() || (_adminAutenticada ? 'vistaAdmin' : _clienteLogueado ? 'vistaCliente' : 'login');
        mostrarVista(view, { history: false });
    });

    async function cargarCatServicios() {
        try {
            const { data, error } = await sb.from("servicios").select("*").order("orden_grupo").order("orden_item");
            if(error) { console.error("Error cargando servicios", error); return; }
            if(!data || !data.length) return;

            const mapGroups = Object.create(null);
            data.forEach(s => {
                if(!mapGroups[s.grupo]) {
                    mapGroups[s.grupo] = {
                        grupo: s.grupo,
                        isExtras: s.is_extras_group,
                        orden: s.orden_grupo,
                        items: []
                    };
                }
                mapGroups[s.grupo].items.push({
                    id: s.id,
                    val: s.val,
                    nombre: s.nombre,
                    dur: s.dur,
                    durTxt: s.dur_txt,
                    precio: formatearPrecio(s.precio), // por si en la BD quedo alguno sin €
                    desc: s.descrip,
                    isExtraAddon: s.is_extra_addon
                });
            });

            NC_SERVICIOS = Object.values(mapGroups).sort((a,b) => a.orden - b.orden);
            if(typeof renderAdminServicios === 'function') renderAdminServicios();
            if(typeof renderClientAccordion === 'function') renderClientAccordion();
        } catch(e) {
            console.error("Error fatal servicios", e);
        }
    }

    window.renderPublicServicios = function() {
        const cont = document.getElementById("publicServicioGrid");
        if(!cont) return;
        let html = '';
        const publicGroups = [...NC_SERVICIOS].sort((a, b) => {
            const rank = group => /uña partida/i.test(group.grupo) ? 2 : group.isExtras ? 1 : 0;
            return rank(a) - rank(b);
        });
        publicGroups.forEach(g => {
            if(g.isExtras) {
                html += `<div class="servicio-grupo extras-grupo">
                    <div class="servicio-grupo-titulo" style="color:var(--burgundy);">
                        <i class="fa-solid fa-plus-circle" style="margin-right:4px;"></i>${escapeHTML(g.grupo)}
                    </div>`;
            } else {
                html += `<div class="servicio-grupo">
                    <div class="servicio-grupo-titulo">${escapeHTML(g.grupo)}</div>`;
            }
            g.items.forEach(it => {
                html += `<div style="border-bottom:1px solid rgba(229,218,206,0.3); padding-bottom:12px; margin-bottom:12px;">
                    <div class="servicio-opcion" style="cursor:default; border:none; border-radius:0; margin:0; padding:4px 10px;">
                        <span class="servicio-opcion-nombre">${it.isExtraAddon || g.isExtras ? '<i class="fa-solid fa-plus" style="margin-right:6px;font-size:10px;color:var(--burgundy);"></i>' : ''}${escapeHTML(it.nombre)}</span>
                        <span class="servicio-opcion-precio">${escapeHTML(it.precio)}</span>
                        <span class="servicio-opcion-dur">${escapeHTML(it.durTxt)}</span>
                    </div>
                    ${it.desc ? `<div style="font-size:12px; color:var(--muted); padding:4px 10px; line-height:1.5; text-align:justify;">${escapeHTML(it.desc)}</div>` : ''}
                </div>`;
            });
            html += `</div>`;
        });
        cont.innerHTML = html;
    };

    // --- LÓGICA DE RESEÑAS DE CLIENTAS ---
    const stars = document.querySelectorAll('.star-btn');
    stars.forEach(star => {
        star.addEventListener('click', (e) => {
            const val = parseInt(e.target.getAttribute('data-val'));
            document.getElementById('resenaPuntos').value = val;
            stars.forEach(s => {
                if(parseInt(s.getAttribute('data-val')) <= val) s.style.color = 'var(--gold)';
                else s.style.color = 'var(--line)';
            });
        });
        star.style.color = 'var(--gold)';
    });

    window.abrirModalResena = function() {
        if (typeof _clienteLogueado !== 'undefined' && _clienteLogueado) {
            document.getElementById('modalResena').style.display = 'flex';
        } else {
            toast("Debes iniciar sesión para dejar una reseña", "error");
            mostrarVista('login');
        }
    }

    window.enviarResena = async function() {
        if (!_clienteLogueado) return toast('Inicia sesión para dejar una reseña.', 'error');
        const texto = document.getElementById('resenaTexto').value.trim();
        const puntos = parseInt(document.getElementById('resenaPuntos').value);
        if (!Number.isInteger(puntos) || puntos < 1 || puntos > 5 || texto.length > 2000) return toast('Elige de 1 a 5 estrellas y escribe como máximo 2000 caracteres.', 'error');
        if(!texto) { alert("¡Cuéntanos algo más!"); return; }

        let nombre = "Clienta actual";
        let cliente_id = null;

        if (typeof _clienteLogueado !== 'undefined' && _clienteLogueado) {
            nombre = _clienteLogueado.nombre;
            if (_clienteLogueado.apellidos) nombre += " " + _clienteLogueado.apellidos;
            cliente_id = _clienteLogueado.id;

            // Buscar última cita
            const { data: ultimas } = await sb.from('citas')
                .select('servicio')
                .eq('cliente_id', _clienteLogueado.id)
                .order('fecha', { ascending: false })
                .limit(1);

            if (ultimas && ultimas.length > 0 && ultimas[0].servicio) {
                let serv = ultimas[0].servicio.split(' · ')[1] || ultimas[0].servicio;
                // quitar extras de la cadena si es muy larga, opcional
                serv = serv.split(' + ')[0];
                nombre += ` (Se hizo: ${serv})`;
            }
        }

        const { error } = await sb.from('resenas').insert([{
            cliente_nombre: nombre,
            cliente_id: cliente_id,
            puntuacion: puntos,
            comentario: texto,
            destacada: true
        }]);

        if (error) {
            alert("Error: " + error.message);
        } else {
            document.getElementById('modalResena').style.display = 'none';
            alert("¡Muchas gracias por tu reseña! Significa el mundo para nosotras.");
        }
    }

    // --- Cargar reseñas en la página de Reseñas ---
    window.cargarVistaResenas = async function() {
        const { data, error } = await sb.from('resenas').select('*').eq('destacada', true).order('fecha_creacion', { ascending: false });
        if (error || !data || data.length === 0) {
            const container = document.getElementById('resenasGridPage');
            if (container) container.textContent = error ? 'No se pudieron cargar las reseñas. Inténtalo de nuevo.' : 'Todavía no hay reseñas publicadas.';
            return;
        }

        const container = document.getElementById('resenasGridPage');
        if (!container) return;

        container.innerHTML = data.map(SalonCore.reviewCard).join('');
    }


    window.cargarResenas = async function() {
        const tb = document.getElementById('tablaResenas');
        const { data } = await checked(sb.from('resenas').select('*').order('fecha_creacion', { ascending: false }));
        if(!data || data.length === 0) { tb.innerHTML = '<tr><td colspan="3" class="tl-empty">Sin reseñas</td></tr>'; return; }

        let html = '';
        data.forEach(r => {
            const isDestacada = r.destacada;
            html += `<tr>
                <td>
                    <div style="font-weight:600;">${escapeHTML(r.cliente_nombre)} <span style="color:var(--gold); font-size:10px;">${Math.max(0, Math.min(5, Number(r.puntuacion) || 0))} <i class="fa-solid fa-star"></i></span></div>
                    <div style="font-size:11px; color:var(--muted); font-style:italic;">"${escapeHTML(r.comentario)}"</div>
                </td>
                <td style="font-size:10px; font-weight:600;">
                    ${isDestacada ? '<span style="color:var(--gold);"><i class="fa-solid fa-star"></i> PÚBLICA</span>' : '<span style="color:var(--line);">Oculta</span>'}
                </td>
                <td>
                    <button class="tl-btn edit" data-review-id="${escapeHTML(r.id)}" data-review-action="toggle" data-review-visible="${!isDestacada}" title="Mostrar/Ocultar"><i class="${isDestacada ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'}"></i></button>
                    <button class="tl-btn del" data-review-id="${escapeHTML(r.id)}" data-review-action="delete" title="Borrar"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
        });
        tb.innerHTML = html;
    }

    document.getElementById('tablaResenas').addEventListener('click', event => {
        const button = event.target.closest('button[data-review-id]');
        if (!button) return;
        const task = button.dataset.reviewAction === 'toggle'
            ? toggleResena(button.dataset.reviewId, button.dataset.reviewVisible === 'true')
            : borrarResena(button.dataset.reviewId);
        Promise.resolve(task).catch(() => toast('No se pudo guardar el cambio de la reseña.', 'error'));
    });
    window.toggleResena = async function(id, state) {
        await checked(sb.from('resenas').update({destacada: state}).eq('id', id).select('id').single());
        await cargarResenas(); await cargarVistaResenas();
    }
    window.borrarResena = async function(id) {
        if(confirm("¿Segura que quieres borrar esta reseña?")) {
            await checked(sb.from('resenas').delete().eq('id', id).select('id').single());
            await cargarResenas(); await cargarVistaResenas();
        }
    }
