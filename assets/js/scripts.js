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

async function loadData() {
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
            
            if (!isValidGeoJSON(placesGeoJSON)) {
                console.warn('Places data is not in valid GeoJSON format');
                throw new Error('Invalid GeoJSON format');
            }

            placesGeoJSON.features = placesGeoJSON.features.filter(feature => {
                if (!isValidPlacesFeature(feature)) {
                    console.warn('Skipping invalid place feature:', feature);
                    return false;
                }
                return true;
            });

            console.log(`Successfully validated ${placesGeoJSON.features.length} places`);
        } catch (error) {
            console.warn('Using sample places data due to:', error);
            placesGeoJSON = sampleData.places;
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

    } catch (error) {
        console.error('Fatal error in data processing:', error);
        alert('Veri yüklenirken bir hata oluştu. Lütfen sayfayı yenileyin.');
    }
}

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
    marker.bindPopup(`
        <div class="venue-popup">
            <h3 class="font-bold text-lg mb-2">${props.name}</h3>
            <p class="text-sm text-gray-600 mb-1">${props.address}</p>
            <p class="text-sm text-gray-600">Aylık Ort. Etkinlik: ${props.v_monthly_avg_event_count}</p>
        </div>
    `);

    // Store the venue ID with the marker
    marker.venueId = props.venueId;
    marker.addTo(venueLayer);
}

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

// Update the getFilteredUsers function to use filtered events
function getFilteredUsers() {
    const ageFilter = document.getElementById('ageFilter')?.value || 'all';
    const userDistrictFilter = document.getElementById('userDistrictFilter')?.value || 'all';
    const categoryFilter = document.getElementById('categoryFilter')?.value || 'all'; // Etkinlik kategorisi filtresi eklendi

    return Array.from(userData.values()).filter(user => {
        // Temel kullanıcı filtreleri
        const ageMatch = ageFilter === 'all' || user.user_properties.age === ageFilter;
        const districtMatch = userDistrictFilter === 'all' || 
            user.user_properties.u_neighbourhood_district === userDistrictFilter;

        // Etkinlik türü dağılımı kontrolü
        let eventTypeMatch = true;
        for (const [type, minValue] of Object.entries(tempEventTypeFilters)) {
            if (!user.u_event_type_distribution[type] || 
                user.u_event_type_distribution[type] < minValue) {
                eventTypeMatch = false;
                break;
            }
        }

        // Etkinlik kategorisi kontrolü
        let categoryMatch = true;
        if (categoryFilter !== 'all') {
            // Kullanıcının seçili kategoride etkinliği var mı kontrol et
            const userEvents = eventConnections.filter(event => 
                event.userId === user.user_properties.userId && 
                event.eventType.toLowerCase() === categoryFilter
            );
            categoryMatch = userEvents.length > 0;
        }

        return ageMatch && districtMatch && eventTypeMatch && categoryMatch;
    });
}


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
    userDistrictFilter.innerHTML = '<option value="all">Tümü</option>';
    [...userDistricts].sort().forEach(district => {
        const option = document.createElement('option');
        option.value = district;
        option.textContent = district;
        userDistrictFilter.appendChild(option);
    });

    // Mekan ilçelerini topla ve filtre seçeneklerini güncelle
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
    initializeEventTypeSliders();
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


// Etkinlik türü sliderlarını başlatma fonksiyonu
function initializeEventTypeSliders() {
    const filterContainer = document.getElementById('eventTypeSliders');
    const remainingTotalSpan = document.getElementById('remainingTotal');
    let filters = {};
    remainingTotalSpan.textContent = '%100';
    
    // Container'ı temizle
    filterContainer.innerHTML = '';

    Object.entries(eventTypes).forEach(([key, label]) => {
        const filterItem = document.createElement('div');
        filterItem.className = 'filter-item';
        filterItem.innerHTML = `
            <div class="range-label">
                <span>${label}</span>
                <span class="value-display" id="${key}_value">0.0</span>
            </div>
            <div class="slider-container">
                <div class="slider-fill" id="${key}_fill" style="width: 100%;"></div>
                <input type="range" 
                       class="event-type-slider" 
                       id="${key}_slider"
                       min="0" 
                       max="1" 
                       step="0.1" 
                       value="0">
            </div>
        `;
        filterContainer.appendChild(filterItem);
    
        const slider = filterItem.querySelector(`#${key}_slider`);
        slider.addEventListener('input', handleSliderChange);
        document.getElementById(`${key}_value`).textContent = '%0';

    });
}

// Slider değişiklik işleyicisi
// Event type sliderlar için değerleri tutacak geçici bir obje
let tempEventTypeFilters = {};

// Slider değişiklik işleyicisi
function handleSliderChange(e) {
    const sliders = document.querySelectorAll('.event-type-slider');
    let total = 0;
    
    sliders.forEach(slider => {
        total += parseFloat(slider.value);
    });

    const remainingTotal = document.getElementById('remainingTotal');
    remainingTotal.textContent = `%${Math.max(0, (1 - total) * 100).toFixed(0)}`;
    
    if (total > 1) {
        e.target.value = Math.max(0, parseFloat(e.target.value) - (total - 1));
    }

    // Değer göstergesini "en az %" formatında güncelle
    const type = e.target.id.replace('_slider', '');
    const value = parseFloat(e.target.value);
    document.getElementById(`${type}_value`).textContent = value > 0 ? 
        `en az %${(value * 100).toFixed(0)}` : 
        '%0';
    
    const fillElement = document.getElementById(`${type}_fill`);
    fillElement.style.width = `${(1 - value) * 100}%`;
    
    tempEventTypeFilters[type] = value;
}

// Uygula butonuna tıklama işleyicisi
document.querySelector('.filter-button').addEventListener('click', function() {
    // Slider değerlerini kalıcı filtrelere aktar
    document.querySelectorAll('.event-type-slider').forEach(slider => {
        const type = slider.id.replace('_slider', '');
        const value = parseFloat(slider.value);
        if (value > 0) {
            tempEventTypeFilters[type] = value;
        } else {
            delete tempEventTypeFilters[type];
        }
    });

    // Haritayı güncelle
    updateMap();
});

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

document.getElementById('linesToggle').addEventListener('click', function() {
    this.classList.toggle('active');
    const svgContainer = svgOverlay._container;
    if (this.classList.contains('active')) {
        svgContainer.style.visibility = 'visible';  // display yerine visibility kullanıyoruz
    } else {
        svgContainer.style.visibility = 'hidden';
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

    // Add click event listener for the Apply button
    const applyButton = document.querySelector('.filter-button');
    if (applyButton) {
        applyButton.addEventListener('click', () => {
            updateMap();
            // Optionally close the filters modal after applying
            const filtersModal = document.getElementById('filtersModal');
            if (filtersModal) {
                filtersModal.style.display = 'none';
            }
        });
    }

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