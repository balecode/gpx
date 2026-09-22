/**
 * StrideMap - Running Route & GPX/KML Creator
 * Features:
 * - Leaflet map with multiple layers (OSM, Satellite, Topo)
 * - Search bar with Nominatim Geocoding API
 * - Snap-to-Road pedestrian routing with OSRM
 * - Freehand / straight line routing mode
 * - Landmark / POI marking with custom legends (Water, Start, Finish, Toilet, Hill, Photo, Checkpoint)
 * - Realtime pacing calculator
 * - GPX 1.1 Exporter with <wpt> (Waypoints with <name>, <desc>, <sym>, <type>) for Google My Maps & Garmin
 * - KML Exporter with styled Placemarks & Linestring for direct Google Earth / Maps visual legend
 * - GPX / KML Importer
 */

const LANDMARK_TYPES = {
  km: { label: 'KM Marker', icon: 'fa-location-arrow', color: '#059669', sym: 'Mile Marker' },
  water: { label: 'Water Station', icon: 'fa-bottle-water', color: '#0284c7', sym: 'Water Source' },
  cheering: { label: 'Cheering Area', icon: 'fa-bullhorn', color: '#ec4899', sym: 'Amusement Park' },
  start_finish: { label: 'Start & Finish', icon: 'fa-flag-checkered', color: '#7c3aed', sym: 'Flag, Blue' },
  start: { label: 'Start Line', icon: 'fa-play', color: '#16a34a', sym: 'Flag, Green' },
  finish: { label: 'Finish Line', icon: 'fa-flag-checkered', color: '#dc2626', sym: 'Flag, Red' },
  checkpoint: { label: 'Check Point', icon: 'fa-stopwatch', color: '#f59e0b', sym: 'Checkpoint' },
  toilet: { label: 'Toilet / Restroom', icon: 'fa-restroom', color: '#64748b', sym: 'Restroom' },
  photo: { label: 'Photo Spot', icon: 'fa-camera', color: '#8b5cf6', sym: 'Scenic Area' },
  hill: { label: 'Hill / Tanjakan', icon: 'fa-mountain', color: '#ea580c', sym: 'Summit' },
  custom: { label: 'Landmark Khusus', icon: 'fa-star', color: '#e11d48', sym: 'Pin, Red' }
};

class StrideMapApp {
  constructor() {
    this.map = null;
    this.activeTileLayer = null;
    this.baseLayers = {};
    
    this.currentMode = 'move'; // Default mode: 'move' (geser & jelajahi peta tanpa klik rute)
    this.snapToRoad = true;
    
    this.waypoints = [];
    this.routePolyline = null;
    this.waypointMarkers = [];

    // History state untuk Undo / Redo
    this.undoStack = [];
    this.redoStack = [];
    
    this.landmarks = [];
    this.landmarkMarkers = [];
    this.selectedLandmarkType = 'water';
    this.pendingLandmarkLatLng = null;

    this.paceSeconds = 360;
    this.startTime = '06:00';

    // Loop Snapping Recommendation (Start-to-Finish close detector)
    this.isNearStart = false;
    this.loopSnapMarker = null;

    this.initDOMElements();
    this.initMap();
    this.setMode('move');
    this.bindEvents();
    this.renderLandmarkBadges();
    this.updateStats();
    
    // Pulihkan rute & landmark terakhir yang disimpan di localStorage
    this.loadSavedRoute();
  }

  initDOMElements() {
    this.sidebar = document.getElementById('sidebar');
    this.toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
    this.sidebarResizeHandle = document.getElementById('sidebarResizeHandle');
    this.expandSidebarBtn = document.getElementById('expandSidebarBtn');
    this.sidebarBackdrop = document.getElementById('sidebarBackdrop');
    this.searchInput = document.getElementById('searchInput');
    this.clearSearchBtn = document.getElementById('clearSearchBtn');
    this.searchResults = document.getElementById('searchResults');
    
    this.modeMoveBtn = document.getElementById('modeMoveBtn');
    this.modeRouteBtn = document.getElementById('modeRouteBtn');
    this.modeLandmarkBtn = document.getElementById('modeLandmarkBtn');
    this.moveHintOptions = document.getElementById('moveHintOptions');
    this.routingOptions = document.getElementById('routingOptions');
    this.landmarkOptions = document.getElementById('landmarkOptions');
    this.snapRoadToggle = document.getElementById('snapRoadToggle');
    this.landmarkBadgeGroup = document.getElementById('landmarkBadgeGroup');
    
    this.distKmEl = document.getElementById('distKm');
    this.estTimeEl = document.getElementById('estTime');
    this.pointCountEl = document.getElementById('pointCount');
    this.landmarkCountEl = document.getElementById('landmarkCount');
    this.paceRange = document.getElementById('paceRange');
    this.paceDisplay = document.getElementById('paceDisplay');
    this.startTimeInput = document.getElementById('startTimeInput');
    this.paceMinInput = document.getElementById('paceMinInput');
    this.paceSecInput = document.getElementById('paceSecInput');
    
    this.landmarkList = document.getElementById('landmarkList');
    this.landmarkEmpty = document.getElementById('landmarkEmpty');
    this.landmarkTotalBadge = document.getElementById('landmarkTotalBadge');
    
    this.undoBtn = document.getElementById('undoBtn');
    this.redoBtn = document.getElementById('redoBtn');
    this.quickUndoBtn = document.getElementById('quickUndoBtn');
    this.quickRedoBtn = document.getElementById('quickRedoBtn');
    this.loopRouteBtn = document.getElementById('loopRouteBtn');
    this.reverseRouteBtn = document.getElementById('reverseRouteBtn');
    this.clearBtn = document.getElementById('clearBtn');
    
    this.routeTitleInput = document.getElementById('routeTitleInput');
    this.exportGpxBtn = document.getElementById('exportGpxBtn');
    this.exportKmlBtn = document.getElementById('exportKmlBtn');
    this.gpxFileInput = document.getElementById('gpxFileInput');
    
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.loadingText = document.getElementById('loadingText');
    
    this.landmarkModal = document.getElementById('landmarkModal');
    this.modalTitle = document.getElementById('modalTitle');
    this.landmarkNameInput = document.getElementById('landmarkNameInput');
    this.landmarkDescInput = document.getElementById('landmarkDescInput');
    this.modalBadgePicker = document.getElementById('modalBadgePicker');
    this.showTimeEstimateCheck = document.getElementById('showTimeEstimateCheck');
    this.modalTimeEstimateHint = document.getElementById('modalTimeEstimateHint');
    this.saveLandmarkBtn = document.getElementById('saveLandmarkBtn');
    this.cancelLandmarkBtn = document.getElementById('cancelLandmarkBtn');
    this.closeModalBtn = document.getElementById('closeModalBtn');
  }

  initMap() {
    const defaultLat = -6.2186;
    const defaultLng = 106.8026;
    const defaultZoom = 15;

    this.map = L.map('map', {
      center: [defaultLat, defaultLng],
      zoom: defaultZoom,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // Tile layer jalan yang 100% gratis, tanpa API Key, dan tanpa watermark
    this.baseLayers.osm = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap France contributors'
    });

    this.baseLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: 'Tiles &copy; Esri'
    });

    this.baseLayers.topo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: 'Tiles &copy; Esri World Topo'
    });

    this.activeTileLayer = this.baseLayers.osm;
    this.activeTileLayer.addTo(this.map);

    this.routePolyline = L.polyline([], {
      color: '#fc4c02',
      weight: 6,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    // Tooltip jarak rute saat kursor di-hover ke garis jalur
    this.routePolyline.bindTooltip('', {
      sticky: true,
      direction: 'top',
      offset: [0, -10],
      className: 'route-dist-tooltip'
    });

    this.routePolyline.on('mousemove', (e) => {
      const distKm = this.getDistanceFromStartAlongPolyline(e.latlng);
      if (distKm !== null) {
        this.routePolyline.setTooltipContent(
          `<span class="dist-val">${distKm.toFixed(2)} km</span> dari Start`
        );
      }
    });
  }

  bindEvents() {
    this.map.on('click', (e) => this.handleMapClick(e));
    this.map.on('mousemove', (e) => this.handleMapMouseMove(e));

    const closeSidebar = () => {
      this.sidebar.classList.add('collapsed');
      this.expandSidebarBtn.style.display = 'flex';
      if (this.sidebarBackdrop) this.sidebarBackdrop.style.display = 'none';
      setTimeout(() => this.map.invalidateSize(), 300);
    };

    const openSidebar = () => {
      this.sidebar.classList.remove('collapsed');
      this.expandSidebarBtn.style.display = 'none';
      if (window.innerWidth <= 768 && this.sidebarBackdrop) {
        this.sidebarBackdrop.style.display = 'block';
      }
      setTimeout(() => this.map.invalidateSize(), 300);
    };

    this.toggleSidebarBtn.addEventListener('click', closeSidebar);
    this.expandSidebarBtn.addEventListener('click', openSidebar);
    if (this.sidebarBackdrop) this.sidebarBackdrop.addEventListener('click', closeSidebar);

    // Drag tepi untuk memperlebar / memperkecil sidebar (Mouse & Touch)
    if (this.sidebarResizeHandle) {
      let isDragging = false;
      let startX = 0;
      let startWidth = 0;

      const onStart = (clientX) => {
        isDragging = true;
        startX = clientX;
        startWidth = this.sidebar.getBoundingClientRect().width;
        document.body.classList.add('resizing-sidebar');
        this.sidebarResizeHandle.classList.add('active');
      };

      const onMove = (clientX) => {
        if (!isDragging) return;
        const deltaX = clientX - startX;
        let newWidth = startWidth + deltaX;

        const minW = 280;
        const maxW = Math.min(window.innerWidth - 60, 850);
        newWidth = Math.max(minW, Math.min(newWidth, maxW));

        this.sidebar.style.width = `${newWidth}px`;
        if (this.map) this.map.invalidateSize();
      };

      const onEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.classList.remove('resizing-sidebar');
        this.sidebarResizeHandle.classList.remove('active');
        if (this.map) {
          setTimeout(() => this.map.invalidateSize(), 50);
        }
      };

      // Mouse Events
      this.sidebarResizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onStart(e.clientX);
      });

      window.addEventListener('mousemove', (e) => {
        if (isDragging) onMove(e.clientX);
      });

      window.addEventListener('mouseup', () => {
        if (isDragging) onEnd();
      });

      // Touch Events (Smartphone & Tablet)
      this.sidebarResizeHandle.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length > 0) {
          onStart(e.touches[0].clientX);
        }
      }, { passive: true });

      window.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches && e.touches.length > 0) {
          onMove(e.touches[0].clientX);
        }
      }, { passive: true });

      window.addEventListener('touchend', () => {
        if (isDragging) onEnd();
      });

      window.addEventListener('touchcancel', () => {
        if (isDragging) onEnd();
      });
    }

    document.querySelectorAll('.layer-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const layerKey = e.currentTarget.getAttribute('data-layer');
        document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        
        if (this.baseLayers[layerKey]) {
          this.map.removeLayer(this.activeTileLayer);
          this.activeTileLayer = this.baseLayers[layerKey];
          this.activeTileLayer.addTo(this.map);
        }
      });
    });

    this.modeMoveBtn.addEventListener('click', () => this.setMode('move'));
    this.modeRouteBtn.addEventListener('click', () => this.setMode('route'));
    this.modeLandmarkBtn.addEventListener('click', () => this.setMode('landmark'));

    this.snapRoadToggle.addEventListener('change', (e) => {
      this.snapToRoad = e.target.checked;
    });

    let searchTimeout = null;
    this.searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      this.clearSearchBtn.style.display = query.length > 0 ? 'flex' : 'none';
      
      clearTimeout(searchTimeout);
      if (query.length < 3) {
        this.searchResults.style.display = 'none';
        return;
      }

      searchTimeout = setTimeout(() => {
        this.performSearch(query);
      }, 400);
    });

    this.clearSearchBtn.addEventListener('click', () => {
      this.searchInput.value = '';
      this.clearSearchBtn.style.display = 'none';
      this.searchResults.style.display = 'none';
    });

    document.addEventListener('click', (e) => {
      if (!this.searchInput.contains(e.target) && !this.searchResults.contains(e.target)) {
        this.searchResults.style.display = 'none';
      }
    });

    this.paceRange.addEventListener('input', (e) => {
      this.paceSeconds = parseInt(e.target.value);
      this.syncPaceNumberInputs();
      this.updatePaceDisplay();
      this.updateStats();
      this.updateLandmarkMarkersDisplay();
      this.saveToStorage();
    });

    if (this.startTimeInput) {
      this.startTimeInput.addEventListener('change', (e) => {
        this.startTime = e.target.value || '06:00';
        this.updateLandmarkMarkersDisplay();
        this.saveToStorage();
      });
    }

    const onPaceNumChange = () => {
      let min = parseInt(this.paceMinInput.value) || 6;
      let sec = parseInt(this.paceSecInput.value) || 0;
      min = Math.max(3, Math.min(15, min));
      sec = Math.max(0, Math.min(59, sec));
      this.paceSeconds = min * 60 + sec;
      if (this.paceRange) this.paceRange.value = this.paceSeconds;
      this.updatePaceDisplay();
      this.updateStats();
      this.updateLandmarkMarkersDisplay();
      this.saveToStorage();
    };

    if (this.paceMinInput) this.paceMinInput.addEventListener('change', onPaceNumChange);
    if (this.paceSecInput) this.paceSecInput.addEventListener('change', onPaceNumChange);

    if (this.routeTitleInput) {
      this.routeTitleInput.addEventListener('input', () => {
        this.saveToStorage();
      });
    }

    // Undo & Redo button events
    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());
    this.quickUndoBtn.addEventListener('click', () => this.undo());
    this.quickRedoBtn.addEventListener('click', () => this.redo());

    // Keyboard Shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
    window.addEventListener('keydown', (e) => {
      // Pastikan tidak sedang mengetik di input text / textarea
      const targetTag = e.target.tagName.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea') return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        this.redo();
      }
    });

    this.loopRouteBtn.addEventListener('click', () => this.makeLoopRoute());
    this.reverseRouteBtn.addEventListener('click', () => this.reverseRoute());
    this.clearBtn.addEventListener('click', () => this.resetAll());

    document.getElementById('locateMeBtn').addEventListener('click', () => this.locateUser());
    document.getElementById('fitBoundsBtn').addEventListener('click', () => this.fitRouteBounds());
    
    const fullScreenBtn = document.getElementById('fullScreenBtn');
    if (fullScreenBtn) {
      fullScreenBtn.addEventListener('click', () => this.toggleFullScreen());
      
      const updateFullScreenIcon = () => {
        const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
        fullScreenBtn.innerHTML = isFS ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
        fullScreenBtn.title = isFS ? 'Keluar dari Layar Penuh' : 'Layar Penuh / Full Screen (Sembunyikan URL & Bar Browser)';
        setTimeout(() => this.map.invalidateSize(), 200);
      };

      document.addEventListener('fullscreenchange', updateFullScreenIcon);
      document.addEventListener('webkitfullscreenchange', updateFullScreenIcon);
      document.addEventListener('mozfullscreenchange', updateFullScreenIcon);
      document.addEventListener('MSFullscreenChange', updateFullScreenIcon);
    }

    this.exportGpxBtn.addEventListener('click', () => this.exportGPX());
    this.exportKmlBtn.addEventListener('click', () => this.exportKML());
    this.gpxFileInput.addEventListener('change', (e) => this.handleFileImport(e));

    this.closeModalBtn.addEventListener('click', () => this.closeLandmarkModal());
    this.cancelLandmarkBtn.addEventListener('click', () => this.closeLandmarkModal());
    this.saveLandmarkBtn.addEventListener('click', () => this.savePendingLandmark());
  }

  toggleFullScreen() {
    const doc = document;
    const docEl = document.documentElement;

    const isFullScreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);

    if (!isFullScreen) {
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(() => {});
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      } else if (docEl.mozRequestFullScreen) {
        docEl.mozRequestFullScreen();
      } else if (docEl.msRequestFullscreen) {
        docEl.msRequestFullscreen();
      }
    } else {
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      } else if (doc.mozCancelFullScreen) {
        doc.mozCancelFullScreen();
      } else if (doc.msExitFullscreen) {
        doc.msExitFullscreen();
      }
    }
    setTimeout(() => {
      if (this.map) this.map.invalidateSize();
    }, 200);
  }

  setMode(mode) {
    this.currentMode = mode;
    this.modeMoveBtn.classList.toggle('active', mode === 'move');
    this.modeRouteBtn.classList.toggle('active', mode === 'route');
    this.modeLandmarkBtn.classList.toggle('active', mode === 'landmark');

    this.moveHintOptions.style.display = mode === 'move' ? 'block' : 'none';
    this.routingOptions.style.display = mode === 'route' ? 'block' : 'none';
    this.landmarkOptions.style.display = mode === 'landmark' ? 'block' : 'none';

    // Sesuaikan kursor pada container peta
    const mapContainer = document.getElementById('map');
    if (mapContainer) {
      mapContainer.style.cursor = mode === 'move' ? 'grab' : 'crosshair';
    }
  }

  renderLandmarkBadges() {
    this.landmarkBadgeGroup.innerHTML = '';
    this.modalBadgePicker.innerHTML = '';

    Object.entries(LANDMARK_TYPES).forEach(([key, val]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `badge-btn ${key === this.selectedLandmarkType ? 'active' : ''}`;
      btn.setAttribute('data-type', key);
      btn.innerHTML = `<i class="fa-solid ${val.icon}" style="color: ${val.color};"></i> ${val.label}`;
      btn.addEventListener('click', () => {
        document.querySelectorAll('#landmarkBadgeGroup .badge-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedLandmarkType = key;
      });
      this.landmarkBadgeGroup.appendChild(btn);

      // Modal Picker Badges
      const modalBtn = document.createElement('button');
      modalBtn.type = 'button';
      modalBtn.className = `badge-btn ${key === this.selectedLandmarkType ? 'active' : ''}`;
      modalBtn.setAttribute('data-type', key);
      modalBtn.innerHTML = `<i class="fa-solid ${val.icon}" style="color: ${val.color};"></i> ${val.label}`;
      modalBtn.addEventListener('click', () => {
        document.querySelectorAll('#modalBadgePicker .badge-btn').forEach(b => b.classList.remove('active'));
        modalBtn.classList.add('active');
        this.selectedLandmarkType = key;
        
        // Update input nama & deskripsi otomatis sesuai kategori yang dipilih
        this.updateLandmarkNameForType(key);
      });
      this.modalBadgePicker.appendChild(modalBtn);
    });
  }

  async performSearch(query) {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`);
      const data = await response.json();
      
      this.searchResults.innerHTML = '';
      if (!data || data.length === 0) {
        this.searchResults.innerHTML = '<div class="search-result-item"><span>Tidak ditemukan lokasi.</span></div>';
        this.searchResults.style.display = 'block';
        return;
      }

      data.forEach(item => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `
          <i class="fa-solid fa-location-dot"></i>
          <div class="search-result-text">
            <div class="search-result-title">${item.display_name.split(',')[0]}</div>
            <div class="search-result-sub">${item.display_name}</div>
          </div>
        `;
        div.addEventListener('click', () => {
          const lat = parseFloat(item.lat);
          const lon = parseFloat(item.lon);
          this.map.flyTo([lat, lon], 16, { duration: 1.2 });
          this.searchResults.style.display = 'none';
          this.searchInput.value = item.display_name.split(',')[0];
        });
        this.searchResults.appendChild(div);
      });
      this.searchResults.style.display = 'block';
    } catch (err) {
      console.error('Search error:', err);
    }
  }

  handleMapClick(e) {
    if (this.currentMode === 'move') {
      // Pada mode Move/Geser, klik tidak akan menambah titik atau landmark
      return;
    }

    const latlng = e.latlng;
    if (this.currentMode === 'landmark') {
      this.openLandmarkModal(latlng);
    } else {
      // Jika berada dekat titik start dan ada indikasi rekomendasi gabung loop
      if (this.isNearStart && this.waypoints.length >= 2) {
        const startPoint = this.waypoints[0];
        this.addWaypoint(L.latLng(startPoint.lat, startPoint.lng));
      } else {
        this.addWaypoint(latlng);
      }
    }
  }

  handleMapMouseMove(e) {
    if (this.currentMode !== 'route' || this.waypoints.length < 2) {
      this.clearLoopSnapRecommendation();
      return;
    }

    const mouseLatLng = e.latlng;
    const startPoint = this.waypoints[0];
    
    // Konversi koordinat ke pixel pada layar saat ini untuk deteksi hover presisi
    const mousePoint = this.map.latLngToContainerPoint(mouseLatLng);
    const startPixel = this.map.latLngToContainerPoint(startPoint);
    const pixelDistance = mousePoint.distanceTo(startPixel);

    // Hover terdeteksi jika kursor berada dalam radius 35 pixel di sekitar icon start
    // atau dalam jarak geografis meter dekat
    const distanceMeters = mouseLatLng.distanceTo(startPoint);
    const isHovering = pixelDistance <= 35 || distanceMeters <= 20;

    if (isHovering) {
      this.showLoopSnapRecommendation(startPoint);
    } else {
      this.clearLoopSnapRecommendation();
    }
  }

  showLoopSnapRecommendation(startPoint) {
    this.isNearStart = true;
    if (!this.loopSnapMarker) {
      const snapIcon = L.divIcon({
        className: 'landmark-div-icon-wrapper',
        html: `
          <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
            <div class="loop-snap-recommendation-badge">
              <i class="fa-solid fa-link"></i> Klik untuk Gabung Loop (Start & Finish)
            </div>
            <div class="landmark-map-pin snap-loop-pulse" style="background-color: #7c3aed; width: 40px; height: 40px; border: 3px solid #ffffff;">
              <i class="fa-solid fa-flag-checkered" style="font-size: 16px;"></i>
            </div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });

      this.loopSnapMarker = L.marker([startPoint.lat, startPoint.lng], {
        icon: snapIcon,
        zIndexOffset: 2000,
        interactive: true
      }).addTo(this.map);

      // Jika user klik langsung pada marker rekomendasi pulsa
      this.loopSnapMarker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        this.clearLoopSnapRecommendation();
        this.addWaypoint(L.latLng(startPoint.lat, startPoint.lng));
      });
    }
  }

  clearLoopSnapRecommendation() {
    this.isNearStart = false;
    if (this.loopSnapMarker) {
      this.map.removeLayer(this.loopSnapMarker);
      this.loopSnapMarker = null;
    }
  }

  // Sinkronisasi otomatis Landmark Start, Finish, atau Start & Finish
  syncAutoStartFinishLandmarks() {
    // 1. Hapus auto landmark yang sebelumnya dibuat
    this.landmarks = this.landmarks.filter(l => {
      if (l.isAuto) {
        if (l.marker) this.map.removeLayer(l.marker);
        return false;
      }
      return true;
    });

    if (this.waypoints.length === 0) {
      this.renderLandmarkList();
      this.updateStats();
      return;
    }

    const startPt = this.waypoints[0];

    // Jika hanya 1 titik rute
    if (this.waypoints.length === 1) {
      this.createInternalLandmark({
        lat: startPt.lat,
        lng: startPt.lng,
        type: 'start',
        name: 'Start Line',
        desc: 'Titik awal jalur lari',
        isAuto: true
      });
      this.renderLandmarkList();
      this.updateStats();
      return;
    }

    const endPt = this.waypoints[this.waypoints.length - 1];
    const isSamePoint = startPt.distanceTo(endPt) < 15; // Jarak < 15 meter dianggap titik sama / Loop

    if (isSamePoint) {
      // Titik Start dan Finish menyatu
      this.createInternalLandmark({
        lat: startPt.lat,
        lng: startPt.lng,
        type: 'start_finish',
        name: 'Start & Finish',
        desc: 'Titik Start dan Finish jalur lari (Loop/Melingkar)',
        isAuto: true
      });
    } else {
      // Titik Start & Finish terpisah
      this.createInternalLandmark({
        lat: startPt.lat,
        lng: startPt.lng,
        type: 'start',
        name: 'Start Line',
        desc: 'Titik awal jalur lari',
        isAuto: true
      });

      this.createInternalLandmark({
        lat: endPt.lat,
        lng: endPt.lng,
        type: 'finish',
        name: 'Finish Line',
        desc: 'Titik finish jalur lari',
        isAuto: true
      });
    }

    this.renderLandmarkList();
    this.updateStats();
  }

  createInternalLandmark({ lat, lng, type, name, desc, isAuto = false, showTimeEstimate = true }) {
    const config = LANDMARK_TYPES[type] || LANDMARK_TYPES.custom;
    const isKm = type === 'km';
    const labelText = name || config.label;
    const pinInnerHtml = isKm
      ? `<span class="km-pin-num">${labelText.replace(/[^0-9.]/g, '') || 'KM'}</span>`
      : `<i class="fa-solid ${config.icon}"></i>`;

    const isStartOrFinish = type === 'start' || type === 'finish' || type === 'start_finish';
    let timeTagHtml = '';
    if (showTimeEstimate || isStartOrFinish) {
      timeTagHtml = this.getLandmarkTimeTagHtml(lat, lng, type);
    }

    const icon = L.divIcon({
      className: 'landmark-div-icon-wrapper',
      html: `
        <div class="landmark-marker-container">
          <div class="landmark-top-label" style="border-color: ${config.color};">
            <span class="landmark-label-text">${labelText}</span>
            ${timeTagHtml}
          </div>
          <div class="landmark-map-pin ${isKm ? 'km-pin' : ''}" style="background-color: ${config.color};">
            ${pinInnerHtml}
          </div>
        </div>
      `,
      iconSize: [100, 72],
      iconAnchor: [50, 66]
    });

    const marker = L.marker([lat, lng], {
      icon: icon,
      draggable: !isAuto
    }).addTo(this.map);

    const popupContent = `
      <div style="font-family: inherit; min-width: 160px;">
        <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: ${config.color}; margin-bottom: 4px;">
          <i class="fa-solid ${config.icon}"></i> ${config.label}
        </div>
        <div style="font-size: 14px; font-weight: 600; color: #0f172a;">${name}</div>
        ${desc ? `<div style="font-size: 12px; color: #64748b; margin-top: 4px;">${desc}</div>` : ''}
      </div>
    `;
    marker.bindPopup(popupContent);

    // Jika landmark ini adalah auto Start, tambahkan trigger hover untuk memunculkan rekomendasi loop
    if (isAuto && type === 'start') {
      marker.on('mouseover', () => {
        if (this.currentMode === 'route' && this.waypoints.length >= 2) {
          this.showLoopSnapRecommendation(L.latLng(lat, lng));
        }
      });

      marker.on('click', (e) => {
        if (this.currentMode === 'route' && this.waypoints.length >= 2) {
          L.DomEvent.stopPropagation(e);
          this.clearLoopSnapRecommendation();
          this.addWaypoint(L.latLng(lat, lng));
        }
      });
    }

    if (!isAuto) {
      marker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        landmarkObj.lat = pos.lat;
        landmarkObj.lng = pos.lng;
        this.updateLandmarkMarkersDisplay();
      });
    }

    const landmarkObj = {
      id: isAuto ? `auto_${type}` : Date.now().toString() + Math.random().toString(36).substr(2, 4),
      lat: lat,
      lng: lng,
      type: type,
      name: name,
      desc: desc,
      isAuto: isAuto,
      showTimeEstimate: showTimeEstimate,
      marker: marker
    };

    this.landmarks.push(landmarkObj);
    return landmarkObj;
  }

  // --- Snapshot State untuk Undo / Redo ---
  takeSnapshot() {
    return {
      waypoints: this.waypoints.map(w => L.latLng(w.lat, w.lng)),
      landmarks: this.landmarks.map(l => ({
        id: l.id,
        lat: l.lat,
        lng: l.lng,
        type: l.type,
        name: l.name,
        desc: l.desc,
        isAuto: l.isAuto || false,
        showTimeEstimate: l.showTimeEstimate !== undefined ? l.showTimeEstimate : true
      }))
    };
  }

  // --- LocalStorage Persistence (Mencegah hilang saat reload browser) ---
  saveToStorage() {
    try {
      const dataToSave = {
        waypoints: this.waypoints.map(w => ({ lat: w.lat, lng: w.lng })),
        routePolyline: this.routePolyline ? this.routePolyline.getLatLngs().map(p => ({ lat: p.lat, lng: p.lng })) : [],
        landmarks: this.landmarks.map(l => ({
          id: l.id,
          lat: l.lat,
          lng: l.lng,
          type: l.type,
          name: l.name,
          desc: l.desc,
          isAuto: l.isAuto || false,
          showTimeEstimate: l.showTimeEstimate !== undefined ? l.showTimeEstimate : true
        })),
        routeTitle: this.routeTitleInput ? this.routeTitleInput.value : 'My Running Route',
        paceSeconds: this.paceSeconds || 360,
        startTime: this.startTime || '06:00',
        snapToRoad: this.snapToRoad !== undefined ? this.snapToRoad : true
      };
      localStorage.setItem('stridemap_active_route', JSON.stringify(dataToSave));
    } catch (e) {
      console.warn('Gagal menyimpan ke localStorage:', e);
    }
  }

  async loadSavedRoute() {
    try {
      const savedRaw = localStorage.getItem('stridemap_active_route');
      if (!savedRaw) return;

      const data = JSON.parse(savedRaw);
      if (!data || (!data.waypoints?.length && !data.landmarks?.length)) return;

      if (data.routeTitle && this.routeTitleInput) {
        this.routeTitleInput.value = data.routeTitle;
      }

      if (data.paceSeconds) {
        this.paceSeconds = data.paceSeconds;
        if (this.paceRange) this.paceRange.value = data.paceSeconds;
        this.syncPaceNumberInputs();
        this.updatePaceDisplay();
      }

      if (data.startTime) {
        this.startTime = data.startTime;
        if (this.startTimeInput) this.startTimeInput.value = data.startTime;
      }

      if (data.snapToRoad !== undefined) {
        this.snapToRoad = data.snapToRoad;
        if (this.snapRoadToggle) this.snapRoadToggle.checked = data.snapToRoad;
      }

      // 1. Bersihkan landmarks yang mungkin sudah ada di map
      this.landmarks.forEach(l => {
        if (l.marker) this.map.removeLayer(l.marker);
      });
      this.landmarks = [];

      // Muat landmark manual/kustom (bukan auto start/finish agar tidak terduplikasi)
      if (data.landmarks && Array.isArray(data.landmarks)) {
        data.landmarks.forEach(l => {
          if (!l.isAuto) {
            this.createInternalLandmark({
              lat: l.lat,
              lng: l.lng,
              type: l.type,
              name: l.name,
              desc: l.desc,
              isAuto: false,
              showTimeEstimate: l.showTimeEstimate !== undefined ? l.showTimeEstimate : true
            });
          }
        });
      }

      // 2. Muat waypoints dan polyline
      if (data.waypoints && Array.isArray(data.waypoints) && data.waypoints.length > 0) {
        this.waypoints = data.waypoints.map(w => L.latLng(w.lat, w.lng));
        
        if (data.routePolyline && Array.isArray(data.routePolyline) && data.routePolyline.length > 0) {
          const polyCoords = data.routePolyline.map(p => L.latLng(p.lat, p.lng));
          this.routePolyline.setLatLngs(polyCoords);
          this.renderWaypointMarkers();
          this.syncAutoStartFinishLandmarks();
          this.updateLandmarkMarkersDisplay();
          this.updateStats();
          this.updateControlsState();
        } else {
          await this.recalculateRoute(false);
        }

        // Auto zoom ke rute yang dimuat
        setTimeout(() => this.fitRouteBounds(), 400);
      } else {
        this.renderLandmarkList();
        this.updateStats();
        this.updateControlsState();
      }
    } catch (e) {
      console.warn('Gagal memulihkan rute dari localStorage:', e);
    }
  }

  saveStateToHistory() {
    this.undoStack.push(this.takeSnapshot());
    // Setiap ada aksi baru, redoStack dikosongkan
    this.redoStack = [];
    this.updateControlsState();
    this.saveToStorage();
  }

  async applySnapshot(snapshot) {
    // 1. Restore Waypoints
    this.waypoints = snapshot.waypoints.map(w => L.latLng(w.lat, w.lng));
    await this.recalculateRoute(false); // tidak save history saat restore

    // 2. Restore Landmarks
    this.landmarks.forEach(l => {
      if (l.marker) this.map.removeLayer(l.marker);
    });
    this.landmarks = [];

    snapshot.landmarks.forEach(l => {
      this.createInternalLandmark({
        lat: l.lat,
        lng: l.lng,
        type: l.type,
        name: l.name,
        desc: l.desc,
        isAuto: l.isAuto || false,
        showTimeEstimate: l.showTimeEstimate !== undefined ? l.showTimeEstimate : true
      });
    });

    this.renderLandmarkList();
    this.updateStats();
    this.updateControlsState();
    this.saveToStorage();
  }

  async undo() {
    if (this.undoStack.length === 0) return;
    const currentState = this.takeSnapshot();
    this.redoStack.push(currentState);

    const prevState = this.undoStack.pop();
    await this.applySnapshot(prevState);
  }

  async redo() {
    if (this.redoStack.length === 0) return;
    const currentState = this.takeSnapshot();
    this.undoStack.push(currentState);

    const nextState = this.redoStack.pop();
    await this.applySnapshot(nextState);
  }

  // --- Routing Logic ---
  async addWaypoint(latlng) {
    this.saveStateToHistory();
    this.waypoints.push(latlng);
    await this.recalculateRoute();
  }

  async recalculateRoute(saveHistory = false) {
    if (saveHistory) {
      this.saveStateToHistory();
    }

    if (this.waypoints.length === 0) {
      this.routePolyline.setLatLngs([]);
      this.renderWaypointMarkers();
      this.syncAutoStartFinishLandmarks();
      this.updateStats();
      this.updateControlsState();
      return;
    }

    if (this.waypoints.length === 1) {
      this.routePolyline.setLatLngs([]);
      this.renderWaypointMarkers();
      this.syncAutoStartFinishLandmarks();
      this.updateStats();
      this.updateControlsState();
      return;
    }

    if (!this.snapToRoad) {
      this.routePolyline.setLatLngs(this.waypoints);
      this.renderWaypointMarkers();
      this.syncAutoStartFinishLandmarks();
      this.updateStats();
      this.updateControlsState();
      return;
    }

    this.showLoading(true, 'Menghubungkan jalur lari...');
    try {
      const coordsString = this.waypoints.map(pt => `${pt.lng},${pt.lat}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/foot/${coordsString}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        this.routePolyline.setLatLngs(coords);
      } else {
        this.routePolyline.setLatLngs(this.waypoints);
      }
    } catch (err) {
      console.warn('Routing API fallback:', err);
      this.routePolyline.setLatLngs(this.waypoints);
    } finally {
      this.showLoading(false);
      this.renderWaypointMarkers();
      this.syncAutoStartFinishLandmarks();
      this.updateLandmarkMarkersDisplay();
      this.updateStats();
      this.updateControlsState();
    }
  }

  renderWaypointMarkers() {
    this.waypointMarkers.forEach(m => this.map.removeLayer(m));
    this.waypointMarkers = [];

    this.waypoints.forEach((pt, idx) => {
      let markerClass = 'custom-route-marker';
      let label = (idx + 1).toString();

      if (idx === 0) {
        markerClass += ' start';
        label = '<i class="fa-solid fa-play"></i>';
      } else if (idx === this.waypoints.length - 1) {
        markerClass += ' finish';
        label = '<i class="fa-solid fa-flag-checkered"></i>';
      }

      const icon = L.divIcon({
        className: '',
        html: `<div class="${markerClass}" style="width: 24px; height: 24px;">${label}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const marker = L.marker([pt.lat, pt.lng], {
        icon: icon,
        draggable: true
      }).addTo(this.map);

      // Interaksi hover pada titik Start untuk memicu rekomendasi Loop
      if (idx === 0) {
        marker.on('mouseover', () => {
          if (this.currentMode === 'route' && this.waypoints.length >= 2) {
            this.showLoopSnapRecommendation(pt);
          }
        });

        marker.on('click', (e) => {
          if (this.currentMode === 'route' && this.waypoints.length >= 2) {
            L.DomEvent.stopPropagation(e);
            this.clearLoopSnapRecommendation();
            this.addWaypoint(L.latLng(pt.lat, pt.lng));
          }
        });
      }

      marker.on('dragend', async (e) => {
        this.saveStateToHistory();
        const newLatLng = e.target.getLatLng();
        this.waypoints[idx] = newLatLng;
        await this.recalculateRoute();
      });

      this.waypointMarkers.push(marker);
    });
  }

  async makeLoopRoute() {
    if (this.waypoints.length < 2) return;
    const startPoint = this.waypoints[0];
    this.saveStateToHistory();
    this.waypoints.push(L.latLng(startPoint.lat, startPoint.lng));
    await this.recalculateRoute();
  }

  async reverseRoute() {
    if (this.waypoints.length < 2) return;
    this.saveStateToHistory();
    this.waypoints.reverse();
    await this.recalculateRoute();
  }

  resetAll() {
    if (!confirm('Apakah Anda yakin ingin mereset seluruh rute dan landmark?')) return;
    this.saveStateToHistory();
    this.waypoints = [];
    this.routePolyline.setLatLngs([]);
    this.waypointMarkers.forEach(m => this.map.removeLayer(m));
    this.waypointMarkers = [];
    
    this.landmarks.forEach(l => {
      if (l.marker) this.map.removeLayer(l.marker);
    });
    this.landmarks = [];
    this.renderLandmarkList();
    this.updateStats();
    this.updateControlsState();
    this.saveToStorage();
  }

  updateLandmarkNameForType(type) {
    const config = LANDMARK_TYPES[type] || LANDMARK_TYPES.custom;
    if (type === 'km') {
      const kmCount = this.landmarks.filter(l => l.type === 'km').length + 1;
      this.landmarkNameInput.value = `KM ${kmCount}`;
      this.landmarkDescInput.value = `Titik kilometer ke-${kmCount}`;
    } else if (type === 'cheering') {
      const cheerCount = this.landmarks.filter(l => l.type === 'cheering').length + 1;
      this.landmarkNameInput.value = `Cheering Area #${cheerCount}`;
      this.landmarkDescInput.value = 'Titik kumpul supporter & penyemangat lari';
    } else if (type === 'water') {
      const waterCount = this.landmarks.filter(l => l.type === 'water').length + 1;
      this.landmarkNameInput.value = `Water Station #${waterCount}`;
      this.landmarkDescInput.value = 'Tersedia air mineral & isotonic';
    } else if (type === 'start') {
      this.landmarkNameInput.value = 'Start Line';
      this.landmarkDescInput.value = 'Titik mulai lari';
    } else if (type === 'finish') {
      this.landmarkNameInput.value = 'Finish Line';
      this.landmarkDescInput.value = 'Garis finish rute lari';
    } else if (type === 'start_finish') {
      this.landmarkNameInput.value = 'Start & Finish';
      this.landmarkDescInput.value = 'Titik Start dan Finish jalur lari';
    } else {
      const count = this.landmarks.filter(l => l.type === type).length + 1;
      this.landmarkNameInput.value = `${config.label} #${count}`;
      this.landmarkDescInput.value = '';
    }
    this.landmarkNameInput.select();
  }

  openLandmarkModal(latlng) {
    this.pendingLandmarkLatLng = latlng;
    
    // Set nama awal sesuai kategori yang sedang terpilih
    this.updateLandmarkNameForType(this.selectedLandmarkType);
    
    document.querySelectorAll('#modalBadgePicker .badge-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-type') === this.selectedLandmarkType);
    });

    // Update keterangan estimasi jam pelari di modal
    if (this.modalTimeEstimateHint) {
      const distKm = this.getDistanceFromStartAlongPolyline(latlng);
      if (distKm !== null && this.waypoints.length >= 2) {
        const estClock = this.calculateEstimatedTimeAtDistance(distKm);
        const minPace = Math.floor(this.paceSeconds / 60);
        const secPace = (this.paceSeconds % 60).toString().padStart(2, '0');
        this.modalTimeEstimateHint.innerHTML = `
          <i class="fa-solid fa-person-running" style="color: #fc4c02;"></i> 
          Estimasi: Pelari tiba di titik ini sekitar pukul <strong>${estClock}</strong> (Jarak: <strong>${distKm.toFixed(2)} km</strong> dari Start jam ${this.startTime} @ Pace ${minPace}:${secPace}/km).
        `;
      } else {
        this.modalTimeEstimateHint.textContent = `Dihitung otomatis dari Start (${this.startTime}) berdasarkan Target Pace Anda saat rute terhubung.`;
      }
    }

    if (this.showTimeEstimateCheck) {
      this.showTimeEstimateCheck.checked = true;
    }

    this.landmarkModal.style.display = 'flex';
    this.landmarkNameInput.focus();
  }

  closeLandmarkModal() {
    this.landmarkModal.style.display = 'none';
    this.pendingLandmarkLatLng = null;
  }

  savePendingLandmark() {
    if (!this.pendingLandmarkLatLng) return;

    const name = this.landmarkNameInput.value.trim() || 'Landmark';
    const desc = this.landmarkDescInput.value.trim();
    const type = this.selectedLandmarkType;
    const config = LANDMARK_TYPES[type];
    const isKm = type === 'km';

    const showTimeEstimate = this.showTimeEstimateCheck ? this.showTimeEstimateCheck.checked : true;

    this.createInternalLandmark({
      lat: this.pendingLandmarkLatLng.lat,
      lng: this.pendingLandmarkLatLng.lng,
      type: type,
      name: name,
      desc: desc,
      isAuto: false,
      showTimeEstimate: showTimeEstimate
    });

    this.saveStateToHistory();
    this.renderLandmarkList();
    this.updateStats();
    this.closeLandmarkModal();
  }

  deleteLandmark(id) {
    const idx = this.landmarks.findIndex(l => l.id === id);
    if (idx !== -1) {
      this.saveStateToHistory();
      if (this.landmarks[idx].marker) {
        this.map.removeLayer(this.landmarks[idx].marker);
      }
      this.landmarks.splice(idx, 1);
      this.renderLandmarkList();
      this.updateStats();
    }
  }

  renderLandmarkList() {
    this.landmarkList.innerHTML = '';
    const total = this.landmarks.length;
    this.landmarkTotalBadge.textContent = total;

    if (total === 0) {
      this.landmarkEmpty.style.display = 'flex';
      return;
    }
    this.landmarkEmpty.style.display = 'none';

    this.landmarks.forEach(l => {
      const config = LANDMARK_TYPES[l.type] || LANDMARK_TYPES.custom;
      const li = document.createElement('li');
      li.className = 'landmark-item';

      let timeBadgeHtml = '';
      if (l.type === 'start') {
        timeBadgeHtml = `<div class="landmark-time-sidebar-tag"><i class="fa-regular fa-clock"></i> Start ${this.startTime}</div>`;
      } else if (l.type === 'start_finish') {
        const totalKm = this.calculateTotalDistance() / 1000;
        if (totalKm > 0) {
          const finishClock = this.calculateEstimatedTimeAtDistance(totalKm);
          timeBadgeHtml = `<div class="landmark-time-sidebar-tag"><i class="fa-regular fa-clock"></i> ${this.startTime} ➔ ${finishClock} (Total: ${totalKm.toFixed(2)} km)</div>`;
        } else {
          timeBadgeHtml = `<div class="landmark-time-sidebar-tag"><i class="fa-regular fa-clock"></i> Start ${this.startTime}</div>`;
        }
      } else if (l.type === 'finish') {
        const totalKm = this.calculateTotalDistance() / 1000;
        if (totalKm > 0) {
          const finishClock = this.calculateEstimatedTimeAtDistance(totalKm);
          timeBadgeHtml = `<div class="landmark-time-sidebar-tag"><i class="fa-regular fa-clock"></i> Finish ${finishClock} (${totalKm.toFixed(2)} km)</div>`;
        }
      } else if (l.showTimeEstimate) {
        const distKm = this.getDistanceFromStartAlongPolyline(L.latLng(l.lat, l.lng));
        if (distKm !== null) {
          const estClock = this.calculateEstimatedTimeAtDistance(distKm);
          if (estClock) {
            timeBadgeHtml = `<div class="landmark-time-sidebar-tag"><i class="fa-regular fa-clock"></i> Pukul ${estClock} (${distKm.toFixed(2)} km)</div>`;
          }
        }
      }

      li.innerHTML = `
        <div class="landmark-info">
          <div class="landmark-icon-circle" style="background-color: ${config.color};">
            <i class="fa-solid ${config.icon}"></i>
          </div>
          <div class="landmark-text-group">
            <div class="landmark-title">${l.name}</div>
            ${timeBadgeHtml}
            ${l.desc ? `<div class="landmark-desc">${l.desc}</div>` : ''}
          </div>
        </div>
        <div class="landmark-actions">
          <button class="mini-icon-btn focus-landmark-btn" title="Fokuskan di Peta">
            <i class="fa-solid fa-eye"></i>
          </button>
          <button class="mini-icon-btn delete-landmark-btn" title="Hapus Landmark">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `;

      li.querySelector('.focus-landmark-btn').addEventListener('click', () => {
        this.map.flyTo([l.lat, l.lng], 17);
        if (l.marker) l.marker.openPopup();
      });

      li.querySelector('.delete-landmark-btn').addEventListener('click', () => {
        this.deleteLandmark(l.id);
      });

      this.landmarkList.appendChild(li);
    });
  }

  getDistanceFromStartAlongPolyline(latlng) {
    const coords = this.routePolyline.getLatLngs();
    if (!coords || coords.length < 2) return null;

    let closestSegmentIdx = 0;
    let minDistanceSq = Infinity;
    let bestProjectionFactor = 0;

    // Hitung jarak segmen terdekat dan proyeksi titik latlng
    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];

      const dx = p2.lng - p1.lng;
      const dy = p2.lat - p1.lat;
      const segLenSq = dx * dx + dy * dy;

      let t = 0;
      if (segLenSq > 0) {
        t = ((latlng.lng - p1.lng) * dx + (latlng.lat - p1.lat) * dy) / segLenSq;
        t = Math.max(0, Math.min(1, t));
      }

      const projLng = p1.lng + t * dx;
      const projLat = p1.lat + t * dy;
      const distSq = Math.pow(latlng.lng - projLng, 2) + Math.pow(latlng.lat - projLat, 2);

      if (distSq < minDistanceSq) {
        minDistanceSq = distSq;
        closestSegmentIdx = i;
        bestProjectionFactor = t;
      }
    }

    // Akumulasi jarak hingga segmen terdekat
    let cumulativeMeters = 0;
    for (let i = 0; i < closestSegmentIdx; i++) {
      cumulativeMeters += coords[i].distanceTo(coords[i + 1]);
    }

    // Tambah jarak p1 ke titik proyeksi pada segmen bersangkutan
    const pStart = coords[closestSegmentIdx];
    const pEnd = coords[closestSegmentIdx + 1];
    const projectedPt = L.latLng(
      pStart.lat + bestProjectionFactor * (pEnd.lat - pStart.lat),
      pStart.lng + bestProjectionFactor * (pEnd.lng - pStart.lng)
    );
    cumulativeMeters += pStart.distanceTo(projectedPt);

    return cumulativeMeters / 1000;
  }

  calculateTotalDistance() {
    const coords = this.routePolyline.getLatLngs();
    if (!coords || coords.length < 2) return 0;

    let totalMeters = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      totalMeters += coords[i].distanceTo(coords[i + 1]);
    }
    return totalMeters;
  }

  updateStats() {
    const totalMeters = this.calculateTotalDistance();
    const km = totalMeters / 1000;
    this.distKmEl.textContent = km.toFixed(2);

    const totalSeconds = Math.round(km * this.paceSeconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const formattedTime = [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0')
    ].join(':');

    this.estTimeEl.textContent = formattedTime;
    this.pointCountEl.textContent = this.waypoints.length;
    this.landmarkCountEl.textContent = this.landmarks.length;
  }

  syncPaceNumberInputs() {
    if (this.paceMinInput && this.paceSecInput) {
      const min = Math.floor(this.paceSeconds / 60);
      const sec = this.paceSeconds % 60;
      this.paceMinInput.value = min;
      this.paceSecInput.value = sec.toString().padStart(2, '0');
    }
  }

  updatePaceDisplay() {
    const min = Math.floor(this.paceSeconds / 60);
    const sec = this.paceSeconds % 60;
    this.paceDisplay.textContent = `${min}:${sec.toString().padStart(2, '0')} /km`;
    this.syncPaceNumberInputs();
  }

  calculateEstimatedTimeAtDistance(distanceKm) {
    if (distanceKm === null || distanceKm === undefined || isNaN(distanceKm)) return null;

    const startStr = this.startTime || '06:00';
    const parts = startStr.split(':');
    const startHour = parseInt(parts[0]) || 6;
    const startMinute = parseInt(parts[1]) || 0;

    const elapsedSeconds = Math.round(distanceKm * this.paceSeconds);
    const totalStartSeconds = (startHour * 3600) + (startMinute * 60) + elapsedSeconds;

    // Hitung jam dan menit (wrap 24 jam)
    const normalizedSeconds = totalStartSeconds % (24 * 3600);
    const targetHour = Math.floor(normalizedSeconds / 3600);
    const targetMinute = Math.floor((normalizedSeconds % 3600) / 60);

    const hh = targetHour.toString().padStart(2, '0');
    const mm = targetMinute.toString().padStart(2, '0');
    return `${hh}:${mm}`;
  }

  getLandmarkTimeTagHtml(lat, lng, type = null) {
    // 1. Kasus Titik Start Line
    if (type === 'start') {
      return `<span class="landmark-time-tag"><i class="fa-regular fa-clock"></i> Start ${this.startTime}</span>`;
    }

    // 2. Kasus Titik Start & Finish (Loop)
    if (type === 'start_finish') {
      const totalKm = this.calculateTotalDistance() / 1000;
      if (totalKm > 0) {
        const finishClock = this.calculateEstimatedTimeAtDistance(totalKm);
        return `<span class="landmark-time-tag"><i class="fa-regular fa-clock"></i> ${this.startTime} ➔ ${finishClock}</span>`;
      }
      return `<span class="landmark-time-tag"><i class="fa-regular fa-clock"></i> Start ${this.startTime}</span>`;
    }

    // 3. Kasus Titik Finish Line
    if (type === 'finish') {
      const totalKm = this.calculateTotalDistance() / 1000;
      if (totalKm > 0) {
        const finishClock = this.calculateEstimatedTimeAtDistance(totalKm);
        return `<span class="landmark-time-tag"><i class="fa-regular fa-clock"></i> Finish ${finishClock} (${totalKm.toFixed(2)} km)</span>`;
      }
      return '';
    }

    // 4. Kasus Landmark Umum / POI sepanjang rute
    const distKm = this.getDistanceFromStartAlongPolyline(L.latLng(lat, lng));
    if (distKm === null) return '';

    const estimatedClock = this.calculateEstimatedTimeAtDistance(distKm);
    if (!estimatedClock) return '';

    return `<span class="landmark-time-tag"><i class="fa-regular fa-clock"></i> ${estimatedClock} (${distKm.toFixed(2)} km)</span>`;
  }

  updateLandmarkMarkersDisplay() {
    this.landmarks.forEach(l => {
      if (!l.marker) return;

      const config = LANDMARK_TYPES[l.type] || LANDMARK_TYPES.custom;
      const isKm = l.type === 'km';
      const labelText = l.name || config.label;
      const pinInnerHtml = isKm
        ? `<span class="km-pin-num">${labelText.replace(/[^0-9.]/g, '') || 'KM'}</span>`
        : `<i class="fa-solid ${config.icon}"></i>`;

      const isStartOrFinish = l.type === 'start' || l.type === 'finish' || l.type === 'start_finish';
      let timeTagHtml = '';
      if (l.showTimeEstimate || isStartOrFinish) {
        timeTagHtml = this.getLandmarkTimeTagHtml(l.lat, l.lng, l.type);
      }

      const updatedIcon = L.divIcon({
        className: 'landmark-div-icon-wrapper',
        html: `
          <div class="landmark-marker-container">
            <div class="landmark-top-label" style="border-color: ${config.color};">
              <span class="landmark-label-text">${labelText}</span>
              ${timeTagHtml}
            </div>
            <div class="landmark-map-pin ${isKm ? 'km-pin' : ''}" style="background-color: ${config.color};">
              ${pinInnerHtml}
            </div>
          </div>
        `,
        iconSize: [100, 72],
        iconAnchor: [50, 66]
      });

      l.marker.setIcon(updatedIcon);
    });

    this.renderLandmarkList();
  }

  updateControlsState() {
    const canUndo = this.undoStack.length > 0;
    const canRedo = this.redoStack.length > 0;

    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
    if (this.quickUndoBtn) this.quickUndoBtn.disabled = !canUndo;
    if (this.quickRedoBtn) this.quickRedoBtn.disabled = !canRedo;

    this.loopRouteBtn.disabled = this.waypoints.length < 2;
    this.reverseRouteBtn.disabled = this.waypoints.length < 2;
  }

  locateUser() {
    if (!navigator.geolocation) {
      alert('Geolocation tidak didukung pada browser Anda.');
      return;
    }
    this.showLoading(true, 'Mendeteksi lokasi Anda...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.showLoading(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        this.map.flyTo([lat, lng], 16);

        L.circleMarker([lat, lng], {
          radius: 9,
          fillColor: '#3b82f6',
          color: '#ffffff',
          weight: 3,
          opacity: 1,
          fillOpacity: 0.9
        }).addTo(this.map).bindPopup('Lokasi Anda Saat Ini').openPopup();
      },
      (err) => {
        this.showLoading(false);
        alert('Gagal mendapatkan lokasi: ' + err.message);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  fitRouteBounds() {
    const polylineBounds = this.routePolyline.getBounds();
    if (polylineBounds.isValid()) {
      this.map.fitBounds(polylineBounds, { padding: [50, 50] });
    } else if (this.landmarks.length > 0) {
      const group = L.featureGroup(this.landmarks.map(l => l.marker));
      this.map.fitBounds(group.getBounds(), { padding: [50, 50] });
    }
  }

  showLoading(show, message = 'Memproses...') {
    this.loadingOverlay.style.display = show ? 'flex' : 'none';
    this.loadingText.textContent = message;
  }

  exportGPX() {
    const routeCoords = this.routePolyline.getLatLngs();
    if (routeCoords.length === 0 && this.landmarks.length === 0) {
      alert('Silakan buat jalur lari atau tambahkan landmark terlebih dahulu!');
      return;
    }

    const title = (this.routeTitleInput.value.trim() || 'Running Route').replace(/[<>&'"]/g, '');
    const nowIso = new Date().toISOString();

    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StrideMap - GPX Running Route Planner"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${title}</name>
    <desc>Dibuat dengan StrideMap - Running Route and Landmark Planner</desc>
    <time>${nowIso}</time>
  </metadata>\n`;

    this.landmarks.forEach(l => {
      const config = LANDMARK_TYPES[l.type] || LANDMARK_TYPES.custom;
      const cleanName = (l.name || config.label).replace(/[<>&'"]/g, '');
      const cleanDesc = (l.desc || config.label).replace(/[<>&'"]/g, '');
      const sym = config.sym || 'Pin, Red';

      gpx += `  <wpt lat="${l.lat.toFixed(6)}" lon="${l.lng.toFixed(6)}">
    <name>${cleanName}</name>
    <desc>${cleanDesc}</desc>
    <sym>${sym}</sym>
    <type>${config.label}</type>
  </wpt>\n`;
    });

    if (routeCoords.length > 0) {
      gpx += `  <trk>
    <name>${title}</name>
    <type>Running</type>
    <trkseg>\n`;

      let cumulativeSeconds = 0;
      const baseTime = Date.now();

      for (let i = 0; i < routeCoords.length; i++) {
        const pt = routeCoords[i];
        if (i > 0) {
          const segDistKm = routeCoords[i - 1].distanceTo(pt) / 1000;
          cumulativeSeconds += segDistKm * this.paceSeconds;
        }
        const ptTime = new Date(baseTime + cumulativeSeconds * 1000).toISOString();
        gpx += `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}">
        <time>${ptTime}</time>
      </trkpt>\n`;
      }

      gpx += `    </trkseg>
  </trk>\n`;
    }

    gpx += `</gpx>`;

    this.downloadFile(gpx, `${title.toLowerCase().replace(/\s+/g, '_')}.gpx`, 'application/gpx+xml');
  }

  exportKML() {
    const routeCoords = this.routePolyline.getLatLngs();
    if (routeCoords.length === 0 && this.landmarks.length === 0) {
      alert('Silakan buat jalur lari atau tambahkan landmark terlebih dahulu!');
      return;
    }

    const title = (this.routeTitleInput.value.trim() || 'Running Route').replace(/[<>&'"]/g, '');

    // KML Style definitions compatible with Google My Maps & Google Earth
    const kmlIconMap = {
      km: 'http://maps.google.com/mapfiles/kml/paddle/grn-circle.png',
      water: 'http://maps.google.com/mapfiles/kml/paddle/blu-circle.png',
      cheering: 'http://maps.google.com/mapfiles/kml/paddle/pink-circle.png',
      start_finish: 'http://maps.google.com/mapfiles/kml/paddle/purple-circle.png',
      start: 'http://maps.google.com/mapfiles/kml/paddle/grn-diamond.png',
      finish: 'http://maps.google.com/mapfiles/kml/paddle/red-diamond.png',
      checkpoint: 'http://maps.google.com/mapfiles/kml/paddle/orange-circle.png',
      toilet: 'http://maps.google.com/mapfiles/kml/paddle/wht-circle.png',
      photo: 'http://maps.google.com/mapfiles/kml/paddle/purple-diamond.png',
      hill: 'http://maps.google.com/mapfiles/kml/paddle/orange-diamond.png',
      custom: 'http://maps.google.com/mapfiles/kml/paddle/red-circle.png'
    };

    let styleDefinitions = `
    <Style id="routeStyle">
      <LineStyle>
        <color>ff024cfc</color>
        <width>6</width>
      </LineStyle>
    </Style>`;

    Object.keys(kmlIconMap).forEach(key => {
      styleDefinitions += `
    <Style id="icon_${key}">
      <IconStyle>
        <scale>1.1</scale>
        <Icon>
          <href>${kmlIconMap[key]}</href>
        </Icon>
      </IconStyle>
    </Style>`;
    });

    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${title}</name>
    <description>Running Route generated by StrideMap with full landmark legends</description>
${styleDefinitions}\n`;

    this.landmarks.forEach(l => {
      const config = LANDMARK_TYPES[l.type] || LANDMARK_TYPES.custom;
      const cleanName = (l.name || config.label).replace(/[<>&'"]/g, '');
      let cleanDesc = (l.desc || '').replace(/[<>&'"]/g, '');

      // Keterangan waktu pelari (Start, Finish, Loop, atau Landmark estimasi)
      if (l.type === 'start') {
        const timeInfo = `Waktu Start: Pukul ${this.startTime}`;
        cleanDesc = cleanDesc ? `${cleanDesc} | ${timeInfo}` : timeInfo;
      } else if (l.type === 'start_finish') {
        const totalKm = this.calculateTotalDistance() / 1000;
        const finishClock = totalKm > 0 ? this.calculateEstimatedTimeAtDistance(totalKm) : this.startTime;
        const timeInfo = `Waktu: Start ${this.startTime} ➔ Finish ${finishClock} (Total: ${totalKm.toFixed(2)} km)`;
        cleanDesc = cleanDesc ? `${cleanDesc} | ${timeInfo}` : timeInfo;
      } else if (l.type === 'finish') {
        const totalKm = this.calculateTotalDistance() / 1000;
        const finishClock = totalKm > 0 ? this.calculateEstimatedTimeAtDistance(totalKm) : '-';
        const timeInfo = `Waktu Finish: Pukul ${finishClock} (Total Jarak: ${totalKm.toFixed(2)} km)`;
        cleanDesc = cleanDesc ? `${cleanDesc} | ${timeInfo}` : timeInfo;
      } else if (l.showTimeEstimate) {
        const distKm = this.getDistanceFromStartAlongPolyline(L.latLng(l.lat, l.lng));
        if (distKm !== null) {
          const estClock = this.calculateEstimatedTimeAtDistance(distKm);
          if (estClock) {
            const timeInfo = `Estimasi Pelari: Pukul ${estClock} (Jarak: ${distKm.toFixed(2)} km dari Start @ Pace ${Math.floor(this.paceSeconds / 60)}:${(this.paceSeconds % 60).toString().padStart(2, '0')}/km)`;
            cleanDesc = cleanDesc ? `${cleanDesc} | ${timeInfo}` : timeInfo;
          }
        }
      }

      const styleId = kmlIconMap[l.type] ? `icon_${l.type}` : 'icon_custom';

      kml += `    <Placemark>
      <name>${cleanName}</name>
      ${cleanDesc ? `<description>${cleanDesc}</description>` : ''}
      <styleUrl>#${styleId}</styleUrl>
      <Point>
        <coordinates>${l.lng.toFixed(6)},${l.lat.toFixed(6)},0</coordinates>
      </Point>
    </Placemark>\n`;
    });

    if (routeCoords.length > 0) {
      const coordStr = routeCoords.map(pt => `${pt.lng.toFixed(6)},${pt.lat.toFixed(6)},0`).join(' ');
      kml += `    <Placemark>
      <name>${title} (Track Lari)</name>
      <styleUrl>#routeStyle</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          ${coordStr}
        </coordinates>
      </LineString>
    </Placemark>\n`;
    }

    kml += `  </Document>
</kml>`;

    this.downloadFile(kml, `${title.toLowerCase().replace(/\s+/g, '_')}.kml`, 'application/vnd.google-earth.kml+xml');
  }

  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      if (file.name.endsWith('.kml')) {
        this.parseKML(text);
      } else {
        this.parseGPX(text);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  parseGPX(xmlText) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

      const wpts = xmlDoc.getElementsByTagName('wpt');
      if (wpts.length > 0) {
        for (let i = 0; i < wpts.length; i++) {
          const w = wpts[i];
          const lat = parseFloat(w.getAttribute('lat'));
          const lng = parseFloat(w.getAttribute('lon'));
          const name = w.getElementsByTagName('name')[0]?.textContent || 'Landmark';
          const desc = w.getElementsByTagName('desc')[0]?.textContent || '';
          const type = w.getElementsByTagName('type')[0]?.textContent?.toLowerCase() || '';

          let matchedType = 'custom';
          if (type.includes('water') || name.toLowerCase().includes('water')) matchedType = 'water';
          else if (type.includes('start') || name.toLowerCase().includes('start')) matchedType = 'start';
          else if (type.includes('finish') || name.toLowerCase().includes('finish')) matchedType = 'finish';
          else if (type.includes('toilet') || name.toLowerCase().includes('toilet')) matchedType = 'toilet';
          else if (type.includes('hill') || name.toLowerCase().includes('tanjakan')) matchedType = 'hill';

          this.selectedLandmarkType = matchedType;
          this.pendingLandmarkLatLng = L.latLng(lat, lng);
          this.landmarkNameInput.value = name;
          this.landmarkDescInput.value = desc;
          this.savePendingLandmark();
        }
      }

      const trkpts = xmlDoc.getElementsByTagName('trkpt');
      if (trkpts.length > 0) {
        const importedCoords = [];
        for (let i = 0; i < trkpts.length; i++) {
          const pt = trkpts[i];
          const lat = parseFloat(pt.getAttribute('lat'));
          const lng = parseFloat(pt.getAttribute('lon'));
          importedCoords.push(L.latLng(lat, lng));
        }

        this.waypoints = [];
        const step = Math.max(1, Math.floor(importedCoords.length / 25));
        for (let i = 0; i < importedCoords.length; i += step) {
          this.waypoints.push(importedCoords[i]);
        }
        if (this.waypoints[this.waypoints.length - 1] !== importedCoords[importedCoords.length - 1]) {
          this.waypoints.push(importedCoords[importedCoords.length - 1]);
        }

        this.routePolyline.setLatLngs(importedCoords);
        this.renderWaypointMarkers();
        this.updateStats();
        this.fitRouteBounds();
      }

      alert('File GPX berhasil dimuat!');
    } catch (err) {
      alert('Format GPX tidak valid: ' + err.message);
    }
  }

  parseKML(kmlText) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(kmlText, 'text/xml');
      const placemarks = xmlDoc.getElementsByTagName('Placemark');

      for (let i = 0; i < placemarks.length; i++) {
        const pm = placemarks[i];
        const name = pm.getElementsByTagName('name')[0]?.textContent || 'Landmark';
        const desc = pm.getElementsByTagName('description')[0]?.textContent || '';

        const point = pm.getElementsByTagName('Point')[0];
        if (point) {
          const coords = point.getElementsByTagName('coordinates')[0]?.textContent.trim().split(',');
          if (coords && coords.length >= 2) {
            const lng = parseFloat(coords[0]);
            const lat = parseFloat(coords[1]);

            this.selectedLandmarkType = 'custom';
            this.pendingLandmarkLatLng = L.latLng(lat, lng);
            this.landmarkNameInput.value = name;
            this.landmarkDescInput.value = desc;
            this.savePendingLandmark();
          }
        }

        const lineString = pm.getElementsByTagName('LineString')[0];
        if (lineString) {
          const coordsText = lineString.getElementsByTagName('coordinates')[0]?.textContent.trim();
          if (coordsText) {
            const rawPoints = coordsText.split(/\s+/);
            const importedCoords = [];
            rawPoints.forEach(p => {
              const parts = p.split(',');
              if (parts.length >= 2) {
                importedCoords.push(L.latLng(parseFloat(parts[1]), parseFloat(parts[0])));
              }
            });

            if (importedCoords.length > 0) {
              this.routePolyline.setLatLngs(importedCoords);
              this.waypoints = [importedCoords[0], importedCoords[importedCoords.length - 1]];
              this.renderWaypointMarkers();
              this.updateStats();
              this.fitRouteBounds();
            }
          }
        }
      }
      alert('File KML berhasil dimuat!');
    } catch (err) {
      alert('Format KML tidak valid: ' + err.message);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.strideApp = new StrideMapApp();
});
