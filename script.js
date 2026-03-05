// Constantes
const STATION_ID = "1210762";
const API_URL = "https://api.ipma.pt/open-data/observation/meteorology/stations/observations.json";

// Função para buscar dados
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

// Função ETo simplificada
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

// Função principal
async function calcular() {
    const smax = parseFloat(document.getElementById('smax').value);
    const s0 = parseFloat(document.getElementById('s0').value);

    const dados = await fetchObservations();
    if (dados.length === 0) {
        document.getElementById('resultadoContainer').innerHTML = '⚠️ Sem dados para as últimas 24h';
        return;
    }

    // Calcular totais
    let precipTotal = 0;
    let etoTotal = 0;

    dados.forEach(d => {
        precipTotal += d.precip_mm;

        if (!isNaN(d.temp_c) && !isNaN(d.rh_percent) && !isNaN(d.wind_ms) && !isNaN(d.rad_kJm2)) {
            const eto = hourlyEto(d.temp_c, d.rh_percent, d.wind_ms, d.press_hPa, d.rad_kJm2);
            etoTotal += eto;
        }
    });

    // Balanço hídrico
    let S = s0 + precipTotal;
    if (S > smax) {
        S = smax;  // ignora escoamento, só interessa armazenamento
    }
    let eta = Math.min(etoTotal, S);
    let Sfinal = S - eta;
    if (Sfinal < 0) Sfinal = 0;

    const variacao = Sfinal - s0;  // pode ser negativa

    // Elemento onde vamos mostrar a mensagem
    const container = document.getElementById('resultadoContainer');
    container.className = 'resultado';  // remove classes anteriores

    if (variacao < -0.5) {
        // Necessário regar
        const aguaNecessaria = Math.abs(variacao).toFixed(1);
        container.classList.add('vermelho');
        container.innerHTML = `💧 <strong>Deve regar!</strong><br>Faltam aproximadamente ${aguaNecessaria} mm no solo.`;
    } else {
        // Não precisa regar
        container.classList.add('verde');
        container.innerHTML = `✅ <strong>Não precisa de regar hoje.</strong><br>O solo tem humidade suficiente.`;
    }
}

// Chamar automaticamente ao carregar a página
window.onload = calcular;
