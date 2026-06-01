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

    let routeLine = null;
    let routeOutline = null;
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

        if (routeLine) {
            map.removeLayer(routeLine);
            routeLine = null;
        }

        if (routeOutline) {
            map.removeLayer(routeOutline);
            routeOutline = null;
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
        const stopInputGroup = document.createElement('div');
        stopInputGroup.className = 'input-group';
        stopInputGroup.innerHTML = `
            <label>Parada:</label>
            <input type="text" placeholder="Digite o endereco da parada ou CEP">
            <div class="autocomplete-results"></div>
            <button class="remove-stop" type="button">Remover</button>
        `;

        inputsContainer.appendChild(stopInputGroup);
        renumberStops();

        stopInputGroup.querySelector('.remove-stop').addEventListener('click', (event) => {
            event.target.closest('.input-group').remove();
            renumberStops();
        });
    });

    function renumberStops() {
        const stopGroups = Array.from(inputsContainer.querySelectorAll('.input-group'))
            .filter(group => group.querySelector('.remove-stop'));

        stopGroups.forEach((group, index) => {
            const stopNumber = index + 1;
            const inputId = `stop-${stopNumber}-input`;
            const autocompleteId = `stop-${stopNumber}-autocomplete`;
            const label = group.querySelector('label');
            const input = group.querySelector('input');
            const autocomplete = group.querySelector('.autocomplete-results');

            label.textContent = `Parada ${stopNumber}:`;
            label.setAttribute('for', inputId);
            input.id = inputId;
            autocomplete.id = autocompleteId;
        });
    }

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

            routeRequestStarted = true;
            const route = await fetchRoute(waypoints);
            renderRoute(route, waypoints);
        } catch (error) {
            console.error('Erro ao calcular rota:', error);
            zoomToRoute(null, getVisibleMarkerPoints());
            showRouteError(error.message || 'Erro inesperado ao calcular rota.');
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

    async function fetchRoute(waypoints) {
        const coordinates = waypoints
            .map(latlng => `${latlng.lng},${latlng.lat}`)
            .join(';');

        const params = new URLSearchParams({
            overview: 'full',
            geometries: 'geojson',
            steps: 'true',
            alternatives: 'false'
        });

        const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?${params}`;
        const data = await fetchWithTimeout(url, {
            timeout: 30000,
            cacheKey: `route:${coordinates}`
        });

        if (!data || data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            const details = data && (data.message || data.code);
            throw new Error(details
                ? `Nao foi possivel tracar a rota: ${details}.`
                : 'Nao foi possivel tracar uma rota entre os pontos informados.');
        }

        return data.routes[0];
    }

    function renderRoute(route, waypoints) {
        const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

        routeOutline = L.polyline(coordinates, {
            color: '#0f172a',
            opacity: 0.45,
            weight: 10,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(map);

        routeLine = L.polyline(coordinates, {
            color: '#38bdf8',
            opacity: 0.95,
            weight: 5,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(map);

        totalDistanceSpan.textContent = `${(route.distance / 1000).toFixed(2)} km`;
        totalTimeSpan.textContent = `${Math.round(route.duration / 60)} minutos`;

        turnByTurnInstructionsDiv.innerHTML = '';
        turnByTurnInstructionsDiv.appendChild(buildInstructionsList(route));
        routeDetails.style.display = 'block';

        zoomToRoute(routeLine.getBounds(), waypoints);
        setLoadingState(false);
    }

    function getVisibleMarkerPoints() {
        return markers.map(marker => marker.getLatLng());
    }

    function zoomToRoute(bounds, waypoints) {
        const sidebarWidth = window.innerWidth <= 768 ? 0 : 520;
        const fallbackBounds = waypoints.length
            ? L.latLngBounds(waypoints)
            : null;
        const targetBounds = bounds && bounds.isValid()
            ? bounds
            : fallbackBounds;

        if (!targetBounds || !targetBounds.isValid()) return;

        map.fitBounds(targetBounds, {
            paddingTopLeft: [sidebarWidth, 70],
            paddingBottomRight: [70, 70],
            maxZoom: 16,
            animate: true,
            duration: 0.8
        });
    }

    function buildInstructionsList(route) {
        const instructionsList = document.createElement('ol');

        route.legs.forEach(leg => {
            leg.steps.forEach(step => {
                const text = formatInstruction(step);
                if (!text) return;

                const listItem = document.createElement('li');
                listItem.textContent = text;
                instructionsList.appendChild(listItem);
            });
        });

        if (!instructionsList.children.length) {
            const item = document.createElement('li');
            item.textContent = 'Siga pela rota destacada no mapa ate o destino.';
            instructionsList.appendChild(item);
        }

        return instructionsList;
    }

    function formatInstruction(step) {
        const name = step.name ? ` em ${step.name}` : '';
        const distance = step.distance >= 1000
            ? `${(step.distance / 1000).toFixed(1)} km`
            : `${Math.round(step.distance)} m`;

        const maneuver = step.maneuver || {};
        const type = maneuver.type;
        const modifier = maneuver.modifier;

        const directions = {
            left: 'vire a esquerda',
            right: 'vire a direita',
            slight_left: 'mantenha levemente a esquerda',
            slight_right: 'mantenha levemente a direita',
            sharp_left: 'vire fortemente a esquerda',
            sharp_right: 'vire fortemente a direita',
            straight: 'siga em frente'
        };

        if (type === 'depart') return `Saia${name} e siga por ${distance}.`;
        if (type === 'arrive') return 'Voce chegou ao destino.';
        if (type === 'roundabout' || type === 'rotary') return `Entre na rotatoria${name} e siga por ${distance}.`;
        if (type === 'merge') return `Entre na via${name} e siga por ${distance}.`;
        if (type === 'new name') return `Continue${name} por ${distance}.`;

        const action = directions[modifier] || 'continue';
        return `${action.charAt(0).toUpperCase()}${action.slice(1)}${name} e siga por ${distance}.`;
    }
});
