/* Editor del salón. Las autorizaciones se comprueban también en Supabase. */
let horarioBorrador = null, horarioBase = null;
const horarioDias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
function renderHorarioEditor(reset = true) {
    const host = document.getElementById('horarioEditor');
    if (!host || !_adminAutenticada) return;
    if (reset || !horarioBorrador) {
        horarioBase = structuredClone(horarioSalon);
        horarioBorrador = structuredClone(horarioSalon);
    }
    function row(key, title, ranges, special = false) {
        return `<div class="schedule-day" data-schedule-key="${key}">
            <div class="schedule-day-title"><strong>${title}</strong>${special ? `<button type="button" class="btn-ghost" onclick="quitarFechaHorario('${key}')">Usar semana habitual</button>` : ''}</div>
            <div class="schedule-ranges">${ranges.length ? ranges.map(([start,end],i) => `<div class="schedule-range">
                <label>Desde<input type="time" step="60" aria-label="${title}, inicio ${i+1}" value="${SalonCore.timeLabel(start)}" data-start></label>
                <label>Hasta<input type="text" placeholder="18:00" pattern="[0-9]{2}:[0-9]{2}" aria-label="${title}, fin ${i+1}" value="${SalonCore.timeLabel(end)}" data-end></label>
                <button type="button" class="btn-ghost" aria-label="Quitar tramo ${i+1} de ${title}" onclick="quitarTramoHorario('${key}',${i})">Quitar</button>
            </div>`).join('') : '<span class="schedule-closed">Cerrado para reservas online</span>'}</div>
            <button type="button" class="btn-ghost" onclick="anadirTramoHorario('${key}')">+ Añadir tramo</button></div>`;
    }
    host.innerHTML = `<h5>Horario de reservas</h5>
        <p>Configura cada día, con jornada continua o varios tramos. Quita todos los tramos para cerrar ese día. Las citas existentes se conservan.</p>
        <p class="schedule-status" role="status">${horarioInstalado ? 'Las clientas verán estos horarios al reservar.' : 'Pendiente de activar la actualización de horarios en Supabase.'}</p>
        <label class="schedule-step">Ofrecer horas cada <select id="horarioPaso">${[5,10,15,20,30,60].map(n=>`<option value="${n}" ${n===horarioBorrador.paso?'selected':''}>${n} minutos</option>`).join('')}</select></label>
        ${[1,2,3,4,5,6,0].map(d=>row(String(d),horarioDias[d],horarioBorrador.semana[d])).join('')}
        <h6>Fechas con horario especial</h6><p>Una fecha especial sustituye el horario semanal de ese día. Los bloqueos de agenda siguen teniendo prioridad para las clientas.</p>
        ${Object.entries(horarioBorrador.excepciones).sort(([a],[b])=>a.localeCompare(b)).map(([date,ranges])=>row(date,date.split('-').reverse().join('/'),ranges,true)).join('')}
        <div class="schedule-add-date"><label>Fecha especial<input type="date" id="horarioNuevaFecha"></label><button type="button" class="btn-ghost" onclick="anadirFechaHorario()">Añadir fecha</button></div>
        <p>Usa el formato 09:00. Para cerrar a medianoche, escribe 24:00 en «Hasta». Cada tramo debe terminar después de empezar.</p>
        <button type="button" class="btn-luxury" id="guardarHorarioBtn" onclick="guardarHorarioSalon()" ${horarioInstalado?'':'disabled'}><span>Guardar horarios</span><span class="spinner"></span></button>`;
}
function recogerHorarioEditor() {
    if (!horarioBorrador) return;
    horarioBorrador.paso = Number(document.getElementById('horarioPaso').value);
    document.querySelectorAll('[data-schedule-key]').forEach(row => {
        const ranges = [...row.querySelectorAll('.schedule-range')].map(el=>[
            SalonCore.minutes(el.querySelector('[data-start]').value),
            el.querySelector('[data-end]').value.trim()==='24:00' ? 1440 : SalonCore.minutes(el.querySelector('[data-end]').value.trim())
        ]);
        const key = row.dataset.scheduleKey;
        if (key.length===1) horarioBorrador.semana[Number(key)] = ranges;
        else horarioBorrador.excepciones[key] = ranges;
    });
}
function rangosBorrador(key) { return key.length===1 ? horarioBorrador.semana[Number(key)] : horarioBorrador.excepciones[key]; }
function anadirTramoHorario(key) {
    recogerHorarioEditor();
    const ranges = rangosBorrador(key);
    if (ranges.length>=12) return toast('Máximo 12 tramos por día.', 'error');
    const start = ranges.length ? ranges[ranges.length-1][1] : 540;
    if (!Number.isFinite(start) || start>=1440) return toast('Revisa el último tramo antes de añadir otro.', 'error');
    ranges.push([start,Math.min(1440,start+60)]); renderHorarioEditor(false);
}
function quitarTramoHorario(key,i) { recogerHorarioEditor(); rangosBorrador(key).splice(i,1); renderHorarioEditor(false); }
function quitarFechaHorario(key) { recogerHorarioEditor(); delete horarioBorrador.excepciones[key]; renderHorarioEditor(false); }
function anadirFechaHorario() {
    const date = document.getElementById('horarioNuevaFecha').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('Elige una fecha.', 'error');
    recogerHorarioEditor();
    if (!horarioBorrador.excepciones[date]) horarioBorrador.excepciones[date] = structuredClone(horarioBorrador.semana[new Date(date+'T12:00:00').getDay()]);
    renderHorarioEditor(false);
}
async function guardarHorarioSalon() {
    if (!_adminAutenticada || !horarioInstalado) return;
    recogerHorarioEditor();
    if (!SalonCore.validSchedule(horarioBorrador)) return toast('Revisa las horas: tramos ordenados, sin cruces y con fin posterior al inicio (máximo 24:00).', 'error');
    setBtnLoading('guardarHorarioBtn',true);
    try {
        await checked(sb.rpc('salon_guardar_horario',{p_horario:horarioBorrador,p_anterior:horarioBase}));
        if (!await cargarDisponibles()) {
            toast('Horario guardado, pero no se pudo actualizar la agenda. Recarga la página.', 'error');
            return;
        }
        renderHorarioEditor(); renderAgendaDay(); renderHorasSlots(); cargarProximosHuecos();
        toast('Horario guardado. Las citas existentes se mantienen.', 'success');
    } catch(e) { toast(e.message || 'No se pudo guardar el horario.', 'error'); }
    finally { setBtnLoading('guardarHorarioBtn',false); }
}
