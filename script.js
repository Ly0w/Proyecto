// ==========================================
// CONFIGURACIÓN E INICIALIZACIÓN
// ==========================================
const INITIAL_COORDS = [-29.411, -66.850]; // La Rioja, Argentina
const INITIAL_ZOOM = 13;
const MAX_GEO_RADIUS_KM = 400; // Radio máximo desde el centro para aceptar reportes
const DUPLICATE_RADIUS_METERS = 50; // Radio para buscar duplicados

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('SW Registered:', reg.scope);
        }).catch(err => {
            console.log('SW Registration failed:', err);
        });
    });
}

// Inicializar el mapa
const map = L.map('map', {
    center: INITIAL_COORDS,
    zoom: INITIAL_ZOOM,
    zoomControl: false
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO',
    maxZoom: 20
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

// ==========================================
// ARQUITECTURA DE DATOS (LocalStorage DB)
// ==========================================
const Status = {
    PENDING: "Pending",
    REVIEW: "In Review",
    REPAIR: "In Repair",
    RESOLVED: "Resolved"
};

class StorageManager {
    static getReports() {
        return JSON.parse(localStorage.getItem('antigravity_reports')) || [];
    }
    
    static saveReports(reports) {
        localStorage.setItem('antigravity_reports', JSON.stringify(reports));
    }
    
    static addReport(report) {
        const reports = this.getReports();
        reports.push(report);
        this.saveReports(reports);
        return report;
    }

    static updateReportStatus(id, newStatus) {
        const reports = this.getReports();
        const index = reports.findIndex(r => r.id === id);
        if (index !== -1) {
            reports[index].statusId = newStatus;
            this.saveReports(reports);
            this.logAction(id, `Status changed to ${newStatus}`);
        }
    }

    static joinReport(id) {
        const reports = this.getReports();
        const index = reports.findIndex(r => r.id === id);
        if (index !== -1) {
            reports[index].affectedCount = (reports[index].affectedCount || 1) + 1;
            this.saveReports(reports);
        }
    }

    static logAction(reportId, action) {
        const logs = JSON.parse(localStorage.getItem('antigravity_logs')) || [];
        logs.push({ reportId, action, date: new Date().toISOString() });
        localStorage.setItem('antigravity_logs', JSON.stringify(logs));
    }
}

// ==========================================
// LÓGICA ESPACIAL Y GEOMÉTRICA (Haversine)
// ==========================================
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radio de la Tierra en metros
    const phi1 = lat1 * Math.PI/180;
    const phi2 = lat2 * Math.PI/180;
    const deltaPhi = (lat2-lat1) * Math.PI/180;
    const deltaLambda = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Metros
}

function isWithinGeofence(lat, lng) {
    const distMeters = getDistance(INITIAL_COORDS[0], INITIAL_COORDS[1], lat, lng);
    return (distMeters / 1000) <= MAX_GEO_RADIUS_KM;
}

function findDuplicate(lat, lng, type) {
    const reports = StorageManager.getReports();
    return reports.find(r => 
        r.tipo === type && 
        r.statusId !== Status.RESOLVED &&
        getDistance(lat, lng, r.lat, r.lng) <= DUPLICATE_RADIUS_METERS
    );
}

// ==========================================
// RENDERIZADO DE MAPA Y FORMULARIO
// ==========================================
let currentMarker = null;
let drawnMarkers = [];
const form = document.getElementById('incident-form');
const coordsInput = document.getElementById('coordinates');
const geoValidationMsg = document.getElementById('geo-validation');
const getLocationBtn = document.getElementById('get-location');

// Render markers on load
function renderExistingMarkers() {
    // Remove existing
    drawnMarkers.forEach(m => map.removeLayer(m));
    drawnMarkers = [];

    const reports = StorageManager.getReports();
    reports.forEach(r => {
        let iconClass = 'marker-pending';
        if(r.statusId === Status.REVIEW) iconClass = 'marker-review';
        if(r.statusId === Status.REPAIR) iconClass = 'marker-repair';
        if(r.statusId === Status.RESOLVED) iconClass = 'marker-resolved';

        const marker = L.marker([r.lat, r.lng]).addTo(map)
            .bindPopup(`<b>${r.tipo.toUpperCase()}</b><br>${r.descripcion}<br>Estado: ${r.statusId}<br>Afectados: ${r.affectedCount || 1}`);
        
        // Add CSS filter class to change marker color
        marker.on('add', function() {
            if(marker._icon) L.DomUtil.addClass(marker._icon, iconClass);
        });

        drawnMarkers.push(marker);
    });
}
renderExistingMarkers();

function updateMarkerPosition(lat, lng) {
    coordsInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    if (isWithinGeofence(lat, lng)) {
        geoValidationMsg.classList.add('hidden');
    } else {
        geoValidationMsg.classList.remove('hidden');
    }

    if (currentMarker) {
        currentMarker.setLatLng([lat, lng]);
    } else {
        currentMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
        currentMarker.on('dragend', function(e) {
            const pos = e.target.getLatLng();
            updateMarkerPosition(pos.lat, pos.lng);
        });
    }
}

map.on('click', function(e) {
    updateMarkerPosition(e.latlng.lat, e.latlng.lng);
});

getLocationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) return alert('Geolocalización no soportada.');
    
    getLocationBtn.innerHTML = '<svg class="spinner" viewBox="0 0 50 50"><circle cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle></svg>';
    getLocationBtn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        pos => {
            map.flyTo([pos.coords.latitude, pos.coords.longitude], 16);
            updateMarkerPosition(pos.coords.latitude, pos.coords.longitude);
            resetLocationBtn();
        },
        err => {
            alert('Error obteniendo ubicación.');
            resetLocationBtn();
        },
        { enableHighAccuracy: true }
    );
});

function resetLocationBtn() {
    getLocationBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
    getLocationBtn.disabled = false;
}

// ==========================================
// GESTIÓN DE ENVÍO Y DUPLICADOS
// ==========================================
let pendingSubmission = null;
const duplicateModal = document.getElementById('duplicate-modal');

form.addEventListener('submit', (e) => {
    e.preventDefault();

    const latLng = currentMarker ? currentMarker.getLatLng() : null;
    if (!latLng) return alert('Seleccione un punto en el mapa.');
    if (!isWithinGeofence(latLng.lat, latLng.lng)) return alert('Fuera de límite permitido (La Rioja).');

    const reportData = {
        id: "rep_" + Date.now() + Math.random().toString(36).substr(2, 5),
        tipo: document.getElementById('problem-type').value,
        descripcion: document.getElementById('description').value,
        fotoUrl: document.getElementById('photo-url').value,
        lat: latLng.lat,
        lng: latLng.lng,
        fecha: new Date().toISOString(),
        statusId: Status.PENDING,
        affectedCount: 1
    };

    const dup = findDuplicate(reportData.lat, reportData.lng, reportData.tipo);
    if (dup) {
        document.getElementById('dup-type').textContent = dup.tipo.toUpperCase();
        duplicateModal.classList.remove('hidden');
        pendingSubmission = { newReport: reportData, existingId: dup.id };
    } else {
        submitReport(reportData);
    }
});

function submitReport(data) {
    StorageManager.addReport(data);
    alert('Reporte enviado con éxito. Gracias por colaborar.');
    finalizeForm();
}

function finalizeForm() {
    form.reset();
    if (currentMarker) { map.removeLayer(currentMarker); currentMarker = null; }
    coordsInput.value = '';
    renderExistingMarkers();
    if(!document.getElementById('admin-panel').classList.contains('hidden')) {
        renderAdminTable();
    }
}

document.getElementById('btn-join-report').addEventListener('click', () => {
    if(pendingSubmission) {
        StorageManager.joinReport(pendingSubmission.existingId);
        alert('Te has unido al reporte existente.');
        duplicateModal.classList.add('hidden');
        finalizeForm();
    }
});

document.getElementById('btn-force-report').addEventListener('click', () => {
    if(pendingSubmission) {
        submitReport(pendingSubmission.newReport);
        duplicateModal.classList.add('hidden');
    }
});

document.getElementById('btn-cancel-report').addEventListener('click', () => {
    duplicateModal.classList.add('hidden');
    pendingSubmission = null;
});


// ==========================================
// PANEL DE ADMINISTRACIÓN
// ==========================================
const adminPanel = document.getElementById('admin-panel');
const adminToggle = document.getElementById('admin-toggle');
const closeAdmin = document.getElementById('close-admin');
const filterType = document.getElementById('filter-type');
const adminTableBody = document.querySelector('#admin-table tbody');

adminToggle.addEventListener('click', () => {
    adminPanel.classList.remove('hidden');
    renderAdminTable();
});

closeAdmin.addEventListener('click', () => {
    adminPanel.classList.add('hidden');
});

filterType.addEventListener('change', renderAdminTable);

function renderAdminTable() {
    const reports = StorageManager.getReports();
    const filter = filterType.value;
    
    adminTableBody.innerHTML = '';
    
    const filtered = filter === 'all' ? reports : reports.filter(r => r.tipo === filter);
    
    // Sort desc by date
    filtered.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));

    filtered.forEach(r => {
        const tr = document.createElement('tr');
        
        const typeStr = r.tipo.replace('-', ' ').toUpperCase();
        const dateStr = new Date(r.fecha).toLocaleDateString();

        tr.innerHTML = `
            <td>...${r.id.slice(-5)}</td>
            <td>${typeStr}</td>
            <td>${dateStr}</td>
            <td>${r.affectedCount || 1}</td>
            <td>
                <select class="status-select" data-id="${r.id}" data-status="${r.statusId}">
                    <option value="${Status.PENDING}" ${r.statusId===Status.PENDING?'selected':''}>Pendiente</option>
                    <option value="${Status.REVIEW}" ${r.statusId===Status.REVIEW?'selected':''}>En Revisión</option>
                    <option value="${Status.REPAIR}" ${r.statusId===Status.REPAIR?'selected':''}>En Reparación</option>
                    <option value="${Status.RESOLVED}" ${r.statusId===Status.RESOLVED?'selected':''}>Resuelto</option>
                </select>
            </td>
            <td><a href="#" onclick="map.flyTo([${r.lat}, ${r.lng}], 16); return false;" style="color: var(--primary-color);">Ver</a></td>
        `;
        
        adminTableBody.appendChild(tr);
    });

    // Add change listener to selects
    document.querySelectorAll('.status-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const id = e.target.getAttribute('data-id');
            const newStatus = e.target.value;
            e.target.setAttribute('data-status', newStatus);
            StorageManager.updateReportStatus(id, newStatus);
            renderExistingMarkers(); // Re-render map markers colors
        });
    });
}
