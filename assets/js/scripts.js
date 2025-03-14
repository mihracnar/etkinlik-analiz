//-----------------------------------------------------------------------------
// 1. MAP INITIALIZATION AND BASE LAYERS
//-----------------------------------------------------------------------------

// Map initialization
const map = L.map('map', {
    center: [41.0082, 28.9784], // İstanbul koordinatları
    zoom: 12,
    zoomControl: false
});

// Base layers
const cartoLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '©OpenStreetMap, ©CartoDB',
    maxZoom: 19
}).addTo(map);

const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
});

let currentBaseLayer = cartoLight;

//-----------------------------------------------------------------------------
// 2. LAYER DEFINITIONS
//-----------------------------------------------------------------------------

// Heatmap layer - kullanıcı konumları için
const heat = L.heatLayer([], {
    radius: 20,
    blur: 15,
    maxZoom: 19,
    max: 10,
    minOpacity: 0.4,
    gradient: {
        0.1: 'blue',
        0.4: 'cyan',
        0.6: 'lime',
        0.8: 'yellow',
        1.0: 'red'
    }
}).addTo(map);

const venueLayer = L.layerGroup().addTo(map);
const userPointLayer = L.layerGroup().addTo(map);
const svgOverlay = L.svg().addTo(map);

//-----------------------------------------------------------------------------
// 3. DATA STRUCTURES AND HELPER FUNCTIONS
//-----------------------------------------------------------------------------

let userData = new Map();
let venueData = new Map();
let eventConnections = [];

function isValidCoordinate(coord) {
    return Array.isArray(coord) && 
           coord.length === 2 && 
           typeof coord[0] === 'number' && 
           typeof coord[1] === 'number' &&
           coord[0] >= -180 && coord[0] <= 180 && 
           coord[1] >= -90 && coord[1] <= 90;
}

function getEventTypeColor(eventType) {
    const colorMap = {
        'Konser': '#FF4136',
        'Tiyatro': '#2ECC40',
        'Festival': '#FF851B',
        'Sergi': '#7FDBFF',
        'Atölye': '#B10DC9',
        'default': '#AAAAAA'
    };
    return colorMap[eventType] || colorMap.default;
}

function getDistanceCategory(distance) {
    if (distance <= 5) return 'low';
    if (distance <= 10) return 'medium';
    return 'high';
}

//-----------------------------------------------------------------------------
// 4. DATA LOADING AND PROCESSING
//-----------------------------------------------------------------------------

function showLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
    }
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.style.display = 'none';
            overlay.style.opacity = '1';
        }, 500);
        console.log('Loading overlay hidden');
    }
}

// Sayfa tamamen yüklendiğinde de kontrol et ve zorla kaldır
document.addEventListener('DOMContentLoaded', function() {
    // Sayfa tamamen yüklendikten 5 saniye sonra zorla kaldır
    setTimeout(function() {
        hideLoadingOverlay();
        console.log('Force hiding overlay after timeout');
    }, 5000);
});

async function loadData() {
    showLoadingOverlay(); // Yükleme başladığında overlay'i göster
    
    try {
        console.log('Starting data load...');
        
        // Veri yapısı validasyon fonksiyonları
        const isValidGeoJSON = (data) => {
            return data && 
                   typeof data === 'object' && 
                   data.type === 'FeatureCollection' && 
                   Array.isArray(data.features);
        };

        const isValidUsersFeature = (feature) => {
            return feature && 
                   feature.type === 'Feature' &&
                   feature.geometry?.coordinates?.length === 2 &&
                   feature.properties?.user_properties?.userId &&
                   feature.properties?.user_properties?.age &&
                   feature.properties?.activity_properties?.u_monthly_avg_event_count;
        };

        const isValidPlacesFeature = (feature) => {
            return feature &&
                   feature.type === 'Feature' &&
                   feature.geometry?.coordinates?.length === 2 &&
                   feature.properties?.venue_properties?.venueId &&
                   feature.properties?.venue_properties?.name;
        };

        const isValidEvent = (event) => {
            return event &&
                   typeof event === 'object' &&
                   event.userId &&
                   event.venueId &&
                   event.eventType &&
                   typeof event.visitCount === 'number';
        };

        let usersGeoJSON, placesGeoJSON, eventsData;

        // Users data loading
        try {
            const usersResponse = await fetch('assets/data/users.geojson');
            if (!usersResponse.ok) throw new Error(`HTTP error! status: ${usersResponse.status}`);
            usersGeoJSON = await usersResponse.json();
            
            if (!isValidGeoJSON(usersGeoJSON)) {
                console.warn('Users data is not in valid GeoJSON format');
                throw new Error('Invalid GeoJSON format');
            }

            usersGeoJSON.features = usersGeoJSON.features.filter(feature => {
                if (!isValidUsersFeature(feature)) {
                    console.warn('Skipping invalid user feature:', feature);
                    return false;
                }
                return true;
            });

            console.log(`Successfully validated ${usersGeoJSON.features.length} users`);
        } catch (error) {
            console.warn('Using sample users data due to:', error);
            usersGeoJSON = sampleData.users;
        }

        // Places data loading
        try {
            const placesResponse = await fetch('assets/data/places.geojson');
            if (!placesResponse.ok) throw new Error(`HTTP error! status: ${placesResponse.status}`);
            placesGeoJSON = await placesResponse.json();
            
            // veri validasyonu...
        } catch (error) {
            console.error('Failed to load places data:', error);
            placesGeoJSON = { type: "FeatureCollection", features: [] }; // Boş GeoJSON yapısı
            alert('Mekan verisi yüklenemedi. Lütfen daha sonra tekrar deneyin.');
        }

        // Events data loading
        try {
            const eventsResponse = await fetch('assets/data/events.json');
            if (!eventsResponse.ok) throw new Error(`HTTP error! status: ${eventsResponse.status}`);
            eventsData = await eventsResponse.json();
            
            if (!Array.isArray(eventsData)) {
                console.warn('Events data is not an array');
                throw new Error('Invalid events data format');
            }

            eventsData = eventsData.filter(event => {
                if (!isValidEvent(event)) {
                    console.warn('Skipping invalid event:', event);
                    return false;
                }
                return true;
            });

            console.log(`Successfully validated ${eventsData.length} events`);
        } catch (error) {
            console.warn('Using sample events data due to:', error);
            eventsData = sampleData.events;
        }

        // Clear existing data
        userData.clear();
        venueData.clear();
        eventConnections = [];

        // Process validated users
        console.log('Processing users...');
        usersGeoJSON.features.forEach(user => {
            userData.set(user.properties.user_properties.userId, {
                coordinates: user.geometry.coordinates,
                ...user.properties
            });
        });

        // Process validated venues
        console.log('Processing venues...');
        placesGeoJSON.features.forEach(place => {
            const venueId = place.properties.venue_properties.venueId;
            venueData.set(venueId, {
                coordinates: place.geometry.coordinates,
                ...place.properties
            });
            addVenueMarker(place);
        });

        // Process validated events
        console.log('Processing events...');
        eventConnections = eventsData.filter(event => 
            userData.has(event.userId) && venueData.has(event.venueId)
        );

        // Log final processed data counts
        console.log('Data processing complete:', {
            users: userData.size,
            venues: venueData.size,
            events: eventConnections.length
        });

        // Update UI
        updateVenueFilterOptions();
        updateDistrictFilters();
        updateAllFilters();
        updateMap();
        
        // Kullanıcı verisi yüklendiyse overlay'i gizle
        if (userData.size > 0) {
            console.log('User data loaded, hiding overlay');
            hideLoadingOverlay();
        } else {
            // Eğer kullanıcı verisi yüklenemezse, 3 saniye sonra gizle
            setTimeout(hideLoadingOverlay, 3000);
        }

    } catch (error) {
        console.error('Fatal error in data processing:', error);
        hideLoadingOverlay(); // Hata durumunda da overlay'i gizle
        alert('Veri yüklenirken bir hata oluştu. Lütfen sayfayı yenileyin.');
    }
}

// Label çakışmasını kontrol eden fonksiyon
function isOverlapping(marker1, marker2) {
    const pos1 = map.latLngToContainerPoint(marker1.getLatLng());
    const pos2 = map.latLngToContainerPoint(marker2.getLatLng());
    
    // Label boyutları
    const width = 120;
    const height = 20;
    const buffer = 10;

    return Math.abs(pos1.x - pos2.x) < (width + buffer) && 
           Math.abs(pos1.y - pos2.y) < (height + buffer);
}

// Label'ları güncelleme fonksiyonu
function updateLabels() {
    const currentZoom = map.getZoom();
    if (currentZoom < 14) {
        // Zoom seviyesi düşükse tüm label'ları gizle
        venueLayer.eachLayer(marker => {
            if (marker.labelMarker && map.hasLayer(marker.labelMarker)) {
                map.removeLayer(marker.labelMarker);
            }
        });
        return;
    }

    // Görünür alandaki marker'ları al
    const bounds = map.getBounds();
    const visibleMarkers = [];
    venueLayer.eachLayer(marker => {
        if (marker.labelMarker && bounds.contains(marker.getLatLng())) {
            visibleMarkers.push(marker);
        }
    });

    // Çakışmaları kontrol et ve görünür label'ları belirle
    const visibleLabels = new Set();
    visibleMarkers.forEach((marker1, index) => {
        let canShow = true;
        
        // Önceden görünür olarak işaretlenmiş label'larla çakışma kontrolü
        for (let i = 0; i < index; i++) {
            const marker2 = visibleMarkers[i];
            if (visibleLabels.has(marker2) && isOverlapping(marker1, marker2)) {
                canShow = false;
                break;
            }
        }

        // Label'ı göster veya gizle
        if (canShow) {
            visibleLabels.add(marker1);
            if (!map.hasLayer(marker1.labelMarker)) {
                marker1.labelMarker.addTo(map);
            }
        } else if (map.hasLayer(marker1.labelMarker)) {
            map.removeLayer(marker1.labelMarker);
        }
    });
}

// Map event listener'ları
map.on('zoomend moveend', updateLabels);


// addVenueMarker fonksiyonunu güncelle
function addVenueMarker(place) {
    const venueIcon = L.divIcon({
        className: 'custom-icon',
        html: '<div style="width: 10px; height: 10px; background-color: black; border-radius: 50%;"></div>',
        iconSize: [10, 10],
        iconAnchor: [5, 5],
        popupAnchor: [0, -10]
    });

    const coords = place.geometry.coordinates;
    const marker = L.marker([coords[1], coords[0]], {
        icon: venueIcon
    });

    const props = place.properties.venue_properties;
    
    // Label oluştur
    const label = L.divIcon({
        className: 'map-label',
        html: `<div class="label-content">${props.name}</div>`,
        iconSize: [120, 20],
        iconAnchor: [60, -10]
    });

    // Label marker'ı oluştur
    const labelMarker = L.marker([coords[1], coords[0]], {
        icon: label,
        zIndexOffset: 1000
    });

    marker.bindPopup(`
        <div class="venue-popup">
            <h3 class="font-bold text-lg mb-2">${props.name}</h3>
            <p class="text-sm text-gray-600 mb-1">${props.address}</p>
            <p class="text-sm text-gray-600">Aylık Ort. Etkinlik: ${props.v_monthly_avg_event_count}</p>
        </div>
    `);

    marker.venueId = props.venueId;
    marker.labelMarker = labelMarker;
    marker.addTo(venueLayer);
}

// Map zoom event listener'ı ekleyelim
map.on('zoomend', function() {
    const currentZoom = map.getZoom();
    
    // Tüm venue marker'ları kontrol et
    venueLayer.eachLayer(marker => {
        if (marker.labelMarker) {
            if (currentZoom >= 5) {
                if (!map.hasLayer(marker.labelMarker)) {
                    marker.labelMarker.addTo(map);
                }
            } else {
                if (map.hasLayer(marker.labelMarker)) {
                    map.removeLayer(marker.labelMarker);
                }
            }
        }
    });
});



//-----------------------------------------------------------------------------
// 5. FILTERING AND DATA PROCESSING
//-----------------------------------------------------------------------------

function getFilteredEvents() {
    const categoryFilter = document.getElementById('categoryFilter')?.value || 'all';
    const distanceFilter = document.getElementById('distanceFilter')?.value || 'all';
    const venueFilter = document.getElementById('venueFilter')?.value || 'all';
    const venueDistrictFilter = document.getElementById('venueDistrictFilter')?.value || 'all';

    // Önce filtrelenmiş kullanıcıları al
    const filteredUsers = getFilteredUsers();
    const filteredUserIds = new Set(filteredUsers.map(user => user.user_properties.userId));

    return eventConnections.filter(event => {
        // Kullanıcı filtrelerine göre kontrol
        if (!filteredUserIds.has(event.userId)) return false;

        const venue = venueData.get(event.venueId);
        if (!venue) return false;

        // Mekan ve etkinlik filtreleri
        const categoryMatch = categoryFilter === 'all' || event.eventType.toLowerCase() === categoryFilter;
        const distanceMatch = distanceFilter === 'all' || getDistanceCategory(event.distance) === distanceFilter;
        const venueMatch = venueFilter === 'all' || event.venueId === venueFilter;
        const venueDistrictMatch = venueDistrictFilter === 'all' || 
            venue.venue_properties.v_neighbourhood_district === venueDistrictFilter;

        return categoryMatch && distanceMatch && venueMatch && venueDistrictMatch;
    });
}

function getFilteredUsers() {
    const ageFilter = document.getElementById('ageFilter')?.value || 'all';
    const userDistrictFilter = document.getElementById('userDistrictFilter')?.value || '';
    const categoryFilter = document.getElementById('categoryFilter')?.value || 'all';
    const venueFilter = document.getElementById('venueFilter')?.value || 'all';

    return Array.from(userData.values()).filter(user => {
        // Temel kullanıcı filtreleri
        const ageMatch = ageFilter === 'all' || user.user_properties.age === ageFilter;
        
        // Kullanıcı ilçesi için "all" kontrolü yok, direkt karşılaştırma yapılıyor
        const districtMatch = user.user_properties.u_neighbourhood_district === userDistrictFilter;

        // Etkinlik kategorisi kontrolü
        let categoryMatch = true;
        if (categoryFilter !== 'all') {
            const userEvents = eventConnections.filter(event => 
                event.userId === user.user_properties.userId && 
                event.eventType.toLowerCase() === categoryFilter
            );
            categoryMatch = userEvents.length > 0;
        }

        // Mekan filtresi kontrolü
        let venueMatch = true;
        if (venueFilter !== 'all') {
            const userVenueEvents = eventConnections.filter(event => 
                event.userId === user.user_properties.userId && 
                event.venueId === venueFilter
            );
            venueMatch = userVenueEvents.length > 0;
        }

        return ageMatch && districtMatch && categoryMatch && venueMatch;
    });
}

// tempEventTypeFilters boş bir obje olarak kalıyor, tamamen kaldırmadan
let tempEventTypeFilters = {};


function aggregateLineData(filteredEvents) {
    const aggregatedLines = new Map();
    
    filteredEvents.forEach(event => {
        const user = userData.get(event.userId);
        const venue = venueData.get(event.venueId);
        
        if (!user || !venue) return;
        
        const destKey = `${venue.coordinates[1]},${venue.coordinates[0]}`;
        
        if (!aggregatedLines.has(destKey)) {
            aggregatedLines.set(destKey, {
                startPoints: [],
                endLat: venue.coordinates[1],
                endLng: venue.coordinates[0],
                totalVisits: 0,
                eventTypes: new Map(),
                venueId: event.venueId,
                lineCount: 0
            });
        }
        
        const lineData = aggregatedLines.get(destKey);
        lineData.startPoints.push({
            lat: user.coordinates[1],
            lng: user.coordinates[0],
            visitCount: event.visitCount,
            eventType: event.eventType
        });
        
        lineData.totalVisits += event.visitCount;
        lineData.lineCount++;
        
        const currentCount = lineData.eventTypes.get(event.eventType) || 0;
        lineData.eventTypes.set(event.eventType, currentCount + event.visitCount);
    });
    
    aggregatedLines.forEach(lineData => {
        let maxCount = 0;
        let dominantType = 'default';
        
        lineData.eventTypes.forEach((count, type) => {
            if (count > maxCount) {
                maxCount = count;
                dominantType = type;
            }
        });
        
        lineData.dominantEventType = dominantType;
    });
    
    return aggregatedLines;
}

function updateDistrictFilters() {
    // Kullanıcı ilçelerini topla ve filtre seçeneklerini güncelle
    const userDistricts = new Set();
    userData.forEach(user => {
        if (user.user_properties?.u_neighbourhood_district) {
            userDistricts.add(user.user_properties.u_neighbourhood_district);
        }
    });

    const userDistrictFilter = document.getElementById('userDistrictFilter');
    userDistrictFilter.innerHTML = ''; // "Tümü" seçeneği kaldırıldı
    
    // İlçeleri sırala
    const sortedDistricts = [...userDistricts].sort();
    
    // Fatih ilçesi var mı kontrol et
    const hasFatih = sortedDistricts.includes('Fatih');
    
    sortedDistricts.forEach((district) => {
        const option = document.createElement('option');
        option.value = district;
        option.textContent = district;
        
        // Eğer ilçe Fatih ise seçili yap
        if (district === 'Fatih') {
            option.selected = true;
        }
        // Fatih yoksa ilk öğeyi seçili yap (orijinal davranış)
        else if (!hasFatih && district === sortedDistricts[0]) {
            option.selected = true;
        }
        
        userDistrictFilter.appendChild(option);
    });

    // Mekan ilçelerini topla ve filtre seçeneklerini güncelle
    // Bu bölümde "Tümü" seçeneğini koruyoruz
    const venueDistricts = new Set();
    venueData.forEach(venue => {
        if (venue.venue_properties?.v_neighbourhood_district) {
            venueDistricts.add(venue.venue_properties.v_neighbourhood_district);
        }
    });

    const venueDistrictFilter = document.getElementById('venueDistrictFilter');
    venueDistrictFilter.innerHTML = '<option value="all">Tümü</option>';
    [...venueDistricts].sort().forEach(district => {
        const option = document.createElement('option');
        option.value = district;
        option.textContent = district;
        venueDistrictFilter.appendChild(option);
    });
}


const eventTypes = {
    "atolye": "Atölye",
    "festival": "Festival",
    "gezi": "Gezi",
    "konser": "Konser",
    "sahne_gosterisi": "Sahne Gösterisi",
    "sergi": "Sergi",
    "sinema": "Sinema",
    "sinema_soylesi": "Sinema Söyleşi",
    "soylesi": "Söyleşi",
    "tiyatro": "Tiyatro",
    "cocuk": "Çocuk"
};

// Tüm filtreleri güncelleme fonksiyonu
function updateAllFilters() {
    updateDistrictFilters();
    updateAgeFilters();
    updateEventCategoryFilters();
    updateDistanceFilters();
    updateVenueFilterOptions();
}


// Yaş filtrelerini güncelleme
function updateAgeFilters() {
    const ageRanges = new Set();
    userData.forEach(user => {
        if (user.user_properties?.age) {
            ageRanges.add(user.user_properties.age);
        }
    });

    const ageFilter = document.getElementById('ageFilter');
    ageFilter.innerHTML = '<option value="all">Tümü</option>';
    
    // Gelen yaş aralıklarını direkt olarak kullan
    [...ageRanges].sort().forEach(ageRange => {
        const option = document.createElement('option');
        option.value = ageRange;
        option.textContent = ageRange;
        ageFilter.appendChild(option);
    });
}

// Etkinlik kategorilerini güncelleme
function updateEventCategoryFilters() {
    const categories = new Set();
    eventConnections.forEach(event => {
        if (event.eventType) {
            categories.add(event.eventType.toLowerCase());
        }
    });

    const categoryFilter = document.getElementById('categoryFilter');
    categoryFilter.innerHTML = '<option value="all">Tümü</option>';
    
    [...categories].sort().forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category.charAt(0).toUpperCase() + category.slice(1);
        categoryFilter.appendChild(option);
    });
}

// Mesafe filtrelerini güncelleme
function updateDistanceFilters() {
    const distances = new Set();
    eventConnections.forEach(event => {
        if (event.distance) {
            distances.add(getDistanceCategory(event.distance));
        }
    });

    const distanceFilter = document.getElementById('distanceFilter');
    distanceFilter.innerHTML = '<option value="all">Tümü</option>';
    
    const distanceLabels = {
        'low': 'Düşük (0-5 km)',
        'medium': 'Orta (5-10 km)',
        'high': 'Yüksek (10+ km)'
    };

    [...distances].sort().forEach(distance => {
        if (distanceLabels[distance]) {
            const option = document.createElement('option');
            option.value = distance;
            option.textContent = distanceLabels[distance];
            distanceFilter.appendChild(option);
        }
    });
}


function resetFilters() {
    // Select elemanlarını sıfırla
    document.getElementById('userDistrictFilter').value = 'all';
    document.getElementById('ageFilter').value = 'all';
    document.getElementById('venueDistrictFilter').value = 'all';
    document.getElementById('venueFilter').value = 'all';
    document.getElementById('categoryFilter').value = 'all';
    document.getElementById('distanceFilter').value = 'all';

    // tempEventTypeFilters'ı sıfırla
    tempEventTypeFilters = {};

    // Haritayı güncelle
    updateMap();
}

//-----------------------------------------------------------------------------
// 6. VISUALIZATION AND UPDATE FUNCTIONS
//-----------------------------------------------------------------------------

function createCurvedLine(startPoint, endPoint, eventData) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    const markerId = `arrow-${startPoint[0]}-${startPoint[1]}`;
    
    marker.setAttribute('id', markerId);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '7');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '4');
    marker.setAttribute('markerHeight', '4');
    marker.setAttribute('orient', 'auto-start-reverse');
    
    const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    arrowPath.setAttribute('fill', getEventTypeColor(eventData.eventType));
    marker.appendChild(arrowPath);
    
    const dx = endPoint[1] - startPoint[1];
    const dy = endPoint[0] - startPoint[0];
    
    const offsetRatio = 0.015;
    const adjustedEndPoint = [
        endPoint[0] - (dy * offsetRatio),
        endPoint[1] - (dx * offsetRatio)
    ];
    
    const controlPoint = [
        (startPoint[0] + adjustedEndPoint[0]) / 2 + dx * 0.25,
        (startPoint[1] + adjustedEndPoint[1]) / 2 + dy * 0.25
    ];

    const start = map.latLngToLayerPoint([startPoint[0], startPoint[1]]);
    const end = map.latLngToLayerPoint([adjustedEndPoint[0], adjustedEndPoint[1]]);
    const control = map.latLngToLayerPoint([controlPoint[0], controlPoint[1]]);

    const d = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
    
    const colorGradientId = `color-gradient-${start.x}-${start.y}`;
    const widthGradientId = `width-gradient-${start.x}-${start.y}`;
    
    const colorGradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    colorGradient.setAttribute('id', colorGradientId);
    colorGradient.setAttribute('gradientUnits', 'userSpaceOnUse');
    colorGradient.setAttribute('x1', start.x);
    colorGradient.setAttribute('y1', start.y);
    colorGradient.setAttribute('x2', end.x);
    colorGradient.setAttribute('y2', end.y);

    const widthGradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    widthGradient.setAttribute('id', widthGradientId);
    widthGradient.setAttribute('gradientUnits', 'userSpaceOnUse');
    widthGradient.setAttribute('x1', start.x);
    widthGradient.setAttribute('y1', start.y);
    widthGradient.setAttribute('x2', end.x);
    widthGradient.setAttribute('y2', end.y);

    const baseWeight = Math.max(2, eventData.visitCount);
    const maxWidth = Math.min(8, baseWeight * 1.5);

    const colorStops = [
        ['0%', '0.2'],
        ['50%', '0.6'],
        ['100%', '1']
    ];

    const widthStops = [
        ['0%', maxWidth * 0.5],
        ['15%', maxWidth * 0.8],
        ['50%', maxWidth],
        ['85%', maxWidth * 0.8],
        ['100%', maxWidth * 0.5]
    ];

    colorStops.forEach(([offset, opacity]) => {
        const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('stop-color', getEventTypeColor(eventData.eventType));
        stop.setAttribute('stop-opacity', opacity);
        colorGradient.appendChild(stop);
    });

    widthStops.forEach(([offset, width]) => {
        const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('stop-width', width);
        widthGradient.appendChild(stop);
    });

    defs.appendChild(marker);
    defs.appendChild(colorGradient);
    defs.appendChild(widthGradient);
    svgOverlay._container.appendChild(defs);
    
    path.setAttribute('d', d);
    path.setAttribute('stroke', `url(#${colorGradientId})`);
    path.setAttribute('stroke-width', maxWidth);
    path.setAttribute('fill', 'none');
    path.setAttribute('class', 'curved-line');
    path.setAttribute('marker-end', `url(#${markerId})`);
    
    path.style.strokeWidth = `url(#${widthGradientId})`;
    
    return path;
}

function updateLines(filteredEvents) {
    const container = svgOverlay._container;
    container.innerHTML = '';

    const aggregatedLines = aggregateLineData(filteredEvents);
    
    aggregatedLines.forEach((lineData, destKey) => {
        lineData.startPoints.forEach(startPoint => {
            const line = createCurvedLine(
                [startPoint.lat, startPoint.lng],
                [lineData.endLat, lineData.endLng],
                {
                    eventType: startPoint.eventType,
                    visitCount: startPoint.visitCount,
                    totalVisits: lineData.totalVisits,
                    lineCount: lineData.lineCount
                }
            );
            container.appendChild(line);
        });
    });
}

function updateVenueFilterOptions() {
    const venueSelect = document.getElementById('venueFilter');
    const selectedVenueDistrict = document.getElementById('venueDistrictFilter')?.value || 'all';
    
    if (venueSelect) {
        venueSelect.innerHTML = '<option value="all">Tümü</option>';
        
        venueData.forEach((venue, venueId) => {
            const venueDistrict = venue.venue_properties.v_neighbourhood_district;
            
            if (selectedVenueDistrict === 'all' || venueDistrict === selectedVenueDistrict) {
                const option = document.createElement('option');
                option.value = venueId;
                option.textContent = venue.venue_properties.name;
                venueSelect.appendChild(option);
            }
        });
    }
}

// İlçe filtresi değiştiğinde mekan listesini güncelle
document.getElementById('venueDistrictFilter')?.addEventListener('change', function() {
    updateVenueFilterOptions();
});


function updateMap() {
    console.log('UpdateMap called with data counts:', {
        users: userData.size,
        venues: venueData.size,
        events: eventConnections.length
    });

    const venueDistrictFilter = document.getElementById('venueDistrictFilter')?.value || 'all';
    
    // Update venue markers
    venueLayer.eachLayer(marker => {
        const venue = venueData.get(marker.venueId);
        if (!venue) return;

        const districtMatch = venueDistrictFilter === 'all' || 
            venue.venue_properties.v_neighbourhood_district === venueDistrictFilter;

        if (districtMatch) {
            marker.setOpacity(1);
        } else {
            marker.setOpacity(0.2);
        }
    });

    // Get filtered users and events
    const filteredUsers = getFilteredUsers();
    const filteredEvents = getFilteredEvents();

    console.log(`Filtered to ${filteredUsers.length} users based on current filters`);

    // Update heatmap
    const heatData = filteredUsers
        .filter(user => isValidCoordinate(user.coordinates))
        .map(user => [
            user.coordinates[1],
            user.coordinates[0],
            user.activity_properties.u_monthly_avg_event_count
        ]);

    console.log(`Generated ${heatData.length} heatmap points`);
    heat.setLatLngs(heatData);

    // Update lines with filtered events
    updateLines(filteredEvents);

    // Update user points
    userPointLayer.clearLayers();
    if (map.getZoom() >= 17) {
        filteredUsers.forEach(user => {
            if (!isValidCoordinate(user.coordinates)) {
                console.warn('Invalid coordinates for user point:', user);
                return;
            }

            const circle = L.circleMarker([user.coordinates[1], user.coordinates[0]], {
                radius: 5,
                fillColor: "#2563eb",
                color: "#fff",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });
            
            circle.bindPopup(`
                <b>Yaş:</b> ${user.user_properties.age}<br>
                <b>İlçe:</b> ${user.user_properties.u_neighbourhood_district}<br>
                <b>Aylık Ort. Etkinlik:</b> ${user.activity_properties.u_monthly_avg_event_count}
            `);
            
            circle.addTo(userPointLayer);
        });
    }
}

// Harita yüklendiğinde çizgileri gizle
document.addEventListener('DOMContentLoaded', function() {
    const svgContainer = svgOverlay._container;
    if (svgContainer) {
        svgContainer.style.visibility = 'hidden';
    }
});

document.getElementById('ageFilter')?.removeEventListener('change', updateMap);
document.getElementById('venueDistrictFilter')?.removeEventListener('change', function() {
    updateVenueFilterOptions();
    updateMap();
});


//-----------------------------------------------------------------------------
// 7. UI CONTROL FUNCTIONS
//-----------------------------------------------------------------------------

function toggleFilters() {
    const modal = document.getElementById('filtersModal');
    const layersModal = document.getElementById('layersModal');
    
    if (modal) {
        if (layersModal) {
            layersModal.style.display = 'none';
        }
        modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
    }
}

function toggleLayers() {
    const modal = document.getElementById('layersModal');
    const filtersModal = document.getElementById('filtersModal');
    
    if (modal) {
        if (filtersModal) {
            filtersModal.style.display = 'none';
        }
        modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
    }
}

// Toggle butonları için event listener'lar
document.getElementById('heatmapToggle').addEventListener('click', function() {
    this.classList.toggle('active');
    if (this.classList.contains('active')) {
        map.addLayer(heat);
    } else {
        map.removeLayer(heat);
    }
});

map.on('moveend zoomend', function() {
    if (document.getElementById('linesToggle').classList.contains('active')) {
        // Sadece lines görünürse ve harita hareket ederse line'ları güncelle
        const filteredEvents = getFilteredEvents();
        updateLines(filteredEvents);
    }
});


document.getElementById('linesToggle').addEventListener('click', function() {
    this.classList.toggle('active');
    if (this.classList.contains('active')) {
        // Lines açıldığında mevcut duruma göre güncelle
        const filteredEvents = getFilteredEvents();
        updateLines(filteredEvents);
        svgOverlay._container.style.visibility = 'visible';
    } else {
        svgOverlay._container.style.visibility = 'hidden';
    }
});

//-----------------------------------------------------------------------------
// 8. EVENT LISTENERS
//-----------------------------------------------------------------------------

map.on('moveend', updateMap);

document.querySelectorAll('input[name="baseLayer"]')?.forEach(input => {
    input.addEventListener('change', function() {
        if (this.value === 'cartoLight') {
            map.removeLayer(currentBaseLayer);
            cartoLight.addTo(map);
            currentBaseLayer = cartoLight;
        } else if (this.value === 'osm') {
            map.removeLayer(currentBaseLayer);
            osm.addTo(map);
            currentBaseLayer = osm;
        }
    });
});

document.addEventListener('DOMContentLoaded', () => {
    // Existing modal and tab functionality remains the same
    const filterBtn = document.getElementById('filterBtn');
    const layerBtn = document.getElementById('layerBtn');
    
    if (filterBtn) {
        filterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFilters();
        });
    }
    
    if (layerBtn) {
        layerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLayers();
        });
    }

    // Uygula butonuna tıklama işleyicisini güncelliyorum
    document.querySelector('.filter-button').addEventListener('click', function() {
        // Haritayı güncelle
        updateMap();
        
        // Filtreleri kapatalım
        const filtersModal = document.getElementById('filtersModal');
        if (filtersModal) {
            filtersModal.style.display = 'none';
        }
    });

    // Rest of the DOMContentLoaded event listeners remain the same
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    });

    document.addEventListener('click', (e) => {
        const filtersModal = document.getElementById('filtersModal');
        const layersModal = document.getElementById('layersModal');
        const filterBtn = document.getElementById('filterBtn');
        const layerBtn = document.getElementById('layerBtn');
    
        if (filtersModal && filtersModal.style.display === 'block') {
            if (!filtersModal.contains(e.target) && !filterBtn.contains(e.target)) {
                filtersModal.style.display = 'none';
            }
        }
    
        if (layersModal && layersModal.style.display === 'block') {
            if (!layersModal.contains(e.target) && !layerBtn.contains(e.target)) {
                layersModal.style.display = 'none';
            }
        }
    });
});


// Tab işlevselliği için event listeners ekle
document.addEventListener('DOMContentLoaded', () => {
    const tabButtons = document.querySelectorAll('.tab-button');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Aktif tab'ı değiştir
            document.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.remove('active');
            });
            button.classList.add('active');
            
            // İlgili içeriği göster
            const tabId = button.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(tabId).classList.add('active');
        });
    });
});

//-----------------------------------------------------------------------------
// 9. INITIALIZATION
//-----------------------------------------------------------------------------

loadData();