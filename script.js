// Configuración inicial del mapa
const INITIAL_COORDS = [-29.411, -66.850]; // La Rioja, Argentina
const INITIAL_ZOOM = 13;

// Límites aproximados de la Provincia de La Rioja (Bounding Box)
const LA_RIOJA_BOUNDS = {
    minLat: -31.9,
    maxLat: -27.7,
    minLon: -69.5,
    maxLon: -65.1
};

// Inicializar el mapa
const map = L.map('map', {
    center: INITIAL_COORDS,
    zoom: INITIAL_ZOOM,
    zoomControl: false // Ocultamos para moverlo a la derecha
});

// Añadir capa de mapa (CartoDB Positron - Look limpio y profesional)
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
}).addTo(map);

// Mover el control de zoom a la derecha
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Variables para el marcador y elementos del DOM
let currentMarker = null;
const form = document.getElementById('incident-form');
const coordsInput = document.getElementById('coordinates');
const geoValidationMsg = document.getElementById('geo-validation');
const getLocationBtn = document.getElementById('get-location');

/**
 * Valida si una coordenada está dentro de los límites de La Rioja
 */
function isWithinLaRioja(lat, lng) {
    return lat >= LA_RIOJA_BOUNDS.minLat && 
           lat <= LA_RIOJA_BOUNDS.maxLat && 
           lng >= LA_RIOJA_BOUNDS.minLon && 
           lng <= LA_RIOJA_BOUNDS.maxLon;
}

/**
 * Actualiza la posición del marcador y los campos del formulario
 */
function updateMarkerPosition(lat, lng) {
    const coordsString = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    coordsInput.value = coordsString;

    // Validar ubicación
    if (isWithinLaRioja(lat, lng)) {
        geoValidationMsg.classList.add('hidden');
    } else {
        geoValidationMsg.classList.remove('hidden');
    }

    // Crear o mover el marcador
    if (currentMarker) {
        currentMarker.setLatLng([lat, lng]);
    } else {
        currentMarker = L.marker([lat, lng], {
            draggable: true
        }).addTo(map);

        currentMarker.on('dragend', function(e) {
            const position = e.target.getLatLng();
            updateMarkerPosition(position.lat, position.lng);
        });
    }
}

// Evento: Click en el mapa
map.on('click', function(e) {
    updateMarkerPosition(e.latlng.lat, e.latlng.lng);
});

// Evento: Botón Mi Ubicación
getLocationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
        alert('Tu navegador no soporta geolocalización');
        return;
    }

    getLocationBtn.innerHTML = '<svg class="spinner" viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle></svg>';
    getLocationBtn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            map.flyTo([latitude, longitude], 16);
            updateMarkerPosition(latitude, longitude);
            resetLocationBtn();
        },
        (error) => {
            console.error('Error de geolocalización:', error);
            alert('No se pudo obtener tu ubicación actual.');
            resetLocationBtn();
        },
        { enableHighAccuracy: true }
    );
});

function resetLocationBtn() {
    getLocationBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
    getLocationBtn.disabled = false;
}

// Evento: Envío del formulario
form.addEventListener('submit', (e) => {
    e.preventDefault();

    const latLng = currentMarker ? currentMarker.getLatLng() : null;

    if (!latLng) {
        alert('Por favor, seleccione un punto en el mapa.');
        return;
    }

    if (!isWithinLaRioja(latLng.lat, latLng.lng)) {
        alert('El reporte debe estar dentro de la provincia de La Rioja.');
        return;
    }

    const formData = {
        tipo: document.getElementById('problem-type').value,
        descripcion: document.getElementById('description').value,
        ubicacion: {
            lat: latLng.lat,
            lng: latLng.lng
        },
        fecha: new Date().toISOString(),
        id_usuario: "user_" + Math.random().toString(36).substr(2, 9) // ID simulado
    };

    console.log('--- NUEVO REPORTE ENVIADO ---');
    console.log(JSON.stringify(formData, null, 2));
    
    alert('¡Reporte enviado con éxito! Gracias por su compromiso ciudadano.');
    
    // Resetear formulario
    form.reset();
    if (currentMarker) {
        map.removeLayer(currentMarker);
        currentMarker = null;
    }
    coordsInput.value = '';
});
