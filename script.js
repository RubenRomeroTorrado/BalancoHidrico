// Constantes
const STATION_ID = "1210762";
const API_URL = "https://api.ipma.pt/open-data/observation/meteorology/stations/observations.json";

// Definición de cultivos con sus funciones de Kc
const cultivos = {
    morangueiro: {
        nombre: "Morangueiro",
        calcularKc: function(dias) {
            if (dias < 0) return 0.40;
            if (dias <= 35) return 0.40;
            if (dias <= 80) {
                const progresso = (dias - 35) / (80 - 35);
                return 0.40 + progresso * (0.85 - 0.40);
            }
            if (dias <= 220) return 0.85;
            if (dias <= 250) {
                const progresso = (dias - 220) / (250 - 220);
                return 0.85 - progresso * (0.85 - 0.75);
            }
            return 0.75;
        }
    },
    rucula: {
        nombre: "Rúcula",
        calcularKc: function(dias) {
            // Ficticio: fases más rápidas
            if (dias < 0) return 0.5;
            if (dias <= 15) return 0.5;
            if (dias <= 30) {
                const progresso = (dias - 15) / (30 - 15);
                return 0.5 + progresso * (0.9 - 0.5);
            }
            if (dias <= 50) return 0.9;
            if (dias <= 65) {
                const progresso = (dias - 50) / (65 - 50);
                return 0.9 - progresso * (0.9 - 0.7);
            }
            return 0.7;
        }
    }
};

// Función para buscar datos de la API
async function fetchObservations() {
    const resp = await fetch(API_URL);
    const data = await resp.json();

    const registos = [];
    for (const [timestamp, estacoes] of Object.entries(data)) {
        if (estacoes[STATION_ID] && estacoes[STATION_ID] !== null) {
            const obs = estacoes[STATION_ID];
            registos.push({
                timestamp: timestamp,
                precip_mm: obs.precAcumulada === -99 ? 0 : (obs.precAcumulada || 0),
                temp_c: obs.temperatura === -99 ? NaN : obs.temperatura,
                rh_percent: obs.humidade === -99 ? NaN : obs.humidade,
                wind_ms: obs.intensidadeVento === -99 ? NaN : obs.intensidadeVento,
                rad_kJm2: obs.radiacao === -99 ? NaN : obs.radiacao,
                press_hPa: obs.pressao === -99 ? NaN : obs.pressao
            });
        }
    }

    // Filtrar últimas 24h (hora local de Lisboa)
    const agora = new Date();
    const limite = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
    
    return registos
        .map(r => ({ ...r, timestamp: new Date(r.timestamp + ':00') }))
        .filter(r => r.timestamp >= limite)
        .sort((a, b) => a.timestamp - b.timestamp);
}

// Función ETo simplificada
function hourlyEto(temp_c, rh_percent, wind_ms_10m, press_hPa, rad_kJm2) {
    if (isNaN(press_hPa) || press_hPa === -99) press_hPa = 1013;

    const rad_MJ = rad_kJm2 / 1000;
    const Rn = 0.77 * rad_MJ;
    const u2 = wind_ms_10m * (4.87 / Math.log(67.8 * 10 - 5.42));
    const P = press_hPa / 10;
    
    const es = 0.6108 * Math.exp(17.27 * temp_c / (temp_c + 237.3));
    const ea = es * (rh_percent / 100);
    
    const delta = 4098 * es / ((temp_c + 237.3) ** 2);
    const gamma = 0.000665 * P;
    
    const termoRad = 0.408 * delta * Rn / (delta + gamma * (1 + 0.34 * u2));
    const termoAero = gamma * (37 / (temp_c + 273)) * u2 * (es - ea) / (delta + gamma * (1 + 0.34 * u2));
    
    return Math.max(termoRad + termoAero, 0);
}

// Función principal
async function calcular() {
    // Obtener cultivo seleccionado
    const cultivoSelect = document.getElementById('cultivoSelect').value;
    const cultivo = cultivos[cultivoSelect];
    if (!cultivo) {
        alert('Cultivo no válido');
        return;
    }

    // Obtener fecha de plantación
    const dataPlantacaoStr = document.getElementById('dataPlantacao').value;
    if (!dataPlantacaoStr) {
        alert('Por favor, introduce la fecha de plantación.');
        return;
    }
    const dataPlantacao = new Date(dataPlantacaoStr);
    const hoje = new Date();
    const diffTempo = hoje - dataPlantacao;
    const diasDesdePlantacao = Math.floor(diffTempo / (1000 * 60 * 60 * 24));

    const smax = parseFloat(document.getElementById('smax').value);
    const s0 = parseFloat(document.getElementById('s0').value);

    const dados = await fetchObservations();
    if (dados.length === 0) {
        alert('No hay datos para las últimas 24h');
        return;
    }

    // Calcular totales de precipitación y ETo
    let precipTotal = 0;
    let etoTotal = 0;

    dados.forEach(d => {
        precipTotal += d.precip_mm;

        if (!isNaN(d.temp_c) && !isNaN(d.rh_percent) && !isNaN(d.wind_ms) && !isNaN(d.rad_kJm2)) {
            const eto = hourlyEto(d.temp_c, d.rh_percent, d.wind_ms, d.press_hPa, d.rad_kJm2);
            etoTotal += eto;
        }
    });

    // Calcular Kc según el cultivo
    const kc = cultivo.calcularKc(diasDesdePlantacao);
    const etcTotal = etoTotal * kc;

    // Balance hídrico considerando ETc
    let S = s0 + precipTotal;
    if (S > smax) {
        S = smax;  // ignoramos escorrentía para simplificar
    }
    let eta = Math.min(etcTotal, S);
    let Sfinal = S - eta;
    if (Sfinal < 0) Sfinal = 0;

    const variacao = Sfinal - s0;

    // Actualizar elementos en la página
    document.getElementById('precip').innerText = precipTotal.toFixed(1) + ' mm';
    document.getElementById('eto').innerText = etoTotal.toFixed(1) + ' mm';
    document.getElementById('kc').innerHTML = `${kc.toFixed(2)} <span class="kc-badge">${cultivo.nombre} · ${diasDesdePlantacao} días</span>`;
    document.getElementById('etc').innerText = etcTotal.toFixed(1) + ' mm';
    document.getElementById('variacao').innerText = variacao.toFixed(1) + ' mm';

    // Mostrar contenedor de resultados
    document.getElementById('resultadosContainer').style.display = 'block';

    // Mensaje de recomendación
    const recomendacaoDiv = document.getElementById('recomendacao');
    recomendacaoDiv.className = 'recomendacao';  // limpia clases

    if (variacao < -0.5) {
        const aguaNecesaria = Math.abs(variacao).toFixed(1);
        recomendacaoDiv.classList.add('vermelho');
        recomendacaoDiv.innerHTML = `💧 <strong>¡Debe regar!</strong><br>Faltan aproximadamente ${aguaNecesaria} mm en el suelo.`;
    } else {
        recomendacaoDiv.classList.add('verde');
        recomendacaoDiv.innerHTML = `✅ <strong>No necesita regar hoy.</strong><br>El suelo tiene humedad suficiente.`;
    }
}

// Al cargar la página, establecer una fecha por defecto (30 días atrás) y calcular automáticamente
window.onload = function() {
    const hoje = new Date();
    const trintaDiasAtras = new Date(hoje);
    trintaDiasAtras.setDate(hoje.getDate() - 30);
    document.getElementById('dataPlantacao').value = trintaDiasAtras.toISOString().split('T')[0];
    
    // Calcular automáticamente (opcional)
    calcular();
};
