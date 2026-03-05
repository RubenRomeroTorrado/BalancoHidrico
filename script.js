// Constantes
const STATION_ID = "1210762";
const API_URL = "https://api.ipma.pt/open-data/observation/meteorology/stations/observations.json";

// Função para buscar dados
async function fetchObservations() {
    const resp = await fetch(API_URL);
    const data = await resp.json();

    // A estrutura é { timestamp: { idEstacao: dados, ... } }
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

    // Filtrar últimas 24h (considerando hora local de Lisboa)
    const agora = new Date();
    const limite = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
    
    return registos
        .map(r => ({ ...r, timestamp: new Date(r.timestamp + ':00') })) // converter para Date
        .filter(r => r.timestamp >= limite)
        .sort((a, b) => a.timestamp - b.timestamp);
}

// Função ETo em JavaScript
function hourlyEto(temp_c, rh_percent, wind_ms_10m, press_hPa, rad_kJm2) {
    // Se pressão inválida, usar 1013
    if (isNaN(press_hPa) || press_hPa === -99) press_hPa = 1013;

    const rad_MJ = rad_kJm2 / 1000;
    const Rn = 0.77 * rad_MJ;
    const u2 = wind_ms_10m * (4.87 / Math.log(67.8 * 10 - 5.42));
    const P = press_hPa / 10;
    
    // Pressão de vapor
    const es = 0.6108 * Math.exp(17.27 * temp_c / (temp_c + 237.3));
    const ea = es * (rh_percent / 100);
    
    const delta = 4098 * es / ((temp_c + 237.3) ** 2);
    const gamma = 0.000665 * P;
    
    const termoRad = 0.408 * delta * Rn / (delta + gamma * (1 + 0.34 * u2));
    const termoAero = gamma * (37 / (temp_c + 273)) * u2 * (es - ea) / (delta + gamma * (1 + 0.34 * u2));
    
    return Math.max(termoRad + termoAero, 0);
}

// Função principal (chamada pelo botão)
async function calcular() {
    const smax = parseFloat(document.getElementById('smax').value);
    const s0 = parseFloat(document.getElementById('s0').value);

    const dados = await fetchObservations();
    if (dados.length === 0) {
        alert('Sem dados para as últimas 24h');
        return;
    }

    // Calcular ETo para cada hora
    let precipTotal = 0;
    let etoTotal = 0;
    const horas = [];

    dados.forEach(d => {
        precipTotal += d.precip_mm;
        horas.push({
            timestamp: d.timestamp,
            precip: d.precip_mm,
            temp: d.temp_c,
            rh: d.rh_percent,
            eto: 0
        });

        // Calcular ETo se tiver todas as variáveis
        if (!isNaN(d.temp_c) && !isNaN(d.rh_percent) && !isNaN(d.wind_ms) && !isNaN(d.rad_kJm2)) {
            const eto = hourlyEto(d.temp_c, d.rh_percent, d.wind_ms, d.press_hPa, d.rad_kJm2);
            d.eto = eto;
            etoTotal += eto;
            horas[horas.length-1].eto = eto;
        }
    });

    // Balanço hídrico
    let S = s0 + precipTotal;
    let runoff = 0;
    if (S > smax) {
        runoff = S - smax;
        S = smax;
    }
    let eta = Math.min(etoTotal, S);
    let Sfinal = S - eta;
    if (Sfinal < 0) {
        Sfinal = 0;
        eta = S;
    }

    // Atualizar resultados no HTML
    document.getElementById('precip').innerText = precipTotal.toFixed(1);
    document.getElementById('eto').innerText = etoTotal.toFixed(1);
    document.getElementById('eta').innerText = eta.toFixed(1);
    document.getElementById('runoff').innerText = runoff.toFixed(1);
    document.getElementById('armFinal').innerText = Sfinal.toFixed(1);
    document.getElementById('variacao').innerText = (Sfinal - s0).toFixed(1);

    // Desenhar gráficos (usando Chart.js)
    desenharGraficos(horas);
}

// Gráficos com Chart.js (precisas de incluir a biblioteca no HTML)
function desenharGraficos(horas) {
    const labels = horas.map(h => h.timestamp.toLocaleTimeString('pt-PT', {hour: '2-digit', minute:'2-digit'}));
    const precipData = horas.map(h => h.precip);
    const tempData = horas.map(h => h.temp);
    const rhData = horas.map(h => h.rh);
    const etoData = horas.map(h => h.eto);

    // Gráfico de precipitação
    new Chart(document.getElementById('graficoPrecip'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Precipitação (mm)',
                data: precipData,
                backgroundColor: 'blue'
            }]
        }
    });

    // Gráfico temperatura + humidade (eixo duplo)
    new Chart(document.getElementById('graficoTempHum'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Temperatura (°C)', data: tempData, borderColor: 'red', yAxisID: 'y' },
                { label: 'Humidade (%)', data: rhData, borderColor: 'green', yAxisID: 'y1' }
            ]
        },
        options: {
            scales: {
                y: { type: 'linear', position: 'left' },
                y1: { type: 'linear', position: 'right', min: 0, max: 100 }
            }
        }
    });

    // Gráfico ETo
    new Chart(document.getElementById('graficoETo'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'ETo (mm)',
                data: etoData,
                backgroundColor: 'orange'
            }]
        }
    });
}

// Chamar automaticamente ao carregar a página
window.onload = calcular;
