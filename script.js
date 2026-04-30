// ==========================================
// AUTHENTICATION & RBAC
// ==========================================
const MOCK_USERS = {
    "admin@antigravity.com": { password: "admin123", role: "admin", id: "u_admin1" },
    "ciudadano@gmail.com": { password: "123", role: "citizen", id: "u_citiz1" }
};

class AuthManager {
    static login(email, password) {
        const user = MOCK_USERS[email];
        if (user && user.password === password) {
            const sessionData = { email, role: user.role, id: user.id };
            localStorage.setItem('antigravity_session', JSON.stringify(sessionData));
            return sessionData;
        }
        return null;
    }
    static logout() {
        localStorage.removeItem('antigravity_session');
        location.reload();
    }
    static getCurrentUser() {
        return JSON.parse(localStorage.getItem('antigravity_session'));
    }
    static init() {
        const user = this.getCurrentUser();
        if (user) {
            document.body.setAttribute('data-role', user.role);
            UserReputation.updateUI();
        } else {
            document.body.setAttribute('data-role', 'guest');
        }
        return user;
    }
}

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
        ZoneManager.checkProximityAlert(report);
        return report;
    }
    static updateReportStatus(id, newStatus, resolveProofUrl = null) {
        const reports = this.getReports();
        const index = reports.findIndex(r => r.id === id);
        if (index !== -1) {
            const report = reports[index];
            report.statusId = newStatus;
            if (newStatus === Status.RESOLVED) {
                report.resolveProofUrl = resolveProofUrl;
                report.resolvedDate = new Date().toISOString();
                UserReputation.addPoints(report.userId, 10);
            }
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
const INITIAL_COORDS = [-29.411, -66.850];
const INITIAL_ZOOM = 13;
const MAX_GEO_RADIUS_KM = 400;
const DUPLICATE_RADIUS_METERS = 50;

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI/180;
    const phi2 = lat2 * Math.PI/180;
    const deltaPhi = (lat2-lat1) * Math.PI/180;
    const deltaLambda = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; 
}

function isWithinGeofence(lat, lng) {
    const distMeters = getDistance(INITIAL_COORDS[0], INITIAL_COORDS[1], lat, lng);
    return (distMeters / 1000) <= MAX_GEO_RADIUS_KM;
}

// ==========================================
// GAMIFICACIÓN Y REPUTACIÓN
// ==========================================
class UserReputation {
    static getPoints(userId) {
        const pointsDB = JSON.parse(localStorage.getItem('antigravity_points')) || {};
        return pointsDB[userId] || 0;
    }
    
    static addPoints(userId, points) {
        if (!userId || userId === 'unknown') return;
        const pointsDB = JSON.parse(localStorage.getItem('antigravity_points')) || {};
        pointsDB[userId] = (pointsDB[userId] || 0) + points;
        localStorage.setItem('antigravity_points', JSON.stringify(pointsDB));
        if (AuthManager.getCurrentUser()?.id === userId) {
            this.updateUI();
        }
    }

    static getBadge(points) {
        if (points >= 50) return { name: 'Oro', class: 'gold' };
        if (points >= 20) return { name: 'Plata', class: 'silver' };
        if (points >= 10) return { name: 'Bronce', class: 'bronze' };
        return { name: 'Novato', class: 'novice' };
    }

    static calculateWaterSaved(report) {
        if (!report.resolvedDate) return 0;
        const hours = (new Date(report.resolvedDate) - new Date(report.fecha)) / (1000 * 60 * 60);
        // Assuming average leak is 500L/h
        return Math.round(hours * 500);
    }

    static updateUI() {
        const user = AuthManager.getCurrentUser();
        if (!user || user.role !== 'citizen') return;
        
        const pts = this.getPoints(user.id);
        const badge = this.getBadge(pts);
        
        const badgeEl = document.getElementById('user-badge');
        const pointsEl = document.getElementById('user-points');
        if (badgeEl && pointsEl) {
            badgeEl.textContent = `Rango ${badge.name}`;
            badgeEl.className = `badge ${badge.class}`;
            pointsEl.textContent = `${pts} pts`;
        }
    }
}

// ==========================================
// ALERTAS DE PROXIMIDAD (GEOCERCAS)
// ==========================================
class ZoneManager {
    static ALERTS_RADIUS = 500; // meters

    static init() {
        const btnFollow = document.getElementById('follow-zone');
        if (!btnFollow) return;

        // Check if currently following
        const following = localStorage.getItem('antigravity_follow_zone');
        if (following) {
            btnFollow.classList.add('active');
        }

        btnFollow.addEventListener('click', () => {
            if (!navigator.geolocation) return alert('Geolocalización no soportada.');
            
            if (btnFollow.classList.contains('active')) {
                localStorage.removeItem('antigravity_follow_zone');
                btnFollow.classList.remove('active');
                this.showToast('Has dejado de seguir la zona.', 'info');
                return;
            }

            navigator.geolocation.getCurrentPosition(pos => {
                const zone = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                localStorage.setItem('antigravity_follow_zone', JSON.stringify(zone));
                btnFollow.classList.add('active');
                
                // Request Notification Permission
                if ("Notification" in window && Notification.permission !== "granted") {
                    Notification.requestPermission();
                }
                
                this.showToast('Comenzaste a seguir tu zona actual (500m).', 'success');
            }, err => alert('No se pudo obtener tu ubicación para seguir la zona.'));
        });
    }

    static checkProximityAlert(newReport) {
        const zoneStr = localStorage.getItem('antigravity_follow_zone');
        if (!zoneStr) return;
        const zone = JSON.parse(zoneStr);
        
        const dist = getDistance(zone.lat, zone.lng, newReport.lat, newReport.lng);
        if (dist <= this.ALERTS_RADIUS) {
            this.fireAlert(`¡Nuevo incidente a ${Math.round(dist)}m! Tipo: ${newReport.tipo}`);
        }
    }

    static fireAlert(message) {
        // Try Native Push Notification
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Antigravity - Alerta de Zona", { body: message });
        } else {
            // Fallback Visual Toast
            this.showToast(message, 'warning');
        }
    }

    static showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        
        let icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12.01" y2="16"></line><line x1="12" y1="8" x2="12" y2="12"></line></svg>';
        
        toast.innerHTML = `${icon} <span>${message}</span>`;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }
}

// ==========================================
// MAPA E INICIALIZACIÓN
// ==========================================
const map = L.map('map', { center: INITIAL_COORDS, zoom: INITIAL_ZOOM, zoomControl: false });
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

let currentMarker = null;
let drawnMarkers = [];
const coordsInput = document.getElementById('coordinates');

function renderExistingMarkers() {
    drawnMarkers.forEach(m => map.removeLayer(m));
    drawnMarkers = [];

    const currentUser = AuthManager.getCurrentUser();
    let reports = StorageManager.getReports();
    
    if (currentUser && currentUser.role === 'citizen') {
        reports = reports.filter(r => r.userId === currentUser.id);
    } else if (!currentUser) {
        reports = []; 
    }

    reports.forEach(r => {
        let iconClass = 'marker-pending';
        if(r.statusId === Status.REVIEW) iconClass = 'marker-review';
        if(r.statusId === Status.REPAIR) iconClass = 'marker-repair';
        if(r.statusId === Status.RESOLVED) iconClass = 'marker-resolved';

        let popupContent = `<b>${r.tipo.toUpperCase()}</b><br>${r.descripcion}<br>Estado: ${r.statusId}<br>Afectados: ${r.affectedCount || 1}`;
        
        // Add Before/After Photos to popup if available
        if (r.fotoUrl) popupContent += `<br><img src="${r.fotoUrl}" style="max-width:100%; margin-top:5px; border-radius:4px;" alt="Antes">`;
        if (r.resolveProofUrl) popupContent += `<br><img src="${r.resolveProofUrl}" style="max-width:100%; margin-top:5px; border-radius:4px;" alt="Después">`;
        
        // Add Street View Button
        popupContent += `<br><button class="btn-outline" style="margin-top:10px; width:100%; padding:5px; font-size:0.8rem;" onclick="openStreetView(${r.lat}, ${r.lng})">Ver en Street View</button>`;

        const marker = L.marker([r.lat, r.lng]).addTo(map).bindPopup(popupContent);
        marker.on('add', function() { if(marker._icon) L.DomUtil.addClass(marker._icon, iconClass); });
        drawnMarkers.push(marker);
    });
}

function updateMarkerPosition(lat, lng) {
    coordsInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    const geoValidationMsg = document.getElementById('geo-validation');
    if(geoValidationMsg) {
        isWithinGeofence(lat, lng) ? geoValidationMsg.classList.add('hidden') : geoValidationMsg.classList.remove('hidden');
    }

    if (currentMarker) {
        currentMarker.setLatLng([lat, lng]);
    } else {
        currentMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
        currentMarker.on('dragend', e => {
            const pos = e.target.getLatLng();
            updateMarkerPosition(pos.lat, pos.lng);
        });
    }
}

map.on('click', function(e) {
    const user = AuthManager.getCurrentUser();
    if (!user || user.role === 'guest') return;
    updateMarkerPosition(e.latlng.lat, e.latlng.lng);
});

// ==========================================
// MODULOS UI (FORMULARIOS, STREET VIEW)
// ==========================================
// Geolocalización
document.getElementById('get-location')?.addEventListener('click', () => {
    if (!navigator.geolocation) return alert('No soportado.');
    navigator.geolocation.getCurrentPosition(
        pos => {
            map.flyTo([pos.coords.latitude, pos.coords.longitude], 16);
            updateMarkerPosition(pos.coords.latitude, pos.coords.longitude);
        },
        err => alert('Error obteniendo ubicación.'),
        { enableHighAccuracy: true }
    );
});

// Envio de Formulario
const form = document.getElementById('incident-form');
let pendingSubmission = null;

form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const latLng = currentMarker ? currentMarker.getLatLng() : null;
    if (!latLng) return alert('Seleccione un punto en el mapa.');
    if (!isWithinGeofence(latLng.lat, latLng.lng)) return alert('Fuera de límite permitido (La Rioja).');

    const currentUser = AuthManager.getCurrentUser();
    const reportData = {
        id: "rep_" + Date.now() + Math.random().toString(36).substr(2, 5),
        tipo: document.getElementById('problem-type').value,
        descripcion: document.getElementById('description').value,
        fotoUrl: document.getElementById('photo-url').value,
        lat: latLng.lat,
        lng: latLng.lng,
        fecha: new Date().toISOString(),
        statusId: Status.PENDING,
        affectedCount: 1,
        userId: currentUser ? currentUser.id : 'unknown'
    };

    const dup = StorageManager.getReports().find(r => 
        r.tipo === reportData.tipo && r.statusId !== Status.RESOLVED &&
        getDistance(reportData.lat, reportData.lng, r.lat, r.lng) <= DUPLICATE_RADIUS_METERS
    );

    if (dup) {
        document.getElementById('dup-type').textContent = dup.tipo.toUpperCase();
        document.getElementById('duplicate-modal').classList.remove('hidden');
        pendingSubmission = { newReport: reportData, existingId: dup.id };
    } else {
        submitReport(reportData);
    }
});

function submitReport(data) {
    StorageManager.addReport(data);
    ZoneManager.showToast('Reporte enviado con éxito.', 'success');
    form.reset();
    if (currentMarker) { map.removeLayer(currentMarker); currentMarker = null; }
    coordsInput.value = '';
    renderExistingMarkers();
    if(document.getElementById('admin-panel') && !document.getElementById('admin-panel').classList.contains('hidden')) {
        renderAdminTable();
    }
}

document.getElementById('btn-join-report')?.addEventListener('click', () => {
    if(pendingSubmission) {
        StorageManager.joinReport(pendingSubmission.existingId);
        ZoneManager.showToast('Te has unido al reporte existente.', 'success');
        document.getElementById('duplicate-modal').classList.add('hidden');
        form.reset();
        pendingSubmission = null;
    }
});
document.getElementById('btn-force-report')?.addEventListener('click', () => {
    if(pendingSubmission) submitReport(pendingSubmission.newReport);
    document.getElementById('duplicate-modal').classList.add('hidden');
});
document.getElementById('btn-cancel-report')?.addEventListener('click', () => {
    document.getElementById('duplicate-modal').classList.add('hidden');
    pendingSubmission = null;
});

// Street View
window.openStreetView = function(lat, lng) {
    const svModal = document.getElementById('street-view-modal');
    const svContainer = document.getElementById('sv-iframe-container');
    const svLink = document.getElementById('sv-external-link');
    
    // Fallback external link
    svLink.href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
    
    // Generic iframe fallback (often blocked by Google X-Frame-Options without an API key, but we attempt it)
    svContainer.innerHTML = `<iframe width="100%" height="100%" frameborder="0" style="border:0" src="https://maps.google.com/maps?q=${lat},${lng}&hl=es&z=14&amp;output=embed"></iframe>`;
    
    svModal.classList.remove('hidden');
};
document.getElementById('btn-close-sv')?.addEventListener('click', () => {
    document.getElementById('street-view-modal').classList.add('hidden');
    document.getElementById('sv-iframe-container').innerHTML = ''; // clear iframe
});

// ==========================================
// PANEL DE ADMINISTRADOR Y DASHBOARD
// ==========================================
let mttrChartInstance = null;
let pendingResolveId = null;

const adminPanel = document.getElementById('admin-panel');
document.getElementById('admin-toggle')?.addEventListener('click', () => {
    adminPanel.classList.remove('hidden');
    renderAdminTable();
});
document.getElementById('close-admin')?.addEventListener('click', () => adminPanel.classList.add('hidden'));

// Tabs Logic
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(e.target.dataset.tab).classList.add('active');
        
        if (e.target.dataset.tab === 'tab-dashboard') renderDashboard();
    });
});

function renderAdminTable() {
    const filterType = document.getElementById('filter-type');
    if(!filterType) return;
    const filter = filterType.value;
    const reports = StorageManager.getReports();
    const filtered = filter === 'all' ? reports : reports.filter(r => r.tipo === filter);
    filtered.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));

    const tbody = document.querySelector('#admin-table tbody');
    tbody.innerHTML = '';
    filtered.forEach(r => {
        const typeStr = r.tipo.replace('-', ' ').toUpperCase();
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>...${r.id.slice(-5)}</td>
            <td>${typeStr}</td>
            <td>${new Date(r.fecha).toLocaleDateString()}</td>
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
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.status-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const id = e.target.getAttribute('data-id');
            const newStatus = e.target.value;
            
            if (newStatus === Status.RESOLVED) {
                e.target.value = e.target.getAttribute('data-status');
                pendingResolveId = id;
                document.getElementById('resolve-modal').classList.remove('hidden');
            } else {
                e.target.setAttribute('data-status', newStatus);
                StorageManager.updateReportStatus(id, newStatus);
                renderExistingMarkers();
            }
        });
    });
}

// Proof of resolution modal
document.getElementById('btn-confirm-resolve')?.addEventListener('click', () => {
    const proofUrl = document.getElementById('resolve-photo-url').value;
    if (!proofUrl) return alert('La URL de la foto es obligatoria para validar la resolución.');
    
    StorageManager.updateReportStatus(pendingResolveId, Status.RESOLVED, proofUrl);
    document.getElementById('resolve-modal').classList.add('hidden');
    document.getElementById('resolve-photo-url').value = '';
    pendingResolveId = null;
    
    renderAdminTable();
    renderExistingMarkers();
    ZoneManager.showToast('Incidente resuelto y validado.', 'success');
});
document.getElementById('btn-cancel-resolve')?.addEventListener('click', () => {
    document.getElementById('resolve-modal').classList.add('hidden');
    pendingResolveId = null;
});

// Dashboard Logic
function renderDashboard() {
    const reports = StorageManager.getReports();
    const resolved = reports.filter(r => r.statusId === Status.RESOLVED && r.resolvedDate);
    
    let totalHours = 0;
    let totalWaterSaved = 0;
    const mttrDataByMonth = {}; 

    resolved.forEach(r => {
        const h = (new Date(r.resolvedDate) - new Date(r.fecha)) / (1000 * 60 * 60);
        totalHours += h;
        totalWaterSaved += UserReputation.calculateWaterSaved(r);

        const month = new Date(r.resolvedDate).toLocaleString('default', { month: 'short' });
        if(!mttrDataByMonth[month]) mttrDataByMonth[month] = { sum: 0, count: 0 };
        mttrDataByMonth[month].sum += h;
        mttrDataByMonth[month].count += 1;
    });

    const avgMttr = resolved.length ? (totalHours / resolved.length) : 0;
    document.getElementById('mttr-value').textContent = `${avgMttr.toFixed(1)} hrs`;
    document.getElementById('water-saved-value').textContent = `${totalWaterSaved.toLocaleString()} L`;

    // Chart.js
    const ctx = document.getElementById('mttrChart');
    if (!ctx) return;
    
    if (mttrChartInstance) mttrChartInstance.destroy();

    const labels = Object.keys(mttrDataByMonth);
    const data = labels.map(l => mttrDataByMonth[l].sum / mttrDataByMonth[l].count);

    mttrChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length ? labels : ['Sin datos'],
            datasets: [{
                label: 'MTTR (Horas)',
                data: data.length ? data : [0],
                backgroundColor: 'rgba(0, 86, 179, 0.6)',
                borderColor: 'rgba(0, 86, 179, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } }
        }
    });
}

// ==========================================
// INIT APP
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    AuthManager.init();
    ZoneManager.init();
    
    const loginForm = document.getElementById('login-form');
    loginForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const pass = document.getElementById('login-password').value;
        
        const user = AuthManager.login(email, pass);
        if (user) {
            document.getElementById('login-error').classList.add('hidden');
            AuthManager.init();
            renderExistingMarkers(); 
            loginForm.reset();
        } else {
            document.getElementById('login-error').classList.remove('hidden');
        }
    });
    
    document.getElementById('btn-logout')?.addEventListener('click', () => AuthManager.logout());
    
    renderExistingMarkers();
});
