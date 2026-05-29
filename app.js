document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map').setView([-23.55052, -46.633309], 12); // Centered in São Paulo, Brazil

    // Base Layers
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map); // Default to OpenStreetMap to avoid blockages from AdBlockers on CartoDB domain

    const darkMatterLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    });

    const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    });

    const baseMaps = {
        "Mapa de Ruas": osmLayer,
        "Modo Escuro": darkMatterLayer,
        "Satélite": esriSatellite
    };

    L.control.layers(baseMaps).addTo(map);

    // Force map to recalculate container bounds to fix gray map rendering issue
    setTimeout(() => {
        map.invalidateSize();
    }, 250);

    // Log tile errors in console for troubleshooting network issues
    const logTileError = (e) => {
        console.warn('Erro ao carregar bloco (tile) de mapa:', e.coords, 'URL:', e.tile.src);
    };
    osmLayer.on('tileerror', logTileError);
    darkMatterLayer.on('tileerror', logTileError);
    esriSatellite.on('tileerror', logTileError);

    const inputsContainer = document.getElementById('inputs-container');
    const addStopButton = document.getElementById('add-stop');
    const calculateRouteButton = document.getElementById('calculate-route');
    const routeDetails = document.getElementById('route-details');
    const totalDistanceSpan = document.getElementById('total-distance');
    const totalTimeSpan = document.getElementById('total-time');
    const turnByTurnInstructionsDiv = document.getElementById('turn-by-turn-instructions');

    let stopCounter = 0;
    const waypoints = [];
    const markers = [];
    let routingControl = null;

    const userAgent = 'MeuAppDeRotasEscolar/1.0';

    // ---- safeFetch: tenta direto e cai em proxies CORS públicos em caso de falha ----
    // Usado para contornar bloqueios de CORS (especialmente ao abrir index.html via file://)
    const CORS_PROXIES = [
        (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        (url) => `https://thingproxy.freeboard.io/fetch/${url}`
    ];

    async function safeFetch(url, options = {}) {
        // 1) tentativa direta
        try {
            const res = await fetch(url, options);
            if (res.ok) return res;
            throw new Error(`HTTP ${res.status}`);
        } catch (directErr) {
            console.warn(`Falha direta em ${url} (${directErr.message}). Tentando proxies CORS...`);
        }
        // 2) tenta cada proxy CORS em ordem
        for (const buildProxyUrl of CORS_PROXIES) {
            try {
                const proxied = buildProxyUrl(url);
                const res = await fetch(proxied, options);
                if (res.ok) {
                    console.log(`Sucesso via proxy: ${proxied}`);
                    return res;
                }
            } catch (proxyErr) {
                console.warn('Proxy falhou:', proxyErr.message);
            }
        }
        throw new Error(`Todas as tentativas (direta + ${CORS_PROXIES.length} proxies) falharam para ${url}`);
    }

    // ---- Router OSRM com fallback CORS ----
    // O LRM usa um XHR interno (corslite) que pode ser bloqueado por CORS.
    // Sobrescrevemos route() para usar safeFetch e reaproveitamos _routeDone do OSRMv1.
    const SafeOSRMv1 = L.Routing.OSRMv1.extend({
        route: function(waypoints, callback, context, options) {
            const url = this.buildRouteUrl(waypoints, L.extend({}, this.options.routingOptions, options));
            safeFetch(url)
                .then(res => res.text())
                .then(text => {
                    const fakeResp = { status: 200, statusCode: 200, responseText: text };
                    this._routeDone(fakeResp, waypoints, options, callback, context);
                })
                .catch(err => {
                    callback.call(context || callback, {
                        status: -1,
                        message: `Erro de rede/CORS no roteamento: ${err.message || err}`
                    });
                });
        }
    });

    // Custom Icons
    const startIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    const endIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    const stopIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    // Debounce function
    const debounce = (func, delay) => {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    };

    // ViaCEP API for CEP lookup
    async function fetchAddressFromCEP(cep) {
        const cleanCep = String(cep).replace(/\D/g, '');
        if (cleanCep.length !== 8) return null;
        try {
            const response = await safeFetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
            const data = await response.json();
            if (data && !data.erro) {
                // Build address from non-empty parts only — CEPs gerais não têm logradouro/bairro
                const parts = [data.logradouro, data.bairro, data.localidade].filter(p => p && p.trim());
                const base = parts.join(', ');
                return data.uf ? `${base} - ${data.uf}` : base;
            }
        } catch (error) {
            console.error('Erro ao buscar CEP:', error);
        }
        return null;
    }

    // Funções de feedback de erro visual nos inputs
    function showError(inputElement, message) {
        const inputGroup = inputElement.closest('.input-group');
        if (inputGroup) {
            inputGroup.classList.add('has-error');
            let errorDiv = inputGroup.querySelector('.error-message');
            if (!errorDiv) {
                errorDiv = document.createElement('div');
                errorDiv.classList.add('error-message');
                inputGroup.appendChild(errorDiv);
            }
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }
    }

    function clearErrors() {
        document.querySelectorAll('.input-group').forEach(group => {
            group.classList.remove('has-error');
            const errorDiv = group.querySelector('.error-message');
            if (errorDiv) {
                errorDiv.style.display = 'none';
                errorDiv.textContent = '';
            }
        });
    }

    // OSM Nominatim API para Geocodificação com fallbacks robustos
    async function geocodeAddress(address) {
        const parts = address.split(',').map(p => p.trim()).filter(Boolean);
        const attempts = [address]; // Tentativa 1: Endereço completo

        // Se o endereço veio estruturado do ViaCEP (geralmente tem 3 partes: Rua, Bairro, Cidade - Estado)
        if (parts.length >= 3) {
            const logradouro = parts[0];
            const cidadeEstado = parts[2];
            // Tentativa 2: Rua + Cidade + Estado (remove o Bairro, que frequentemente gera falha de geocodificação no OSM)
            attempts.push(`${logradouro}, ${cidadeEstado}`);
            // Tentativa 3: Apenas Rua + Cidade
            const cidadeApenas = cidadeEstado.split('-')[0].trim();
            attempts.push(`${logradouro}, ${cidadeApenas}`);
        }

        // Se tiver apenas número no endereço, tenta remover o número e buscar pela rua
        const logradouroParte = parts[0] || '';
        const matchNumber = logradouroParte.match(/(.*?)\s*,\s*\d+$/) || logradouroParte.match(/(.*?)\s+\d+$/);
        if (matchNumber && matchNumber[1]) {
            const ruaSemNumero = matchNumber[1];
            attempts.push(`${ruaSemNumero}, ${parts.slice(1).join(', ')}`);
            if (parts.length >= 3) {
                attempts.push(`${ruaSemNumero}, ${parts[2]}`);
            }
        }

        // Tenta por fim apenas a Cidade + Estado (ou último componente disponível)
        if (parts.length >= 3) {
            attempts.push(parts[2]);
        } else if (parts.length >= 2) {
            attempts.push(parts[1]);
        } else if (parts.length === 1) {
            attempts.push(parts[0]);
        }

        // Filtra tentativas únicas e não vazias (e remove vírgulas soltas no começo/fim)
        const uniqueAttempts = [...new Set(
            attempts
                .map(a => (a || '').replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s*,\s*,+/g, ', '))
                .filter(a => a.length > 2)
        )];

        for (const attempt of uniqueAttempts) {
            try {
                // Sem cabeçalho User-Agent proibido para evitar bloqueios de segurança do navegador
                const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(attempt)}&limit=1`;
                const response = await safeFetch(url);
                const data = await response.json();
                if (data.length > 0) {
                    const latlng = L.latLng(data[0].lat, data[0].lon);
                    console.log(`Geocodificação bem-sucedida para '${attempt}':`, latlng);
                    return latlng;
                }
            } catch (error) {
                console.error(`Erro ao geocodificar o endereço '${attempt}':`, error);
            }
        }
        
        console.warn(`Não foi possível geocodificar o endereço após fallbacks: ${address}`);
        return null;
    }

    // Autocomplete com busca via Nominatim
    const handleAutocomplete = debounce(async (inputElement, autocompleteDiv) => {
        const query = inputElement.value.trim();
        autocompleteDiv.innerHTML = '';
        if (query.length < 3) {
            return;
        }

        // Verifica CEP
        const cepMatch = query.match(/^\d{5}-?\d{3}$/);
        if (cepMatch) {
            const addressFromCep = await fetchAddressFromCEP(cepMatch[0]);
            if (addressFromCep) {
                const div = document.createElement('div');
                div.textContent = `CEP: ${cepMatch[0]} - ${addressFromCep}`;
                div.addEventListener('click', () => {
                    inputElement.value = addressFromCep;
                    autocompleteDiv.innerHTML = '';
                    // Remove estado de erro se selecionado CEP válido
                    const inputGroup = inputElement.closest('.input-group');
                    if (inputGroup) inputGroup.classList.remove('has-error');
                });
                autocompleteDiv.appendChild(div);
                return;
            }
        }

        try {
            // Sem cabeçalho User-Agent proibido
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;
            const response = await safeFetch(url);
            const data = await response.json();

            data.forEach(result => {
                const div = document.createElement('div');
                div.textContent = result.display_name;
                div.addEventListener('click', () => {
                    inputElement.value = result.display_name;
                    autocompleteDiv.innerHTML = '';
                    const inputGroup = inputElement.closest('.input-group');
                    if (inputGroup) inputGroup.classList.remove('has-error');
                });
                autocompleteDiv.appendChild(div);
            });
        } catch (error) {
            console.error('Erro no autocomplete:', error);
        }
    }, 400);

    // Event listeners para autocomplete e limpeza de erro ao digitar
    inputsContainer.addEventListener('input', (event) => {
        if (event.target.tagName === 'INPUT' && event.target.id.includes('-input')) {
            const inputGroup = event.target.closest('.input-group');
            if (inputGroup) {
                inputGroup.classList.remove('has-error');
                const errorDiv = inputGroup.querySelector('.error-message');
                if (errorDiv) {
                    errorDiv.style.display = 'none';
                }
            }
            const autocompleteDivId = event.target.id.replace('-input', '-autocomplete');
            const autocompleteDiv = document.getElementById(autocompleteDivId);
            handleAutocomplete(event.target, autocompleteDiv);
        }
    });

    // Fecha autocomplete ao clicar fora
    document.addEventListener('click', (event) => {
        document.querySelectorAll('.autocomplete-results').forEach(div => {
            if (!div.contains(event.target) && !event.target.closest('.input-group')) {
                div.innerHTML = '';
            }
        });
    });

    addStopButton.addEventListener('click', () => {
        stopCounter++;
        const stopInputGroup = document.createElement('div');
        stopInputGroup.classList.add('input-group');
        stopInputGroup.innerHTML = `
            <label for="stop-${stopCounter}-input">Parada ${stopCounter}:</label>
            <input type="text" id="stop-${stopCounter}-input" placeholder="Digite o endereço da parada ou CEP">
            <div id="stop-${stopCounter}-autocomplete" class="autocomplete-results"></div>
            <button class="remove-stop" data-stop-id="stop-${stopCounter}-input">Remover</button>
        `;
        inputsContainer.insertBefore(stopInputGroup, addStopButton);

        // Event listener para remover parada
        stopInputGroup.querySelector('.remove-stop').addEventListener('click', (event) => {
            const stopIdToRemove = event.target.dataset.stopId;
            const inputToRemove = document.getElementById(stopIdToRemove);
            if (inputToRemove && inputToRemove.parentNode) {
                inputToRemove.parentNode.remove();
                if (waypoints.length > 0) {
                    calculateRouteButton.click();
                }
            }
        });
    });

    calculateRouteButton.addEventListener('click', async () => {
        waypoints.length = 0; // Limpa os waypoints anteriores
        markers.forEach(marker => map.removeLayer(marker)); // Limpa os marcadores anteriores
        markers.length = 0;

        const originInputEl = document.getElementById('origin-input');
        const destinationInputEl = document.getElementById('destination-input');
        const stopInputs = Array.from(document.querySelectorAll('[id^="stop-"][id$="-input"]'));

        const processAddress = async (inputElement, type, label) => {
            const address = inputElement.value.trim();
            if (!address) {
                showError(inputElement, `Por favor, preencha o campo de ${label}.`);
                return false;
            }

            const cepMatch = address.match(/^\d{5}-?\d{3}$/);
            let finalAddress = address;

            if (cepMatch) {
                const addrFromCep = await fetchAddressFromCEP(cepMatch[0]);
                if (addrFromCep) {
                    finalAddress = addrFromCep;
                } else {
                    showError(inputElement, `O CEP digitado para a ${label} (${address}) não foi encontrado ou é inválido.`);
                    return false;
                }
            }

            const latlng = await geocodeAddress(finalAddress);
            if (latlng) {
                waypoints.push(latlng);
                let icon;
                if (type === 'start') {
                    icon = startIcon;
                } else if (type === 'end') {
                    icon = endIcon;
                } else {
                    icon = stopIcon;
                }
                const marker = L.marker(latlng, { icon: icon }).addTo(map);
                marker.bindPopup(finalAddress).openPopup();
                markers.push(marker);
                return true;
            } else {
                showError(inputElement, `Não foi possível localizar o endereço de ${label}. Tente ser mais específico.`);
                return false;
            }
        };

        clearErrors();

        // Processa origem
        const originSuccess = await processAddress(originInputEl, 'start', 'Origem');
        if (!originSuccess) return;

        // Processa paradas intermediárias
        for (let i = 0; i < stopInputs.length; i++) {
            const stopSuccess = await processAddress(stopInputs[i], 'stop', `Parada ${i + 1}`);
            if (!stopSuccess) return;
        }

        // Processa destino
        const destSuccess = await processAddress(destinationInputEl, 'end', 'Destino');
        if (!destSuccess) return;

        // Guarda: o LRM exige no mínimo 2 pontos válidos
        if (waypoints.length < 2) {
            showError(originInputEl, 'É necessário pelo menos 2 endereços válidos (origem e destino) para traçar a rota.');
            return;
        }

        if (routingControl) {
            map.removeControl(routingControl);
            routingControl = null;
        }

        // Desenhar a rota com design premium fluorescente
        routingControl = L.Routing.control({
            waypoints: waypoints.map(latlng => L.Routing.waypoint(latlng)),
            router: new SafeOSRMv1({
                serviceUrl: 'https://router.project-osrm.org/route/v1',
                timeout: 30000
            }),
            routeWhileDragging: false,
            language: 'pt-BR', // 'pt' não existe na localização do LRM 3.2.12 — usar 'pt-BR'
            showAlternatives: false,
            addWaypoints: false,    // Desativa UI interna que duplica/conflita com a nossa
            draggableWaypoints: false,
            fitSelectedRoutes: true,
            autoRoute: true,
            geocoder: null,
            lineOptions: {
                styles: [
                    { color: '#0f172a', opacity: 0.6, weight: 8 }, // Contorno escuro
                    { color: '#38bdf8', opacity: 1, weight: 4 }    // Linha azul neon
                ]
            },
            createMarker: function() { return null; } // Evita duplicar marcadores do Leaflet Routing Machine
        }).addTo(map);

        routingControl.on('routesfound', (e) => {
            const routes = e.routes;
            if (routes.length > 0) {
                const summary = routes[0].summary;
                const totalDistanceKm = (summary.totalDistance / 1000).toFixed(2);
                const totalTimeMinutes = (summary.totalTime / 60).toFixed(0);

                totalDistanceSpan.textContent = `${totalDistanceKm} km`;
                totalTimeSpan.textContent = `${totalTimeMinutes} minutos`;

                turnByTurnInstructionsDiv.innerHTML = '';
                const instructionsList = document.createElement('ol');
                routes[0].instructions.forEach(inst => {
                    const listItem = document.createElement('li');
                    listItem.textContent = inst.text;
                    instructionsList.appendChild(listItem);
                });
                turnByTurnInstructionsDiv.appendChild(instructionsList);
                routeDetails.style.display = 'block';
            }
        });

        routingControl.on('routingerror', (e) => {
            console.error('Erro de roteamento:', e);
            const errorBanner = document.createElement('div');
            errorBanner.className = 'error-message';
            errorBanner.style.display = 'block';
            errorBanner.style.marginTop = '15px';

            // Expõe a mensagem real do LRM/OSRM para facilitar diagnóstico
            const status = e && e.error && (e.error.status || e.error.code);
            const rawMsg = e && e.error && (e.error.message || e.error.target && e.error.target.statusText);
            const detalhe = [status, rawMsg].filter(Boolean).join(' - ');
            errorBanner.textContent = detalhe
                ? `Erro ao traçar rota: ${detalhe}`
                : 'Erro ao traçar rota de navegação entre os pontos. Verifique a viabilidade de tráfego.';

            turnByTurnInstructionsDiv.innerHTML = '';
            turnByTurnInstructionsDiv.appendChild(errorBanner);

            totalDistanceSpan.textContent = '---';
            totalTimeSpan.textContent = '---';
            routeDetails.style.display = 'block';
        });
    });
});
