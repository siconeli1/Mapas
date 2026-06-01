document.addEventListener('DOMContentLoaded', () => {
    const map = L.map('map').setView([-23.55052, -46.633309], 12);

    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    const darkMatterLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    });

    const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    });

    L.control.layers({
        'Mapa de Ruas': osmLayer,
        'Modo Escuro': darkMatterLayer,
        'Satelite': esriSatellite
    }).addTo(map);

    setTimeout(() => map.invalidateSize(), 250);

    const inputsContainer = document.getElementById('inputs-container');
    const addStopButton = document.getElementById('add-stop');
    const calculateRouteButton = document.getElementById('calculate-route');
    const routeDetails = document.getElementById('route-details');
    const totalDistanceSpan = document.getElementById('total-distance');
    const totalTimeSpan = document.getElementById('total-time');
    const turnByTurnInstructionsDiv = document.getElementById('turn-by-turn-instructions');

    let stopCounter = 0;
    let routingControl = null;
    let isCalculating = false;

    const markers = [];
    const requestCache = new Map();

    const startIcon = createMarkerIcon('green');
    const endIcon = createMarkerIcon('red');
    const stopIcon = createMarkerIcon('blue');

    function createMarkerIcon(color) {
        return L.icon({
            iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });
    }

    function setLoadingState(active) {
        isCalculating = active;
        calculateRouteButton.disabled = active;
        addStopButton.disabled = active;
        calculateRouteButton.textContent = active ? 'Calculando...' : 'Calcular Rota';
    }

    function resetRouteDetails() {
        totalDistanceSpan.textContent = '';
        totalTimeSpan.textContent = '';
        turnByTurnInstructionsDiv.innerHTML = '';
        routeDetails.style.display = 'none';
    }

    function clearMapState() {
        markers.forEach(marker => map.removeLayer(marker));
        markers.length = 0;

        if (routingControl) {
            map.removeControl(routingControl);
            routingControl = null;
        }
    }

    function debounce(func, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), delay);
        };
    }

    async function fetchWithTimeout(url, options = {}) {
        const { timeout = 10000, cacheKey = url, responseType = 'auto' } = options;
        if (requestCache.has(cacheKey)) {
            return requestCache.get(cacheKey);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const contentType = response.headers.get('content-type') || '';
            const data = responseType === 'text'
                ? await response.text()
                : contentType.includes('application/json')
                    ? await response.json()
                    : await response.text();

            requestCache.set(cacheKey, data);
            return data;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    const DirectOSRMv1 = L.Routing.OSRMv1.extend({
        route: function(waypoints, callback, context, options) {
            const url = this.buildRouteUrl(waypoints, L.extend({}, this.options.routingOptions, options));

            fetchWithTimeout(url, { timeout: 30000, cacheKey: `route:${url}`, responseType: 'text' })
                .then(text => {
                    const response = { status: 200, statusCode: 200, responseText: text };
                    this._routeDone(response, waypoints, options, callback, context);
                })
                .catch(error => {
                    callback.call(context || callback, {
                        status: -1,
                        message: `Erro de rede no roteamento: ${error.message || error}`
                    });
                });
        }
    });

    async function fetchAddressFromCEP(cep) {
        const cleanCep = String(cep).replace(/\D/g, '');
        if (cleanCep.length !== 8) return null;

        try {
            const data = await fetchWithTimeout(`https://viacep.com.br/ws/${cleanCep}/json/`, {
                cacheKey: `cep:${cleanCep}`
            });

            if (!data || data.erro) return null;

            const parts = [data.logradouro, data.bairro, data.localidade]
                .filter(part => part && part.trim());
            const base = parts.join(', ');

            return data.uf ? `${base} - ${data.uf}` : base;
        } catch (error) {
            console.error('Erro ao buscar CEP:', error);
            return null;
        }
    }

    async function searchNominatim(query, limit = 1) {
        const normalizedQuery = query.trim();
        if (!normalizedQuery) return [];

        const params = new URLSearchParams({
            format: 'json',
            q: normalizedQuery,
            limit: String(limit),
            countrycodes: 'br',
            'accept-language': 'pt-BR'
        });

        return fetchWithTimeout(`https://nominatim.openstreetmap.org/search?${params}`, {
            cacheKey: `nominatim:${limit}:${normalizedQuery.toLowerCase()}`
        });
    }

    async function geocodeAddress(address) {
        const parts = address.split(',').map(part => part.trim()).filter(Boolean);
        const attempts = [address];

        if (parts.length >= 3) {
            const street = parts[0];
            const cityState = parts[2];
            const cityOnly = cityState.split('-')[0].trim();

            attempts.push(`${street}, ${cityState}`);
            attempts.push(`${street}, ${cityOnly}`);
            attempts.push(cityState);
        } else if (parts.length >= 2) {
            attempts.push(parts[1]);
        }

        const streetPart = parts[0] || '';
        const numberMatch = streetPart.match(/(.*?)\s*,\s*\d+$/) || streetPart.match(/(.*?)\s+\d+$/);
        if (numberMatch && numberMatch[1]) {
            const streetWithoutNumber = numberMatch[1].trim();
            attempts.push(`${streetWithoutNumber}, ${parts.slice(1).join(', ')}`);
        }

        const uniqueAttempts = [...new Set(
            attempts
                .map(attempt => (attempt || '').replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s*,\s*,+/g, ', '))
                .filter(attempt => attempt.length > 2)
        )];

        for (const attempt of uniqueAttempts) {
            try {
                const results = await searchNominatim(attempt, 1);
                if (results.length > 0) {
                    return L.latLng(results[0].lat, results[0].lon);
                }
            } catch (error) {
                console.error(`Erro ao geocodificar "${attempt}":`, error);
            }
        }

        return null;
    }

    function showError(inputElement, message) {
        const inputGroup = inputElement.closest('.input-group');
        if (!inputGroup) return;

        inputGroup.classList.add('has-error');

        let errorDiv = inputGroup.querySelector('.error-message');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            inputGroup.appendChild(errorDiv);
        }

        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }

    function clearErrors() {
        document.querySelectorAll('.input-group').forEach(group => {
            group.classList.remove('has-error');

            const errorDiv = group.querySelector('.error-message');
            if (errorDiv) {
                errorDiv.textContent = '';
                errorDiv.style.display = 'none';
            }
        });
    }

    function clearInputError(inputElement) {
        const inputGroup = inputElement.closest('.input-group');
        if (!inputGroup) return;

        inputGroup.classList.remove('has-error');

        const errorDiv = inputGroup.querySelector('.error-message');
        if (errorDiv) {
            errorDiv.textContent = '';
            errorDiv.style.display = 'none';
        }
    }

    function getAutocompleteDiv(inputElement) {
        return document.getElementById(inputElement.id.replace('-input', '-autocomplete'));
    }

    const handleAutocomplete = debounce(async (inputElement) => {
        const autocompleteDiv = getAutocompleteDiv(inputElement);
        if (!autocompleteDiv) return;

        const query = inputElement.value.trim();
        autocompleteDiv.innerHTML = '';

        if (query.length < 3) return;

        try {
            const cepMatch = query.match(/^\d{5}-?\d{3}$/);
            if (cepMatch) {
                const addressFromCep = await fetchAddressFromCEP(cepMatch[0]);
                if (addressFromCep) {
                    addAutocompleteOption(autocompleteDiv, inputElement, `CEP: ${cepMatch[0]} - ${addressFromCep}`, addressFromCep);
                    return;
                }
            }

            const results = await searchNominatim(query, 5);
            results.forEach(result => {
                addAutocompleteOption(autocompleteDiv, inputElement, result.display_name, result.display_name);
            });
        } catch (error) {
            console.error('Erro no autocomplete:', error);
        }
    }, 600);

    function addAutocompleteOption(autocompleteDiv, inputElement, label, value) {
        const option = document.createElement('div');
        option.textContent = label;
        option.addEventListener('click', () => {
            inputElement.value = value;
            autocompleteDiv.innerHTML = '';
            clearInputError(inputElement);
        });
        autocompleteDiv.appendChild(option);
    }

    inputsContainer.addEventListener('input', (event) => {
        if (event.target.tagName !== 'INPUT' || !event.target.id.includes('-input')) return;

        clearInputError(event.target);
        handleAutocomplete(event.target);
    });

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
        stopInputGroup.className = 'input-group';
        stopInputGroup.innerHTML = `
            <label for="stop-${stopCounter}-input">Parada ${stopCounter}:</label>
            <input type="text" id="stop-${stopCounter}-input" placeholder="Digite o endereco da parada ou CEP">
            <div id="stop-${stopCounter}-autocomplete" class="autocomplete-results"></div>
            <button class="remove-stop" type="button" data-stop-id="stop-${stopCounter}-input">Remover</button>
        `;

        inputsContainer.appendChild(stopInputGroup);

        stopInputGroup.querySelector('.remove-stop').addEventListener('click', (event) => {
            const inputToRemove = document.getElementById(event.target.dataset.stopId);
            if (inputToRemove && inputToRemove.parentNode) {
                inputToRemove.parentNode.remove();
            }
        });
    });

    async function processAddress(inputElement, type, label) {
        const address = inputElement.value.trim();
        if (!address) {
            showError(inputElement, `Por favor, preencha o campo de ${label}.`);
            return null;
        }

        const cepMatch = address.match(/^\d{5}-?\d{3}$/);
        let finalAddress = address;

        if (cepMatch) {
            const addressFromCep = await fetchAddressFromCEP(cepMatch[0]);
            if (!addressFromCep) {
                showError(inputElement, `O CEP digitado para ${label} (${address}) nao foi encontrado ou e invalido.`);
                return null;
            }
            finalAddress = addressFromCep;
        }

        const latlng = await geocodeAddress(finalAddress);
        if (!latlng) {
            showError(inputElement, `Nao foi possivel localizar o endereco de ${label}. Tente ser mais especifico.`);
            return null;
        }

        const icon = type === 'start' ? startIcon : type === 'end' ? endIcon : stopIcon;
        const marker = L.marker(latlng, { icon }).addTo(map);
        marker.bindPopup(finalAddress);
        markers.push(marker);

        return latlng;
    }

    calculateRouteButton.addEventListener('click', async () => {
        if (isCalculating) return;

        setLoadingState(true);
        clearErrors();
        clearMapState();
        resetRouteDetails();

        let routeRequestStarted = false;

        try {
            const originInputEl = document.getElementById('origin-input');
            const destinationInputEl = document.getElementById('destination-input');
            const stopInputs = Array.from(document.querySelectorAll('[id^="stop-"][id$="-input"]'));

            const waypoints = [];
            const origin = await processAddress(originInputEl, 'start', 'origem');
            if (!origin) return;
            waypoints.push(origin);

            for (let i = 0; i < stopInputs.length; i++) {
                const stop = await processAddress(stopInputs[i], 'stop', `parada ${i + 1}`);
                if (!stop) return;
                waypoints.push(stop);
            }

            const destination = await processAddress(destinationInputEl, 'end', 'destino');
            if (!destination) return;
            waypoints.push(destination);

            if (waypoints.length < 2) {
                showError(originInputEl, 'E necessario preencher origem e destino validos para tracar a rota.');
                return;
            }

            routingControl = L.Routing.control({
                waypoints: waypoints.map(latlng => L.Routing.waypoint(latlng)),
                router: new DirectOSRMv1({
                    serviceUrl: 'https://router.project-osrm.org/route/v1',
                    timeout: 30000
                }),
                routeWhileDragging: false,
                language: 'pt-BR',
                showAlternatives: false,
                addWaypoints: false,
                draggableWaypoints: false,
                fitSelectedRoutes: true,
                autoRoute: true,
                geocoder: null,
                lineOptions: {
                    styles: [
                        { color: '#0f172a', opacity: 0.6, weight: 8 },
                        { color: '#38bdf8', opacity: 1, weight: 4 }
                    ]
                },
                createMarker: () => null
            }).addTo(map);

            routeRequestStarted = true;

            routingControl.on('routesfound', (event) => {
                const route = event.routes[0];
                if (!route) {
                    showRouteError('Nenhuma rota foi encontrada para os pontos informados.');
                    return;
                }

                totalDistanceSpan.textContent = `${(route.summary.totalDistance / 1000).toFixed(2)} km`;
                totalTimeSpan.textContent = `${Math.round(route.summary.totalTime / 60)} minutos`;

                const instructionsList = document.createElement('ol');
                route.instructions.forEach(instruction => {
                    const listItem = document.createElement('li');
                    listItem.textContent = instruction.text;
                    instructionsList.appendChild(listItem);
                });

                turnByTurnInstructionsDiv.innerHTML = '';
                turnByTurnInstructionsDiv.appendChild(instructionsList);
                routeDetails.style.display = 'block';
                setLoadingState(false);
            });

            routingControl.on('routingerror', (event) => {
                const error = event && event.error;
                const status = error && (error.status || error.code);
                const message = error && (error.message || error.target && error.target.statusText);
                const details = [status, message].filter(Boolean).join(' - ');

                showRouteError(details
                    ? `Erro ao tracar rota: ${details}`
                    : 'Erro ao tracar rota entre os pontos. Verifique se todos os enderecos sao acessiveis por via terrestre.');
            });
        } catch (error) {
            console.error('Erro ao calcular rota:', error);
            showRouteError(`Erro inesperado ao calcular rota: ${error.message || error}`);
        } finally {
            if (!routeRequestStarted) {
                setLoadingState(false);
            }
        }
    });

    function showRouteError(message) {
        const errorBanner = document.createElement('div');
        errorBanner.className = 'error-message';
        errorBanner.style.display = 'block';
        errorBanner.style.marginTop = '15px';
        errorBanner.textContent = message;

        totalDistanceSpan.textContent = '---';
        totalTimeSpan.textContent = '---';
        turnByTurnInstructionsDiv.innerHTML = '';
        turnByTurnInstructionsDiv.appendChild(errorBanner);
        routeDetails.style.display = 'block';
        setLoadingState(false);
    }
});
