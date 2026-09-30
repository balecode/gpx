/**
 * StrideMap - Running Route & GPX/KML Creator
 * Features:
 * - Leaflet map with OpenStreetMap
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

const ROUTE_PRESETS = {
  '5k': { name: 'Rute 5K', color: '#0284c7', startTime: '06:30', paceSeconds: 360 },
  '10k': { name: 'Rute 10K', color: '#10b981', startTime: '06:00', paceSeconds: 390 },
  '21k': { name: 'Rute 21K (HM)', color: '#f59e0b', startTime: '05:30', paceSeconds: 360 },
  '42k': { name: 'Rute 42K (FM)', color: '#8b5cf6', startTime: '05:00', paceSeconds: 360 }
};

const COLOR_PALETTE = ['#0284c7', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#fc4c02', '#06b6d4', '#84cc16'];

const LIVE_PACES = [
  { pace: 3, name: 'Pace 3', paceSeconds: 180, color: '#ec4899', speedKmH: '20.0' },
  { pace: 4, name: 'Pace 4', paceSeconds: 240, color: '#ef4444', speedKmH: '15.0' },
  { pace: 5, name: 'Pace 5', paceSeconds: 300, color: '#ea580c', speedKmH: '12.0' },
  { pace: 6, name: 'Pace 6', paceSeconds: 360, color: '#10b981', speedKmH: '10.0' },
  { pace: 7, name: 'Pace 7', paceSeconds: 420, color: '#0284c7', speedKmH: '8.6' },
  { pace: 8, name: 'Pace 8', paceSeconds: 480, color: '#8b5cf6', speedKmH: '7.5' }
];

class StrideMapApp {
  constructor() {
    this.map = null;
    this.tileLayer = null;
    
    this.currentMode = 'move'; // Default mode: 'move' (geser & jelajahi peta tanpa klik rute)
    
    // Sistem Manajemen Multi-Rute
    this.routes = [];
    this.activeRouteId = null;

    // Landmark & POI
    this.landmarks = [];
    this.landmarkMarkers = [];
    this.selectedLandmarkType = 'water';
    this.pendingLandmarkLatLng = null;

    // Loop Snapping Recommendation (Start-to-Finish close detector)
    this.isNearStart = false;
    this.loopSnapMarker = null;

    // Mode Cek Pace Titik (Point Pace Inspector)
    this.paceInspectMarker = null;
    this.paceInspectState = null;

    // Mode Live / Simulasi Pelari
    this.liveSimulationRunning = false;
    this.liveSimulationTimer = null;
    this.liveCurrentSeconds = 6 * 3600 + 30 * 60; // 06:30:00
    this.liveSpeedMultiplier = 15;
    this.liveActivePaces = new Set([3, 4, 5, 6, 7, 8]);
    this.liveRunnerMarkers = new Map(); // key: `${route.id}_p${pace}` -> L.marker

    this.initDOMElements();
    this.initMap();
    // Buat rute default awal (Rute 5K) setelah map siap
    this.initDefaultRoute();

    this.setMode('route'); // Default mode 'route' agar klik peta langsung membuat rute
    this.bindEvents();
    this.renderLandmarkBadges();
    this.renderRouteList();
    this.updateStats();
    
    // Pulihkan rute & landmark terakhir yang disimpan di localStorage
    this.loadSavedRoute();
  }

  // Helper untuk memastikan layer polyline sebuah rute terpasang dengan benar di Leaflet
  ensureRoutePolylineLayer(route) {
    if (!route) return;
    if (!route.polyline) {
      route.polyline = this.createRoutePolyline(route);
    }
    if (route.visible && this.map && !this.map.hasLayer(route.polyline)) {
      route.polyline.addTo(this.map);
    }
  }

  // --- Getter / Setter untuk Rute Aktif Saat Ini ---
  getActiveRoute() {
    let r = this.routes.find(route => route.id === this.activeRouteId);
    if (!r && this.routes.length > 0) {
      this.activeRouteId = this.routes[0].id;
      r = this.routes[0];
    }
    return r;
  }

  get waypoints() {
    const r = this.getActiveRoute();
    return r ? r.waypoints : [];
  }
  set waypoints(val) {
    const r = this.getActiveRoute();
    if (r) r.waypoints = val;
  }

  get routePolyline() {
    const r = this.getActiveRoute();
    return r ? r.polyline : null;
  }

  get waypointMarkers() {
    const r = this.getActiveRoute();
    return r ? r.waypointMarkers : [];
  }
  set waypointMarkers(val) {
    const r = this.getActiveRoute();
    if (r) r.waypointMarkers = val;
  }

  get undoStack() {
    const r = this.getActiveRoute();
    return r ? r.undoStack : [];
  }
  set undoStack(val) {
    const r = this.getActiveRoute();
    if (r) r.undoStack = val;
  }

  get redoStack() {
    const r = this.getActiveRoute();
    return r ? r.redoStack : [];
  }
  set redoStack(val) {
    const r = this.getActiveRoute();
    if (r) r.redoStack = val;
  }

  get paceSeconds() {
    const r = this.getActiveRoute();
    return r ? r.paceSeconds : 360;
  }
  set paceSeconds(val) {
    const r = this.getActiveRoute();
    if (r) r.paceSeconds = val;
  }

  get startTime() {
    const r = this.getActiveRoute();
    return r ? r.startTime : '06:00';
  }
  set startTime(val) {
    const r = this.getActiveRoute();
    if (r) r.startTime = val;
  }

  get snapToRoad() {
    const r = this.getActiveRoute();
    return r && r.snapToRoad !== undefined ? r.snapToRoad : true;
  }
  set snapToRoad(val) {
    const r = this.getActiveRoute();
    if (r) r.snapToRoad = val;
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
    this.modePaceCheckBtn = document.getElementById('modePaceCheckBtn');
    this.modeLiveBtn = document.getElementById('modeLiveBtn');
    this.modeScrollLeftBtn = document.getElementById('modeScrollLeftBtn');
    this.modeScrollRightBtn = document.getElementById('modeScrollRightBtn');
    this.modeScrollContainer = document.getElementById('modeScrollContainer');
    this.modeSelectorGroup = document.getElementById('modeSelectorGroup');

    this.gpsHelpModal = document.getElementById('gpsHelpModal');
    this.closeGpsHelpModalBtn = document.getElementById('closeGpsHelpModalBtn');
    this.closeGpsHelpModalBtn2 = document.getElementById('closeGpsHelpModalBtn2');
    this.gpsUseIpBtn = document.getElementById('gpsUseIpBtn');
    this.gpsOriginUrlCode = document.getElementById('gpsOriginUrlCode');

    this.moveHintOptions = document.getElementById('moveHintOptions');
    this.routingOptions = document.getElementById('routingOptions');
    this.landmarkOptions = document.getElementById('landmarkOptions');
    this.paceCheckOptions = document.getElementById('paceCheckOptions');
    this.liveSimulationOptions = document.getElementById('liveSimulationOptions');

    this.liveSimulationStatus = document.getElementById('liveSimulationStatus');
    this.liveSyncCurrentTimeBtn = document.getElementById('liveSyncCurrentTimeBtn');
    this.liveClockDisplay = document.getElementById('liveClockDisplay');
    this.liveClockSub = document.getElementById('liveClockSub');
    this.liveTimeSlider = document.getElementById('liveTimeSlider');
    this.liveSliderMinLabel = document.getElementById('liveSliderMinLabel');
    this.liveSliderCurrentLabel = document.getElementById('liveSliderCurrentLabel');
    this.liveSliderMaxLabel = document.getElementById('liveSliderMaxLabel');
    this.liveStepBackBtn = document.getElementById('liveStepBackBtn');
    this.livePlayPauseBtn = document.getElementById('livePlayPauseBtn');
    this.liveStepForwardBtn = document.getElementById('liveStepForwardBtn');
    this.liveSpeedSelect = document.getElementById('liveSpeedSelect');
    this.livePaceChips = document.getElementById('livePaceChips');
    this.liveRunnerStatusList = document.getElementById('liveRunnerStatusList');

    this.paceCheckEmpty = document.getElementById('paceCheckEmpty');
    this.paceCheckResultCard = document.getElementById('paceCheckResultCard');
    this.inspectTargetTimeInput = document.getElementById('inspectTargetTimeInput');
    this.saveAsLandmarkBtn = document.getElementById('saveAsLandmarkBtn');
    this.clearInspectBtn = document.getElementById('clearInspectBtn');

    this.addNewRouteBtn = document.getElementById('addNewRouteBtn');
    this.routeList = document.getElementById('routeList');
    this.activeRouteStatsBadge = document.getElementById('activeRouteStatsBadge');

    this.snapRoadToggle = document.getElementById('snapRoadToggle');
    this.routeModeAutoBtn = document.getElementById('routeModeAutoBtn');
    this.routeModeManualBtn = document.getElementById('routeModeManualBtn');
    this.routingModeBadge = document.getElementById('routingModeBadge');
    this.routingModeHintText = document.getElementById('routingModeHintText');
    this.floatingRoutingToggle = document.getElementById('floatingRoutingToggle');
    this.floatingAutoRouteBtn = document.getElementById('floatingAutoRouteBtn');
    this.floatingManualRouteBtn = document.getElementById('floatingManualRouteBtn');
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

    // Tile layer jalan OpenStreetMap
    this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap France contributors'
    }).addTo(this.map);

    // Inisialisasi dan pasang polyline untuk seluruh rute yang ada
    this.routes.forEach(route => {
      this.ensureRoutePolylineLayer(route);
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


    this.initModeScrollNavigation();

    this.modeMoveBtn.addEventListener('click', () => this.setMode('move'));
    this.modeRouteBtn.addEventListener('click', () => this.setMode('route'));
    this.modeLandmarkBtn.addEventListener('click', () => this.setMode('landmark'));
    this.modePaceCheckBtn.addEventListener('click', () => this.setMode('pacecheck'));
    if (this.modeLiveBtn) {
      this.modeLiveBtn.addEventListener('click', () => this.setMode('live'));
    }

    if (this.livePlayPauseBtn) {
      this.livePlayPauseBtn.addEventListener('click', () => this.toggleLivePlayPause());
    }
    if (this.liveStepBackBtn) {
      this.liveStepBackBtn.addEventListener('click', () => this.stepLiveSimulation(-300));
    }
    if (this.liveStepForwardBtn) {
      this.liveStepForwardBtn.addEventListener('click', () => this.stepLiveSimulation(300));
    }
    if (this.liveTimeSlider) {
      this.liveTimeSlider.addEventListener('input', (e) => {
        this.liveCurrentSeconds = parseInt(e.target.value);
        this.updateLiveSimulation();
      });
    }
    if (this.liveSpeedSelect) {
      this.liveSpeedSelect.addEventListener('change', (e) => {
        this.liveSpeedMultiplier = parseInt(e.target.value) || 15;
      });
    }
    if (this.liveSyncCurrentTimeBtn) {
      this.liveSyncCurrentTimeBtn.addEventListener('click', () => this.syncLiveToCurrentLocalTime());
    }

    if (this.inspectTargetTimeInput) {
      this.inspectTargetTimeInput.addEventListener('input', () => this.recalculatePaceInspection());
      this.inspectTargetTimeInput.addEventListener('change', () => this.recalculatePaceInspection());
    }
    if (this.saveAsLandmarkBtn) {
      this.saveAsLandmarkBtn.addEventListener('click', () => this.saveInspectedPointAsLandmark());
    }
    if (this.clearInspectBtn) {
      this.clearInspectBtn.addEventListener('click', () => this.clearPaceInspection());
    }

    if (this.addNewRouteBtn) {
      this.addNewRouteBtn.addEventListener('click', () => this.addNewCustomRoute());
    }

    document.querySelectorAll('#routePresetChips .preset-chip-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const presetKey = e.currentTarget.getAttribute('data-preset');
        this.addOrSwitchPresetRoute(presetKey);
      });
    });

    if (this.routeModeAutoBtn) {
      this.routeModeAutoBtn.addEventListener('click', () => this.setRoutingSnapMode(true));
    }
    if (this.routeModeManualBtn) {
      this.routeModeManualBtn.addEventListener('click', () => this.setRoutingSnapMode(false));
    }
    if (this.floatingAutoRouteBtn) {
      this.floatingAutoRouteBtn.addEventListener('click', () => this.setRoutingSnapMode(true));
    }
    if (this.floatingManualRouteBtn) {
      this.floatingManualRouteBtn.addEventListener('click', () => this.setRoutingSnapMode(false));
    }

    if (this.snapRoadToggle) {
      this.snapRoadToggle.addEventListener('change', (e) => {
        this.setRoutingSnapMode(e.target.checked);
      });
    }

    // Shortcut keyboard 'M' untuk switch cepat antara Auto dan Manual saat membuat rute
    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (this.currentMode === 'route' && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        this.setRoutingSnapMode(!this.snapToRoad);
      }
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
      const onStartTimeChange = (e) => {
        const val = e.target.value || '06:00';
        this.updateRouteStartTime(this.activeRouteId, val);
      };
      this.startTimeInput.addEventListener('input', onStartTimeChange);
      this.startTimeInput.addEventListener('change', onStartTimeChange);
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

    if (this.closeGpsHelpModalBtn) {
      this.closeGpsHelpModalBtn.addEventListener('click', () => this.closeGpsHelpModal());
    }
    if (this.closeGpsHelpModalBtn2) {
      this.closeGpsHelpModalBtn2.addEventListener('click', () => this.closeGpsHelpModal());
    }
    if (this.gpsHelpModal) {
      this.gpsHelpModal.addEventListener('click', (e) => {
        if (e.target === this.gpsHelpModal) this.closeGpsHelpModal();
      });
    }
    if (this.gpsUseIpBtn) {
      this.gpsUseIpBtn.addEventListener('click', () => this.fetchIpLocation());
    }
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
    this.modePaceCheckBtn.classList.toggle('active', mode === 'pacecheck');
    if (this.modeLiveBtn) this.modeLiveBtn.classList.toggle('active', mode === 'live');

    this.moveHintOptions.style.display = mode === 'move' ? 'block' : 'none';
    this.routingOptions.style.display = mode === 'route' ? 'block' : 'none';
    this.landmarkOptions.style.display = mode === 'landmark' ? 'block' : 'none';
    this.paceCheckOptions.style.display = mode === 'pacecheck' ? 'block' : 'none';
    if (this.liveSimulationOptions) this.liveSimulationOptions.style.display = mode === 'live' ? 'flex' : 'none';

    // Pastikan tombol mode aktif terlihat di container scrollable (horizontal saja)
    let activeBtn = null;
    if (mode === 'move') activeBtn = this.modeMoveBtn;
    else if (mode === 'route') activeBtn = this.modeRouteBtn;
    else if (mode === 'landmark') activeBtn = this.modeLandmarkBtn;
    else if (mode === 'pacecheck') activeBtn = this.modePaceCheckBtn;
    else if (mode === 'live') activeBtn = this.modeLiveBtn;
    if (activeBtn && this.modeSelectorGroup) {
      const targetScroll = activeBtn.offsetLeft - 12;
      this.modeSelectorGroup.scrollTo({ left: Math.max(0, targetScroll), behavior: 'smooth' });
    }

    // Sesuaikan kursor pada container peta
    const mapContainer = document.getElementById('map');
    if (mapContainer) {
      mapContainer.style.cursor = (mode === 'move' || mode === 'live') ? 'grab' : 'crosshair';
    }

    if (mode === 'pacecheck' && this.paceInspectState) {
      this.recalculatePaceInspection();
    }

    if (mode === 'live') {
      this.initLiveSimulationTimeWindow();
      this.renderLivePaceChips();
      this.updateLiveSimulation();
    } else {
      this.pauseLiveSimulation();
      this.clearLiveRunnerMarkers();
    }

    // Tampilkan / sembunyikan toggle cepat routing di atas peta (hanya muncul saat mode 'route')
    if (this.floatingRoutingToggle) {
      this.floatingRoutingToggle.style.display = mode === 'route' ? 'flex' : 'none';
      if (mode === 'route') {
        this.setRoutingSnapMode(this.snapToRoad);
      }
    }

    // Perbarui penampakan marker waypoint rute: HANYA tampil di mode 'route'
    this.renderWaypointMarkers();
  }

  setRoutingSnapMode(isAuto) {
    this.snapToRoad = isAuto;
    if (this.snapRoadToggle) this.snapRoadToggle.checked = isAuto;

    if (this.routeModeAutoBtn) this.routeModeAutoBtn.classList.toggle('active', isAuto);
    if (this.routeModeManualBtn) this.routeModeManualBtn.classList.toggle('active', !isAuto);

    if (this.floatingAutoRouteBtn) this.floatingAutoRouteBtn.classList.toggle('active', isAuto);
    if (this.floatingManualRouteBtn) this.floatingManualRouteBtn.classList.toggle('active', !isAuto);

    if (this.routingModeBadge) {
      this.routingModeBadge.className = `routing-badge ${isAuto ? 'auto' : 'manual'}`;
      this.routingModeBadge.innerHTML = isAuto
        ? '<i class="fa-solid fa-magnet"></i> Auto Jalan'
        : '<i class="fa-solid fa-pen-ruler"></i> Manual Bebas';
    }

    if (this.routingModeHintText) {
      this.routingModeHintText.innerHTML = isAuto
        ? '<i class="fa-solid fa-circle-check text-sky"></i> <strong>Mode Auto:</strong> Titik baru otomatis mengikuti lekukan jalan.'
        : '<i class="fa-solid fa-crosshairs text-orange"></i> <strong>Mode Manual:</strong> Titik baru ditarik garis lurus bebas (cocok untuk memotong taman, gang, atau lawan arah).';
    }

    const r = this.getActiveRoute();
    if (r) r.snapToRoad = isAuto;
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
    if (this.currentMode === 'move' || this.currentMode === 'live') {
      // Pada mode Move/Geser dan Live, klik tidak akan menambah titik atau landmark
      return;
    }

    const latlng = e.latlng;
    if (this.currentMode === 'pacecheck') {
      this.handlePaceCheckClick(latlng);
      return;
    }

    if (this.currentMode === 'landmark') {
      this.openLandmarkModal(latlng);
    } else {
      // Jika berada dekat titik start rute aktif dan ada indikasi rekomendasi gabung loop
      if (this.isNearStart && this.waypoints && this.waypoints.length >= 2 && this.waypoints[0]) {
        const startPoint = this.waypoints[0];
        this.clearLoopSnapRecommendation();
        this.addWaypoint(L.latLng(startPoint.lat, startPoint.lng));
      } else {
        this.clearLoopSnapRecommendation();
        this.addWaypoint(latlng);
      }
    }
  }

  handleMapMouseMove(e) {
    if (this.currentMode !== 'route' || !this.waypoints || this.waypoints.length < 2) {
      this.clearLoopSnapRecommendation();
      return;
    }

    const mouseLatLng = e.latlng;
    const startPoint = this.waypoints[0];
    if (!startPoint || startPoint.lat === undefined) {
      this.clearLoopSnapRecommendation();
      return;
    }
    
    // Konversi koordinat ke pixel pada layar saat ini untuk deteksi hover presisi
    const mousePoint = this.map.latLngToContainerPoint(mouseLatLng);
    const startPixel = this.map.latLngToContainerPoint(startPoint);
    const pixelDistance = mousePoint.distanceTo(startPixel);

    // Hover terdeteksi jika kursor berada dalam radius 35 pixel di sekitar icon start rute aktif
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
    if (!startPoint || !this.waypoints || this.waypoints.length < 2 || startPoint.lat === undefined) {
      this.clearLoopSnapRecommendation();
      return;
    }
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

  // Sinkronisasi otomatis Landmark Start, Finish, atau Start & Finish untuk semua rute terlihat
  syncAutoStartFinishLandmarks() {
    // 1. Hapus auto landmark yang sebelumnya dibuat
    this.landmarks = this.landmarks.filter(l => {
      if (l.isAuto) {
        if (l.marker) this.map.removeLayer(l.marker);
        return false;
      }
      return true;
    });

    this.routes.forEach(route => {
      if (!route.visible || !route.waypoints || route.waypoints.length === 0) return;

      const startPt = route.waypoints[0];
      const routePrefix = this.routes.length > 1 ? ` (${route.name})` : '';

      if (route.waypoints.length === 1) {
        this.createInternalLandmark({
          lat: startPt.lat,
          lng: startPt.lng,
          type: 'start',
          name: `Start${routePrefix}`,
          desc: `Titik awal ${route.name}`,
          isAuto: true,
          routeId: route.id
        });
        return;
      }

      const endPt = route.waypoints[route.waypoints.length - 1];
      const isSamePoint = startPt.distanceTo(endPt) < 15;

      if (isSamePoint) {
        this.createInternalLandmark({
          lat: startPt.lat,
          lng: startPt.lng,
          type: 'start_finish',
          name: `Start & Finish${routePrefix}`,
          desc: `Loop ${route.name}`,
          isAuto: true,
          routeId: route.id
        });
      } else {
        this.createInternalLandmark({
          lat: startPt.lat,
          lng: startPt.lng,
          type: 'start',
          name: `Start${routePrefix}`,
          desc: `Titik awal ${route.name}`,
          isAuto: true,
          routeId: route.id
        });

        this.createInternalLandmark({
          lat: endPt.lat,
          lng: endPt.lng,
          type: 'finish',
          name: `Finish${routePrefix}`,
          desc: `Titik finish ${route.name}`,
          isAuto: true,
          routeId: route.id
        });
      }
    });

    this.renderLandmarkList();
    this.updateStats();
  }

  createInternalLandmark({ lat, lng, type, name, desc, isAuto = false, showTimeEstimate = true, routeId = null }) {
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

    // Klik pada marker: jika sedang mode 'route', langsung tambahkan titik koordinat ini sebagai waypoint!
    marker.on('click', (e) => {
      if (this.currentMode === 'route') {
        L.DomEvent.stopPropagation(e);
        this.clearLoopSnapRecommendation();
        this.addWaypoint(L.latLng(lat, lng));
        return;
      }
    });

    // Hover untuk loop snap: HANYA jika landmark ini adalah start dari rute yang sedang aktif dan waypoints >= 2
    if (isAuto && (type === 'start' || type === 'start_finish')) {
      marker.on('mouseover', () => {
        const activeRoute = this.getActiveRoute();
        if (
          this.currentMode === 'route' &&
          activeRoute &&
          activeRoute.id === routeId &&
          this.waypoints &&
          this.waypoints.length >= 2
        ) {
          this.showLoopSnapRecommendation(L.latLng(lat, lng));
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
      id: isAuto ? `auto_${type}_${routeId || ''}` : Date.now().toString() + Math.random().toString(36).substr(2, 4),
      lat: lat,
      lng: lng,
      type: type,
      name: name,
      desc: desc,
      isAuto: isAuto,
      routeId: routeId,
      showTimeEstimate: showTimeEstimate,
      marker: marker
    };

    this.landmarks.push(landmarkObj);
    return landmarkObj;
  }

  // --- Snapshot State untuk Undo / Redo ---
  takeSnapshot() {
    return {
      waypoints: this.waypoints.map(w => {
        const pt = L.latLng(w.lat, w.lng);
        pt.mode = w.mode || 'auto';
        pt.segmentCoords = w.segmentCoords ? JSON.parse(JSON.stringify(w.segmentCoords)) : null;
        return pt;
      }),
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
        routes: this.routes.map(r => ({
          id: r.id,
          name: r.name,
          color: r.color,
          visible: r.visible,
          waypoints: r.waypoints.map(w => ({
            lat: w.lat,
            lng: w.lng,
            mode: w.mode || 'auto',
            segmentCoords: w.segmentCoords || null
          })),
          routePolyline: r.polyline ? r.polyline.getLatLngs().map(p => ({ lat: p.lat, lng: p.lng })) : [],
          paceSeconds: r.paceSeconds || 360,
          startTime: r.startTime || '06:00',
          snapToRoad: r.snapToRoad !== undefined ? r.snapToRoad : true
        })),
        activeRouteId: this.activeRouteId,
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
        routeTitle: this.routeTitleInput ? this.routeTitleInput.value : 'My Running Route'
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
      if (!data) return;

      if (data.routeTitle && this.routeTitleInput) {
        this.routeTitleInput.value = data.routeTitle;
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

      // 2. Muat routes jika format multi-rute
      if (data.routes && Array.isArray(data.routes) && data.routes.length > 0) {
        // Hapus rute bawaan sebelumnya
        this.routes.forEach(r => {
          if (r.polyline) this.map.removeLayer(r.polyline);
          r.waypointMarkers.forEach(m => this.map.removeLayer(m));
        });
        this.routes = [];

        data.routes.forEach(savedR => {
          const rObj = this.createRoute({
            id: savedR.id,
            name: savedR.name,
            color: savedR.color,
            visible: savedR.visible !== undefined ? savedR.visible : true,
            paceSeconds: savedR.paceSeconds || 360,
            startTime: savedR.startTime || '06:00',
            snapToRoad: savedR.snapToRoad !== undefined ? savedR.snapToRoad : true,
            waypoints: savedR.waypoints ? savedR.waypoints.map(w => {
              const pt = L.latLng(w.lat, w.lng);
              pt.mode = w.mode || 'auto';
              pt.segmentCoords = w.segmentCoords || null;
              return pt;
            }) : [],
            polylineCoords: savedR.routePolyline ? savedR.routePolyline.map(p => L.latLng(p.lat, p.lng)) : []
          });
          this.routes.push(rObj);
          this.ensureRoutePolylineLayer(rObj);

          if (rObj.waypoints.length >= 2 && (!savedR.routePolyline || savedR.routePolyline.length < 2)) {
            rObj.polyline.setLatLngs(rObj.waypoints);
          }
        });

        this.activeRouteId = data.activeRouteId || this.routes[0].id;
        this.setActiveRoute(this.activeRouteId);
        this.syncAutoStartFinishLandmarks();
        this.renderRouteList();
        setTimeout(() => this.fitRouteBounds(), 400);
      } else if (data.waypoints && Array.isArray(data.waypoints) && data.waypoints.length > 0) {
        // Format lama (single route migration)
        const defRoute = this.routes[0];
        if (defRoute) {
          defRoute.waypoints = data.waypoints.map(w => {
            const pt = L.latLng(w.lat, w.lng);
            pt.mode = w.mode || 'auto';
            pt.segmentCoords = w.segmentCoords || null;
            return pt;
          });
          if (data.paceSeconds) defRoute.paceSeconds = data.paceSeconds;
          if (data.startTime) defRoute.startTime = data.startTime;
          if (data.snapToRoad !== undefined) defRoute.snapToRoad = data.snapToRoad;
          this.ensureRoutePolylineLayer(defRoute);
          if (data.routePolyline && Array.isArray(data.routePolyline) && data.routePolyline.length >= 2) {
            defRoute.polyline.setLatLngs(data.routePolyline.map(p => L.latLng(p.lat, p.lng)));
          } else {
            await this.recalculateRoute(false);
          }
          this.setActiveRoute(defRoute.id);
          this.syncAutoStartFinishLandmarks();
          this.renderRouteList();
          setTimeout(() => this.fitRouteBounds(), 400);
        }
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
    // 1. Restore Waypoints dengan preserve segmen
    this.waypoints = snapshot.waypoints.map(w => {
      const pt = L.latLng(w.lat, w.lng);
      pt.mode = w.mode || 'auto';
      pt.segmentCoords = w.segmentCoords ? JSON.parse(JSON.stringify(w.segmentCoords)) : null;
      return pt;
    });
    this.updatePolylineFromSegments();
    this.renderWaypointMarkers();
    this.syncAutoStartFinishLandmarks();

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

  // --- Routing Logic (Hybrid: Auto Road + Manual Straight Line) ---
  async addWaypoint(latlng, forcedMode = null) {
    this.saveStateToHistory();
    const pt = L.latLng(latlng.lat, latlng.lng);
    const mode = forcedMode || (this.snapToRoad ? 'auto' : 'manual');
    pt.mode = mode;

    const r = this.getActiveRoute();
    if (!r) return;

    if (this.waypoints.length === 0) {
      pt.mode = 'start';
      pt.segmentCoords = [];
      this.waypoints.push(pt);
      this.updatePolylineFromSegments();
    } else {
      const prevPt = this.waypoints[this.waypoints.length - 1];
      if (mode === 'auto') {
        this.showLoading(true, 'Menghubungkan via jalan (OSRM)...');
        try {
          const coords = await this.fetchSegmentRoute(prevPt, pt);
          pt.segmentCoords = coords;
        } catch (e) {
          console.warn('OSRM segment fallback ke manual line:', e);
          pt.segmentCoords = [[prevPt.lat, prevPt.lng], [pt.lat, pt.lng]];
        } finally {
          this.showLoading(false);
        }
      } else {
        // Mode Manual: langsung garis lurus bebas tanpa OSRM
        pt.segmentCoords = [[prevPt.lat, prevPt.lng], [pt.lat, pt.lng]];
      }
      this.waypoints.push(pt);
      this.updatePolylineFromSegments();
    }

    this.renderWaypointMarkers();
    this.syncAutoStartFinishLandmarks();
    this.updateLandmarkMarkersDisplay();
    this.updateStats();
    this.updateControlsState();
    this.saveToStorage();

    if (this.paceInspectMarker && this.paceInspectState) {
      const reProj = this.getProjectionOnRoute(this.paceInspectState.latlng);
      if (reProj) {
        this.paceInspectState.latlng = reProj.latlng;
        this.paceInspectState.distanceKm = reProj.distanceKm;
        this.paceInspectMarker.setLatLng(reProj.latlng);
        this.recalculatePaceInspection();
      }
    }
  }

  async fetchSegmentRoute(fromPt, toPt) {
    try {
      const url = `https://router.project-osrm.org/route/v1/foot/${fromPt.lng},${fromPt.lat};${toPt.lng},${toPt.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      }
    } catch (err) {
      console.warn('Gagal fetch segmen OSRM, fallback ke garis lurus:', err);
    }
    return [[fromPt.lat, fromPt.lng], [toPt.lat, toPt.lng]];
  }

  updatePolylineFromSegments() {
    const activeRoute = this.getActiveRoute();
    if (!activeRoute) return;
    this.ensureRoutePolylineLayer(activeRoute);

    if (this.waypoints.length <= 1) {
      if (this.routePolyline) this.routePolyline.setLatLngs([]);
      return;
    }

    const fullCoords = [];
    for (let i = 1; i < this.waypoints.length; i++) {
      const pt = this.waypoints[i];
      const prevPt = this.waypoints[i - 1];
      const segCoords = (pt.segmentCoords && pt.segmentCoords.length > 0)
        ? pt.segmentCoords
        : [[prevPt.lat, prevPt.lng], [pt.lat, pt.lng]];

      if (fullCoords.length > 0 && segCoords.length > 0) {
        fullCoords.push(...segCoords.slice(1));
      } else {
        fullCoords.push(...segCoords);
      }
    }

    if (this.routePolyline) {
      this.routePolyline.setLatLngs(fullCoords);
    }
  }

  async recalculateRoute(saveHistory = false) {
    if (saveHistory) {
      this.saveStateToHistory();
    }

    const activeRoute = this.getActiveRoute();
    if (!activeRoute) return;

    this.ensureRoutePolylineLayer(activeRoute);

    if (this.waypoints.length <= 1) {
      if (this.routePolyline) this.routePolyline.setLatLngs([]);
      this.renderWaypointMarkers();
      this.syncAutoStartFinishLandmarks();
      this.updateStats();
      this.updateControlsState();
      return;
    }

    this.showLoading(true, 'Menghitung ulang rute...');
    try {
      for (let i = 1; i < this.waypoints.length; i++) {
        const pt = this.waypoints[i];
        const prevPt = this.waypoints[i - 1];
        const segMode = pt.mode || (this.snapToRoad ? 'auto' : 'manual');
        pt.mode = segMode;

        if (!pt.segmentCoords || pt.segmentCoords.length === 0) {
          if (segMode === 'auto') {
            try {
              pt.segmentCoords = await this.fetchSegmentRoute(prevPt, pt);
            } catch (e) {
              pt.segmentCoords = [[prevPt.lat, prevPt.lng], [pt.lat, pt.lng]];
            }
          } else {
            pt.segmentCoords = [[prevPt.lat, prevPt.lng], [pt.lat, pt.lng]];
          }
        }
      }
      this.updatePolylineFromSegments();
    } finally {
      this.showLoading(false);
      this.renderWaypointMarkers();
      this.syncAutoStartFinishLandmarks();
      this.updateLandmarkMarkersDisplay();
      this.updateStats();
      this.updateControlsState();
      this.saveToStorage();

      if (this.paceInspectMarker && this.paceInspectState) {
        const reProj = this.getProjectionOnRoute(this.paceInspectState.latlng);
        if (reProj) {
          this.paceInspectState.latlng = reProj.latlng;
          this.paceInspectState.distanceKm = reProj.distanceKm;
          this.paceInspectMarker.setLatLng(reProj.latlng);
          this.recalculatePaceInspection();
        }
      }
    }
  }

  renderWaypointMarkers() {
    this.waypointMarkers.forEach(m => this.map.removeLayer(m));
    this.waypointMarkers = [];

    // HANYA tampilkan titik waypoint jika sedang dalam mode 'route'!
    if (this.currentMode !== 'route') {
      return;
    }

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

      // Tooltip penjelas mode segmen
      if (idx > 0) {
        const segDesc = pt.mode === 'manual' ? 'Manual (Garis Lurus Bebas)' : 'Auto (Ikuti Jalan)';
        marker.bindTooltip(`Titik ${idx + 1} • Sambungan: ${segDesc}`, { direction: 'top', offset: [0, -10] });
      } else {
        marker.bindTooltip('Titik Start (Awal Rute)', { direction: 'top', offset: [0, -10] });
      }

      // Interaksi klik & hover pada titik Start rute aktif untuk memicu rekomendasi Loop
      if (idx === 0) {
        marker.on('mouseover', () => {
          if (this.currentMode === 'route' && this.waypoints && this.waypoints.length >= 2) {
            this.showLoopSnapRecommendation(pt);
          }
        });

        marker.on('click', (e) => {
          if (this.currentMode === 'route') {
            L.DomEvent.stopPropagation(e);
            this.clearLoopSnapRecommendation();
            this.addWaypoint(L.latLng(pt.lat, pt.lng));
          }
        });
      }

      marker.on('dragend', async (e) => {
        this.saveStateToHistory();
        const newLatLng = e.target.getLatLng();
        const oldPt = this.waypoints[idx];
        const newPt = L.latLng(newLatLng.lat, newLatLng.lng);
        newPt.mode = oldPt ? (oldPt.mode || 'auto') : 'auto';
        newPt.segmentCoords = null; // force recalculate incoming segment
        this.waypoints[idx] = newPt;
        if (idx + 1 < this.waypoints.length) {
          this.waypoints[idx + 1].segmentCoords = null; // force recalculate outgoing segment
        }
        await this.recalculateRoute();
      });

      this.waypointMarkers.push(marker);
    });
  }

  async makeLoopRoute() {
    if (this.waypoints.length < 2) return;
    const startPoint = this.waypoints[0];
    await this.addWaypoint(L.latLng(startPoint.lat, startPoint.lng));
  }

  async reverseRoute() {
    if (this.waypoints.length < 2) return;
    this.saveStateToHistory();
    this.waypoints.reverse();
    for (let i = 1; i < this.waypoints.length; i++) {
      this.waypoints[i].segmentCoords = null;
    }
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
    this.clearPaceInspection();
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

  // --- Metode Manajemen Multi-Rute ---
  getNextRouteColor() {
    const usedColors = this.routes.map(r => r.color.toLowerCase());
    const available = COLOR_PALETTE.find(c => !usedColors.includes(c.toLowerCase()));
    return available || COLOR_PALETTE[this.routes.length % COLOR_PALETTE.length];
  }

  createRoute(options = {}) {
    const id = options.id || 'route_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 3);
    const name = options.name || `Rute ${this.routes.length + 1}`;
    const color = options.color || this.getNextRouteColor();
    const visible = options.visible !== undefined ? options.visible : true;
    const paceSeconds = options.paceSeconds || 360;
    const startTime = options.startTime || '06:00';
    const snapToRoad = options.snapToRoad !== undefined ? options.snapToRoad : true;
    const waypoints = (options.waypoints || []).map(w => {
      const pt = L.latLng(w.lat, w.lng);
      pt.mode = w.mode || 'auto';
      pt.segmentCoords = w.segmentCoords || null;
      return pt;
    });

    const route = {
      id,
      name,
      color,
      visible,
      waypoints,
      polyline: null,
      waypointMarkers: [],
      paceSeconds,
      startTime,
      snapToRoad,
      undoStack: [],
      redoStack: []
    };

    route.polyline = this.createRoutePolyline(route);
    if (options.polylineCoords && options.polylineCoords.length > 0) {
      route.polyline.setLatLngs(options.polylineCoords);
    }

    return route;
  }

  createRoutePolyline(route) {
    const isActive = route.id === this.activeRouteId;
    const poly = L.polyline([], {
      color: route.color || '#0284c7',
      weight: isActive ? 6 : 4.5,
      opacity: isActive ? 0.95 : 0.65,
      lineCap: 'round',
      lineJoin: 'round'
    });

    if (route.visible && this.map && !this.map.hasLayer(poly)) {
      poly.addTo(this.map);
    }

    poly.bindTooltip('', {
      sticky: true,
      direction: 'top',
      offset: [0, -10],
      className: 'route-dist-tooltip'
    });

    poly.on('mousemove', (e) => {
      const dist = this.getDistanceFromStartAlongPolyline(e.latlng, route);
      if (dist !== null) {
        poly.setTooltipContent(
          `<span style="color: ${route.color}; font-weight: 700;">● ${route.name}</span>: ${dist.toFixed(2)} km dari Start`
        );
      }
    });

    poly.on('click', (e) => {
      if (this.currentMode === 'pacecheck') {
        L.DomEvent.stopPropagation(e);
        this.handlePaceCheckClick(e.latlng);
      } else if (this.currentMode === 'route') {
        // Jika dalam mode route, klik pada garis tetap menambahkan waypoint
        this.addWaypoint(e.latlng);
      } else if (this.currentMode === 'live') {
        // Pada mode live, klik polyline tidak memicu switch aktif
      } else {
        this.setActiveRoute(route.id);
      }
    });

    return poly;
  }

  initDefaultRoute() {
    const def = this.createRoute({
      id: 'route_5k',
      name: 'Rute 5K',
      color: '#0284c7',
      visible: true,
      paceSeconds: 360,
      startTime: '06:30'
    });
    this.routes.push(def);
    this.activeRouteId = def.id;
  }

  setActiveRoute(routeId) {
    const route = this.routes.find(r => r.id === routeId);
    if (!route) return;

    // Bersihkan marker waypoint rute aktif sebelumnya dari peta
    const prevRoute = this.getActiveRoute();
    if (prevRoute && prevRoute.id !== routeId) {
      prevRoute.waypointMarkers.forEach(m => this.map.removeLayer(m));
      prevRoute.waypointMarkers = [];
    }

    this.activeRouteId = routeId;

    // Perbarui ketebalan garis rute aktif vs inaktif dan pastikan layer terpasang di map jika terlihat
    this.routes.forEach(r => {
      this.ensureRoutePolylineLayer(r);
      if (r.polyline) {
        const isActive = r.id === routeId;
        r.polyline.setStyle({
          weight: isActive ? 6 : 4.5,
          opacity: isActive ? 0.95 : 0.65
        });
        if (isActive) {
          r.polyline.bringToFront();
        }
      }
    });

    // Render waypoint markers untuk rute aktif jika sedang terlihat
    if (route.visible) {
      this.renderWaypointMarkers();
    }

    // Sinkronisasi status UI
    if (this.activeRouteStatsBadge) {
      this.activeRouteStatsBadge.textContent = route.name;
      this.activeRouteStatsBadge.style.color = route.color;
      this.activeRouteStatsBadge.style.borderColor = route.color;
    }

    const startBadge = document.getElementById('activeRouteStartBadge');
    if (startBadge) {
      startBadge.textContent = route.name;
      startBadge.style.color = route.color;
    }

    if (this.startTimeInput) {
      this.startTimeInput.value = route.startTime || '06:00';
    }

    if (this.paceRange) {
      this.paceRange.value = route.paceSeconds || 360;
    }

    this.setRoutingSnapMode(route.snapToRoad !== undefined ? route.snapToRoad : true);

    this.syncPaceNumberInputs();
    this.updatePaceDisplay();
    this.updateStats();
    this.updateControlsState();
    this.renderRouteList();

    if (this.paceInspectState) {
      this.recalculatePaceInspection();
    }
  }

  updateRouteStartTime(routeId, newTime) {
    if (!newTime) return;
    const route = this.routes.find(r => r.id === routeId);
    if (!route) return;

    route.startTime = newTime;

    // 1. Jika rute ini adalah rute aktif, sinkronkan input di panel pacing
    if (route.id === this.activeRouteId && this.startTimeInput) {
      if (this.startTimeInput !== document.activeElement) {
        this.startTimeInput.value = newTime;
      }
    }

    // 2. Sinkronkan input waktu di kartu rute (jika ada) tanpa merusak fokus jika sedang mengetik
    const routeTimeInputs = document.querySelectorAll(`.route-time-input[data-route-id="${route.id}"]`);
    routeTimeInputs.forEach(input => {
      if (input !== document.activeElement && input.value !== newTime) {
        input.value = newTime;
      }
    });

    // 3. Sinkronkan input waktu di panel live jika ada
    const lrscTimeInputs = document.querySelectorAll(`.lrsc-time-input[data-route-id="${route.id}"]`);
    lrscTimeInputs.forEach(input => {
      if (input !== document.activeElement && input.value !== newTime) {
        input.value = newTime;
      }
    });

    // 4. Update display landmark (termasuk tag start/finish di peta)
    this.updateLandmarkMarkersDisplay();
    this.updateStats();
    this.saveToStorage();

    // 5. Update pace check inspection jika sedang aktif
    if (this.currentMode === 'pacecheck' && this.paceInspectState) {
      this.recalculatePaceInspection();
    }

    // 6. Update simulasi live: sesuaikan window waktu & hitung ulang posisi pelari
    this.initLiveSimulationTimeWindow();
    if (this.currentMode === 'live') {
      this.updateLiveSimulation();
    }
  }

  renderRouteList() {
    if (!this.routeList) return;
    this.routeList.innerHTML = '';

    this.routes.forEach(route => {
      const isActive = route.id === this.activeRouteId;
      const totalKm = (this.calculateTotalDistance(route) / 1000).toFixed(2);

      const item = document.createElement('div');
      item.className = `route-item ${isActive ? 'active' : ''}`;
      item.setAttribute('data-id', route.id);

      item.innerHTML = `
        <div class="route-item-left">
          <input type="color" class="route-color-input" value="${route.color}" title="Klik untuk mengubah warna rute">
          <div class="route-info-group">
            <span class="route-name-title" title="Klik untuk memilih rute ini (Double-click untuk ubah nama)">${route.name}</span>
            <div class="route-meta-sub">
              <span class="route-dist-tag"><i class="fa-solid fa-route"></i> ${totalKm} km</span>
              <span>&bull;</span>
              <div class="route-start-inline" title="Ubah jam start khusus rute ${route.name}">
                <i class="fa-regular fa-clock text-sky"></i>
                <span class="route-start-label">Start:</span>
                <input type="time" class="route-time-input" value="${route.startTime || '06:00'}" data-route-id="${route.id}" title="Klik untuk mengubah jam start rute ${route.name}">
              </div>
            </div>
          </div>
        </div>
        <div class="route-item-actions">
          <button type="button" class="route-vis-btn ${route.visible ? 'visible' : ''}" title="${route.visible ? 'Sembunyikan Rute di Peta' : 'Tampilkan Rute di Peta'}">
            <i class="fa-solid ${route.visible ? 'fa-eye' : 'fa-eye-slash'}"></i>
          </button>
          ${this.routes.length > 1 ? `
          <button type="button" class="route-del-btn" title="Hapus Rute Ini">
            <i class="fa-solid fa-trash-can"></i>
          </button>
          ` : ''}
        </div>
      `;

      // Klik info rute untuk mengaktifkannya (kecuali klik color atau time input)
      item.querySelector('.route-item-left').addEventListener('click', (e) => {
        if (e.target.classList.contains('route-color-input') || e.target.classList.contains('route-time-input') || e.target.closest('.route-start-inline')) return;
        this.setActiveRoute(route.id);
      });

      // Event listener waktu start rute
      const timeInput = item.querySelector('.route-time-input');
      if (timeInput) {
        timeInput.addEventListener('click', (e) => e.stopPropagation());
        timeInput.addEventListener('mousedown', (e) => e.stopPropagation());
        const onTimeChange = (e) => {
          e.stopPropagation();
          this.updateRouteStartTime(route.id, e.target.value);
        };
        timeInput.addEventListener('input', onTimeChange);
        timeInput.addEventListener('change', onTimeChange);
      }

      // Ubah warna rute
      const colorInput = item.querySelector('.route-color-input');
      colorInput.addEventListener('input', (e) => {
        this.changeRouteColor(route.id, e.target.value);
      });
      colorInput.addEventListener('change', (e) => {
        this.changeRouteColor(route.id, e.target.value);
      });

      // Double-click untuk rename
      const nameTitle = item.querySelector('.route-name-title');
      nameTitle.addEventListener('dblclick', () => {
        const newName = prompt('Ubah nama rute:', route.name);
        if (newName && newName.trim()) {
          this.changeRouteName(route.id, newName.trim());
        }
      });

      // Toggle visibility
      item.querySelector('.route-vis-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleRouteVisibility(route.id);
      });

      // Delete route
      const delBtn = item.querySelector('.route-del-btn');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteRoute(route.id);
        });
      }

      this.routeList.appendChild(item);
    });
  }

  addOrSwitchPresetRoute(presetKey) {
    const config = ROUTE_PRESETS[presetKey];
    if (!config) return;

    // Jika sudah ada rute dengan preset nama ini, aktifkan
    const existing = this.routes.find(r => r.name.toLowerCase() === config.name.toLowerCase());
    if (existing) {
      if (!existing.visible) {
        this.toggleRouteVisibility(existing.id);
      }
      this.setActiveRoute(existing.id);
      return;
    }

    // Jika belum ada, buat rute baru dari preset
    const newRoute = this.createRoute({
      name: config.name,
      color: config.color,
      startTime: config.startTime,
      paceSeconds: config.paceSeconds,
      visible: true
    });

    this.routes.push(newRoute);
    this.setActiveRoute(newRoute.id);
    this.renderRouteList();
    this.saveToStorage();
  }

  addNewCustomRoute() {
    const name = prompt('Masukkan nama rute baru (contoh: 15K Trail, Fun Run, dll):', `Rute ${this.routes.length + 1}`);
    if (!name || !name.trim()) return;

    const newRoute = this.createRoute({
      name: name.trim(),
      color: this.getNextRouteColor(),
      visible: true
    });

    this.routes.push(newRoute);
    this.setActiveRoute(newRoute.id);
    this.renderRouteList();
    this.saveToStorage();
  }

  toggleRouteVisibility(routeId) {
    const route = this.routes.find(r => r.id === routeId);
    if (!route) return;

    route.visible = !route.visible;

    if (route.polyline) {
      if (route.visible) {
        if (!this.map.hasLayer(route.polyline)) {
          route.polyline.addTo(this.map);
        }
        if (route.id === this.activeRouteId) {
          this.renderWaypointMarkers();
        }
      } else {
        if (this.map.hasLayer(route.polyline)) {
          this.map.removeLayer(route.polyline);
        }
        if (route.id === this.activeRouteId) {
          this.waypointMarkers.forEach(m => this.map.removeLayer(m));
          this.waypointMarkers = [];
        }
      }
    }

    this.syncAutoStartFinishLandmarks();
    this.renderRouteList();

    if (this.paceInspectState) {
      this.recalculatePaceInspection();
    }
    this.saveToStorage();
  }

  deleteRoute(routeId) {
    if (this.routes.length <= 1) {
      alert('Minimal harus ada 1 rute dalam sistem!');
      return;
    }

    const route = this.routes.find(r => r.id === routeId);
    if (!route) return;

    if (!confirm(`Hapus rute "${route.name}" beserta seluruh jalurnya?`)) return;

    if (route.polyline) {
      this.map.removeLayer(route.polyline);
    }
    route.waypointMarkers.forEach(m => this.map.removeLayer(m));

    this.routes = this.routes.filter(r => r.id !== routeId);

    if (this.activeRouteId === routeId) {
      this.activeRouteId = this.routes[0].id;
    }

    this.setActiveRoute(this.activeRouteId);
    this.syncAutoStartFinishLandmarks();
    this.renderRouteList();
    this.saveToStorage();
  }

  changeRouteColor(routeId, newColor) {
    const route = this.routes.find(r => r.id === routeId);
    if (!route) return;

    route.color = newColor;
    if (route.polyline) {
      route.polyline.setStyle({ color: newColor });
    }

    this.syncAutoStartFinishLandmarks();
    this.renderRouteList();
    if (this.activeRouteId === routeId && this.activeRouteStatsBadge) {
      this.activeRouteStatsBadge.style.color = newColor;
      this.activeRouteStatsBadge.style.borderColor = newColor;
    }

    if (this.paceInspectState) {
      this.recalculatePaceInspection();
    }
    this.saveToStorage();
  }

  changeRouteName(routeId, newName) {
    const route = this.routes.find(r => r.id === routeId);
    if (!route) return;

    route.name = newName;
    this.syncAutoStartFinishLandmarks();
    this.renderRouteList();

    if (this.activeRouteId === routeId && this.activeRouteStatsBadge) {
      this.activeRouteStatsBadge.textContent = newName;
    }

    if (this.paceInspectState) {
      this.recalculatePaceInspection();
    }
    this.saveToStorage();
  }

  // Hitung titik proyeksi terdekat pada polyline rute dan jarak kumulatif dari Start
  getProjectionOnRoute(latlng, targetRoute = null) {
    const route = targetRoute || this.getActiveRoute();
    if (!route || !route.polyline) return null;
    const coords = route.polyline.getLatLngs();
    if (!coords || coords.length < 2) return null;

    let closestSegmentIdx = 0;
    let minDistanceSq = Infinity;
    let bestProjectionFactor = 0;

    // Cari segmen garis terdekat dari titik latlng
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

    // Hitung jarak kumulatif dari titik start hingga proyeksi titik pada segmen
    let cumulativeMeters = 0;
    for (let i = 0; i < closestSegmentIdx; i++) {
      cumulativeMeters += coords[i].distanceTo(coords[i + 1]);
    }

    const pStart = coords[closestSegmentIdx];
    const pEnd = coords[closestSegmentIdx + 1];
    const projectedPt = L.latLng(
      pStart.lat + bestProjectionFactor * (pEnd.lat - pStart.lat),
      pStart.lng + bestProjectionFactor * (pEnd.lng - pStart.lng)
    );
    cumulativeMeters += pStart.distanceTo(projectedPt);

    const distToRouteMeters = latlng.distanceTo(projectedPt);

    return {
      latlng: projectedPt,
      distanceKm: cumulativeMeters / 1000,
      distToRouteMeters: distToRouteMeters
    };
  }

  getDistanceFromStartAlongPolyline(latlng, targetRoute = null) {
    const proj = this.getProjectionOnRoute(latlng, targetRoute);
    return proj ? proj.distanceKm : null;
  }

  // --- Logika Mode Cek Pace Titik (Multi-Rute) ---
  handlePaceCheckClick(latlng) {
    const visibleRoutes = this.routes.filter(r => r.visible && r.polyline && r.polyline.getLatLngs().length >= 2);
    if (visibleRoutes.length === 0) {
      alert('Silakan buat rute lari terlebih dahulu sebelum menganalisis pace titik!');
      return;
    }

    // Temukan titik snap pada rute terdekat
    let bestSnap = latlng;
    let minPerp = Infinity;

    visibleRoutes.forEach(r => {
      const proj = this.getProjectionOnRoute(latlng, r);
      if (proj && proj.distToRouteMeters < minPerp) {
        minPerp = proj.distToRouteMeters;
        bestSnap = proj.latlng;
      }
    });

    this.paceInspectState = {
      latlng: bestSnap
    };

    this.renderOrUpdatePaceInspectMarker();
    this.recalculatePaceInspection();
  }

  renderOrUpdatePaceInspectMarker() {
    if (!this.paceInspectState || !this.paceInspectState.latlng) return;

    if (!this.paceInspectMarker) {
      const icon = L.divIcon({
        className: 'landmark-div-icon-wrapper',
        html: `
          <div class="pace-inspect-pin-wrapper" title="Tarik / geser untuk memindahkan titik sepanjang rute">
            <div class="pace-inspect-radar"></div>
            <div class="pace-inspect-pin">
              <i class="fa-solid fa-stopwatch"></i>
            </div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });

      this.paceInspectMarker = L.marker(this.paceInspectState.latlng, {
        icon: icon,
        draggable: true,
        zIndexOffset: 3000
      }).addTo(this.map);

      this.paceInspectMarker.bindTooltip('', {
        permanent: true,
        direction: 'top',
        offset: [0, -22],
        className: 'pace-inspect-tooltip'
      });

      this.paceInspectMarker.on('drag', (e) => {
        const curPos = e.target.getLatLng();
        let bestSnap = curPos;
        let minPerp = Infinity;

        this.routes.forEach(r => {
          if (!r.visible || !r.polyline || r.polyline.getLatLngs().length < 2) return;
          const proj = this.getProjectionOnRoute(curPos, r);
          if (proj && proj.distToRouteMeters < minPerp) {
            minPerp = proj.distToRouteMeters;
            bestSnap = proj.latlng;
          }
        });

        this.paceInspectState.latlng = bestSnap;
        this.paceInspectMarker.setLatLng(bestSnap);
        this.recalculatePaceInspection();
      });
    } else {
      this.paceInspectMarker.setLatLng(this.paceInspectState.latlng);
    }
  }

  recalculatePaceInspection() {
    if (!this.paceInspectState) return;

    const inspectLatLng = this.paceInspectState.latlng;
    const targetStr = (this.inspectTargetTimeInput ? this.inspectTargetTimeInput.value : '06:30') || '06:30';

    const parseToSeconds = (timeStr) => {
      const parts = timeStr.split(':').map(Number);
      const h = parts[0] || 0;
      const m = parts[1] || 0;
      const s = parts[2] || 0;
      return h * 3600 + m * 60 + s;
    };

    const targetSeconds = parseToSeconds(targetStr);

    const multiListContainer = document.getElementById('paceMultiRouteList');
    if (!multiListContainer) return;
    multiListContainer.innerHTML = '';

    const visibleRoutes = this.routes.filter(r => r.visible && r.polyline && r.polyline.getLatLngs().length >= 2);
    if (visibleRoutes.length === 0) {
      multiListContainer.innerHTML = '<div class="empty-state" style="padding: 14px;"><i class="fa-solid fa-eye-slash"></i><span>Tidak ada rute terlihat dengan jalur minimal 2 titik.</span></div>';
      return;
    }

    const tooltipRows = [];

    visibleRoutes.forEach(route => {
      const proj = this.getProjectionOnRoute(inspectLatLng, route);
      if (!proj) return;

      const totalKm = this.calculateTotalDistance(route) / 1000;
      const isTraversed = proj.distToRouteMeters <= 80;

      // Jika rute ini TIDAK melewati titik pantau
      if (!isTraversed) {
        tooltipRows.push(`
          <div style="display: flex; justify-content: space-between; gap: 10px; font-size: 11px; margin-top: 2px;">
            <span><span style="color: ${route.color};">●</span> <strong>${route.name}:</strong></span>
            <span style="color: #f87171; font-weight: 600;"><i class="fa-solid fa-ban"></i> Tidak lewat</span>
          </div>
        `);

        const card = document.createElement('div');
        card.className = 'pace-multi-route-card';
        card.style.borderLeftColor = '#94a3b8';
        card.style.background = '#f8fafc';
        card.innerHTML = `
          <div class="pmr-header">
            <div class="pmr-title" style="color: ${route.color};">
              <span class="pmr-dot" style="background-color: ${route.color};"></span>
              <strong>${route.name}</strong>
              <span class="pmr-total-tag">Total: ${totalKm.toFixed(2)} km</span>
            </div>
            <span class="prc-prox-badge off-track"><i class="fa-solid fa-ban"></i> Tidak Melalui Jalur Ini</span>
          </div>
          <div class="pmr-offroute-notice">
            <i class="fa-solid fa-circle-exclamation"></i>
            <span>Rute <strong>${route.name}</strong> tidak melintasi titik ini (jarak ke jalur terdekat ~${proj.distToRouteMeters >= 1000 ? (proj.distToRouteMeters / 1000).toFixed(2) + ' km' : Math.round(proj.distToRouteMeters) + ' m'}).</span>
          </div>
        `;
        multiListContainer.appendChild(card);
        return;
      }

      const distKm = proj.distanceKm;
      const startStr = route.startTime || '06:00';
      const startSeconds = parseToSeconds(startStr);

      let elapsedSeconds = targetSeconds - startSeconds;
      if (elapsedSeconds < 0) {
        elapsedSeconds += 24 * 3600;
      }

      const elpHours = Math.floor(elapsedSeconds / 3600);
      const elpMins = Math.floor((elapsedSeconds % 3600) / 60);
      const elpSecs = elapsedSeconds % 60;
      const elapsedFormatted = [
        elpHours.toString().padStart(2, '0'),
        elpMins.toString().padStart(2, '0'),
        elpSecs.toString().padStart(2, '0')
      ].join(':');

      let paceStr = '--:--';
      let speedStr = '0.0 km/jam';
      let category = 'Titik Start';
      let catColor = '#64748b';
      let paceSeconds = 0;

      if (distKm > 0.005 && elapsedSeconds > 0) {
        paceSeconds = Math.round(elapsedSeconds / distKm);
        const paceMin = Math.floor(paceSeconds / 60);
        const paceSec = paceSeconds % 60;
        paceStr = `${paceMin}:${paceSec.toString().padStart(2, '0')}`;
        speedStr = `${(distKm / (elapsedSeconds / 3600)).toFixed(1)} km/jam`;

        if (paceSeconds < 240) {
          category = 'Sprint / Elite';
          catColor = '#ef4444';
        } else if (paceSeconds < 285) {
          category = 'Fast / 5K-10K';
          catColor = '#ea580c';
        } else if (paceSeconds < 330) {
          category = 'Tempo Run';
          catColor = '#f59e0b';
        } else if (paceSeconds < 390) {
          category = 'Half Marathon Pace';
          catColor = '#10b981';
        } else if (paceSeconds < 450) {
          category = 'Easy / Marathon';
          catColor = '#0284c7';
        } else {
          category = 'Recovery / Jog';
          catColor = '#8b5cf6';
        }
      } else if (distKm <= 0.005) {
        paceStr = '0:00';
        category = 'Garis Start';
      }

      const proximityHtml = `<span class="prc-prox-badge on-track"><i class="fa-solid fa-circle-check"></i> Melintasi Jalur</span>`;

      tooltipRows.push(`
        <div style="display: flex; justify-content: space-between; gap: 10px; font-size: 11px; margin-top: 2px;">
          <span><span style="color: ${route.color};">●</span> <strong>${route.name}:</strong> ${distKm.toFixed(2)} km</span>
          <span style="color: #38bdf8; font-weight: 700;">${paceStr} /km</span>
        </div>
      `);

      const card = document.createElement('div');
      card.className = 'pace-multi-route-card';
      card.style.borderLeftColor = route.color;
      card.innerHTML = `
        <div class="pmr-header">
          <div class="pmr-title" style="color: ${route.color};">
            <span class="pmr-dot" style="background-color: ${route.color};"></span>
            <strong>${route.name}</strong>
            <span class="pmr-total-tag">Total: ${totalKm.toFixed(2)} km</span>
          </div>
          ${proximityHtml}
        </div>
        <div class="pmr-stats-row">
          <div class="pmr-col">
            <span class="pmr-lbl">Jarak dari Start</span>
            <span class="pmr-val">${distKm.toFixed(2)} km</span>
          </div>
          <div class="pmr-col">
            <span class="pmr-lbl">Start (${startStr}) ➔ Waktu</span>
            <span class="pmr-val">${elapsedFormatted}</span>
          </div>
        </div>
        <div class="pmr-pace-box">
          <div class="pmr-pace-val-group">
            <span class="pmr-pace-label">Target Pace:</span>
            <span class="pmr-pace-num" style="color: ${route.color};">${paceStr}</span>
            <span class="pmr-pace-unit">/km</span>
          </div>
          <div class="pmr-pace-sub">
            <span><i class="fa-solid fa-gauge-high"></i> ${speedStr}</span>
            <span class="pmr-category-pill" style="color: ${catColor}; border-color: ${catColor};">${category}</span>
          </div>
        </div>
      `;
      multiListContainer.appendChild(card);
    });

    if (this.paceCheckEmpty) this.paceCheckEmpty.style.display = 'none';
    if (this.paceCheckResultCard) this.paceCheckResultCard.style.display = 'flex';

    if (this.paceInspectMarker) {
      this.paceInspectMarker.setTooltipContent(`
        <div style="min-width: 175px;">
          <div style="font-weight: 700; color: #ffffff; font-size: 12px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px; margin-bottom: 4px;">
            <i class="fa-regular fa-clock" style="color: #38bdf8;"></i> Target Jam: ${targetStr}
          </div>
          ${tooltipRows.join('')}
        </div>
      `);
    }
  }

  saveInspectedPointAsLandmark() {
    if (!this.paceInspectState || !this.paceInspectState.latlng) return;

    const targetStr = (this.inspectTargetTimeInput ? this.inspectTargetTimeInput.value : '06:30') || '06:30';

    this.saveStateToHistory();
    this.createInternalLandmark({
      lat: this.paceInspectState.latlng.lat,
      lng: this.paceInspectState.latlng.lng,
      type: 'checkpoint',
      name: `Checkpoint (${targetStr})`,
      desc: `Titik pantau waktu pelari pukul ${targetStr}`,
      isAuto: false,
      showTimeEstimate: false
    });

    this.renderLandmarkList();
    this.updateStats();
    alert(`Landmark Checkpoint (Pukul ${targetStr}) berhasil disimpan!`);
  }

  clearPaceInspection() {
    if (this.paceInspectMarker) {
      this.map.removeLayer(this.paceInspectMarker);
      this.paceInspectMarker = null;
    }
    this.paceInspectState = null;
    if (this.paceCheckEmpty) this.paceCheckEmpty.style.display = 'flex';
    if (this.paceCheckResultCard) this.paceCheckResultCard.style.display = 'none';
  }

  // --- Logika Mode Live / Simulasi Pelari Real-Time ---
  getLatLngAtDistance(polylineCoords, targetDistanceKm) {
    if (!polylineCoords || polylineCoords.length === 0) return null;
    if (polylineCoords.length === 1 || targetDistanceKm <= 0) {
      return polylineCoords[0];
    }

    let cumulativeMeters = 0;
    const targetMeters = targetDistanceKm * 1000;

    for (let i = 0; i < polylineCoords.length - 1; i++) {
      const p1 = polylineCoords[i];
      const p2 = polylineCoords[i + 1];
      const segMeters = p1.distanceTo(p2);

      if (cumulativeMeters + segMeters >= targetMeters) {
        const remaining = targetMeters - cumulativeMeters;
        const ratio = segMeters > 0 ? remaining / segMeters : 0;
        return L.latLng(
          p1.lat + ratio * (p2.lat - p1.lat),
          p1.lng + ratio * (p2.lng - p1.lng)
        );
      }
      cumulativeMeters += segMeters;
    }

    return polylineCoords[polylineCoords.length - 1];
  }

  initLiveSimulationTimeWindow() {
    const visibleRoutes = this.routes.filter(r => r.visible);
    if (visibleRoutes.length === 0) return;

    const parseToSeconds = (timeStr) => {
      const parts = (timeStr || '06:00').split(':').map(Number);
      return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    };

    let minStart = Infinity;
    let maxFinish = -Infinity;

    visibleRoutes.forEach(r => {
      const startSec = parseToSeconds(r.startTime);
      const totalKm = this.calculateTotalDistance(r) / 1000;
      const finishSec = totalKm > 0 ? (startSec + Math.round(totalKm * 480)) : (startSec + 3600); // Pace 8 (paling lambat)

      if (startSec < minStart) minStart = startSec;
      if (finishSec > maxFinish) maxFinish = finishSec;
    });

    if (minStart === Infinity) minStart = 6 * 3600;
    if (maxFinish === -Infinity || maxFinish <= minStart) maxFinish = minStart + 3 * 3600;

    const sliderMin = Math.max(0, minStart - 600); // 10 menit sebelum start tercepat
    const sliderMax = Math.min(86400, Math.max(sliderMin + 1800, maxFinish + 600)); // 10 menit setelah finish terlambat

    if (this.liveTimeSlider) {
      this.liveTimeSlider.min = sliderMin;
      this.liveTimeSlider.max = sliderMax;
      
      // Jika simulasi sedang jeda / tidak berjalan, sesuaikan waktu simulasi langsung ke jam start
      if (!this.liveSimulationRunning) {
        this.liveCurrentSeconds = minStart;
      } else {
        if (this.liveCurrentSeconds < sliderMin) this.liveCurrentSeconds = sliderMin;
        if (this.liveCurrentSeconds > sliderMax) this.liveCurrentSeconds = sliderMax;
      }
      this.liveTimeSlider.value = this.liveCurrentSeconds;
    }

    const fmt = (s) => {
      const h = Math.floor(s / 3600) % 24;
      const m = Math.floor((s % 3600) / 60);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };

    if (this.liveSliderMinLabel) this.liveSliderMinLabel.textContent = fmt(sliderMin);
    if (this.liveSliderMaxLabel) this.liveSliderMaxLabel.textContent = fmt(sliderMax);

    // Perbarui display jam digital langsung
    const curSec = Math.floor(this.liveCurrentSeconds) % 86400;
    const hh = Math.floor(curSec / 3600);
    const mm = Math.floor((curSec % 3600) / 60);
    const ss = curSec % 60;
    const curFmt = `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
    if (this.liveClockDisplay) this.liveClockDisplay.textContent = curFmt;
    if (this.liveSliderCurrentLabel) this.liveSliderCurrentLabel.textContent = curFmt;
  }

  syncLiveToCurrentLocalTime() {
    const now = new Date();
    this.liveCurrentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    if (this.liveTimeSlider) {
      const min = parseInt(this.liveTimeSlider.min) || 0;
      const max = parseInt(this.liveTimeSlider.max) || 86400;
      if (this.liveCurrentSeconds < min) this.liveTimeSlider.min = Math.max(0, this.liveCurrentSeconds - 600);
      if (this.liveCurrentSeconds > max) this.liveTimeSlider.max = Math.min(86400, this.liveCurrentSeconds + 600);
      this.liveTimeSlider.value = this.liveCurrentSeconds;
    }

    this.updateLiveSimulation();
  }

  toggleLivePlayPause() {
    if (this.liveSimulationRunning) {
      this.pauseLiveSimulation();
    } else {
      this.playLiveSimulation();
    }
  }

  playLiveSimulation() {
    if (this.liveSimulationRunning) return;
    this.liveSimulationRunning = true;

    if (this.livePlayPauseBtn) {
      this.livePlayPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Jeda';
      this.livePlayPauseBtn.classList.add('running');
    }
    if (this.liveSimulationStatus) {
      this.liveSimulationStatus.innerHTML = '<span class="pulse-dot"></span> SIMULASI LIVE';
      this.liveSimulationStatus.style.background = 'rgba(239, 68, 68, 0.2)';
    }

    let lastTime = performance.now();
    const intervalMs = 120;

    this.liveSimulationTimer = setInterval(() => {
      const now = performance.now();
      const deltaSec = (now - lastTime) / 1000;
      lastTime = now;

      this.liveCurrentSeconds += deltaSec * this.liveSpeedMultiplier;

      if (this.liveTimeSlider) {
        const max = parseInt(this.liveTimeSlider.max) || 86400;
        if (this.liveCurrentSeconds >= max) {
          this.liveCurrentSeconds = parseInt(this.liveTimeSlider.min) || 0;
        }
      }

      this.updateLiveSimulation();
    }, intervalMs);
  }

  pauseLiveSimulation() {
    this.liveSimulationRunning = false;
    if (this.liveSimulationTimer) {
      clearInterval(this.liveSimulationTimer);
      this.liveSimulationTimer = null;
    }

    if (this.livePlayPauseBtn) {
      this.livePlayPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i> Mulai';
      this.livePlayPauseBtn.classList.remove('running');
    }
    if (this.liveSimulationStatus) {
      this.liveSimulationStatus.innerHTML = '<i class="fa-solid fa-pause"></i> JEDA';
      this.liveSimulationStatus.style.background = 'rgba(100, 116, 139, 0.3)';
    }
  }

  stepLiveSimulation(deltaSeconds) {
    this.liveCurrentSeconds = Math.max(0, Math.min(86400, this.liveCurrentSeconds + deltaSeconds));
    if (this.liveTimeSlider) {
      this.liveTimeSlider.value = this.liveCurrentSeconds;
    }
    this.updateLiveSimulation();
  }

  renderLivePaceChips() {
    if (!this.livePaceChips) return;
    this.livePaceChips.innerHTML = '';

    LIVE_PACES.forEach(p => {
      const isActive = this.liveActivePaces.has(p.pace);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `pace-chip-toggle ${isActive ? 'active' : ''}`;
      chip.style.color = p.color;
      chip.innerHTML = `
        <span class="pace-color-dot" style="background-color: ${p.color};"></span>
        <span>${p.name} (${p.pace}:00)</span>
      `;
      chip.addEventListener('click', () => {
        this.toggleLivePaceFilter(p.pace);
      });
      this.livePaceChips.appendChild(chip);
    });
  }

  toggleLivePaceFilter(paceNum) {
    if (this.liveActivePaces.has(paceNum)) {
      if (this.liveActivePaces.size > 1) {
        this.liveActivePaces.delete(paceNum);
      }
    } else {
      this.liveActivePaces.add(paceNum);
    }
    this.renderLivePaceChips();
    this.updateLiveSimulation();
  }

  clearLiveRunnerMarkers() {
    this.liveRunnerMarkers.forEach(m => this.map.removeLayer(m));
    this.liveRunnerMarkers.clear();
  }

  updateLiveSimulation() {
    const curSec = Math.floor(this.liveCurrentSeconds) % 86400;
    const hh = Math.floor(curSec / 3600);
    const mm = Math.floor((curSec % 3600) / 60);
    const ss = curSec % 60;
    const clockFormatted = [
      hh.toString().padStart(2, '0'),
      mm.toString().padStart(2, '0'),
      ss.toString().padStart(2, '0')
    ].join(':');

    if (this.liveClockDisplay) {
      this.liveClockDisplay.textContent = clockFormatted;
    }
    if (this.liveSliderCurrentLabel) {
      this.liveSliderCurrentLabel.textContent = clockFormatted;
    }
    if (this.liveTimeSlider && !this.liveTimeSlider.matches(':active')) {
      this.liveTimeSlider.value = curSec;
    }

    const parseToSeconds = (timeStr) => {
      const parts = (timeStr || '06:00').split(':').map(Number);
      return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    };

    const visibleRoutes = this.routes.filter(r => r.visible && r.polyline && r.polyline.getLatLngs().length >= 2);
    const activeMarkerKeys = new Set();
    const visibleRouteIds = new Set(visibleRoutes.map(r => r.id));

    if (!this.liveRunnerStatusList) return;

    if (visibleRoutes.length === 0) {
      this.liveRunnerStatusList.innerHTML = '<div class="empty-state" style="padding: 10px;"><i class="fa-solid fa-eye-slash"></i><span>Tidak ada rute terlihat dengan jalur minimal 2 titik.</span></div>';
      this.clearLiveRunnerMarkers();
      return;
    }

    // Hapus empty state jika ada
    const emptyStateEl = this.liveRunnerStatusList.querySelector('.empty-state');
    if (emptyStateEl) emptyStateEl.remove();

    // Hapus kartu rute yang sudah tidak visible
    const existingCards = this.liveRunnerStatusList.querySelectorAll('.live-route-status-card');
    existingCards.forEach(card => {
      const rid = card.getAttribute('data-route-id');
      if (!visibleRouteIds.has(rid)) {
        card.remove();
      }
    });

    visibleRoutes.forEach(route => {
      const coords = route.polyline.getLatLngs();
      const totalKm = this.calculateTotalDistance(route) / 1000;
      const startSec = parseToSeconds(route.startTime);
      const elapsedSeconds = curSec - startSec;

      let runnersRowsHtml = '';

      LIVE_PACES.forEach(pItem => {
        if (!this.liveActivePaces.has(pItem.pace)) {
          const key = `${route.id}_p${pItem.pace}`;
          if (this.liveRunnerMarkers.has(key)) {
            this.map.removeLayer(this.liveRunnerMarkers.get(key));
            this.liveRunnerMarkers.delete(key);
          }
          return;
        }

        const key = `${route.id}_p${pItem.pace}`;
        activeMarkerKeys.add(key);

        let runnerPos = null;
        let isWaiting = false;
        let isFinished = false;
        let statusText = '';
        let distKm = 0;
        let finishClock = '';

        if (elapsedSeconds < 0) {
          isWaiting = true;
          runnerPos = coords[0];
          statusText = `Menunggu Start (${route.startTime})`;
        } else {
          distKm = elapsedSeconds / pItem.paceSeconds;
          if (distKm >= totalKm) {
            isFinished = true;
            distKm = totalKm;
            runnerPos = coords[coords.length - 1];
            const finishSecTotal = startSec + Math.round(totalKm * pItem.paceSeconds);
            const fH = Math.floor(finishSecTotal / 3600) % 24;
            const fM = Math.floor((finishSecTotal % 3600) / 60);
            const fS = finishSecTotal % 60;
            finishClock = `${fH.toString().padStart(2, '0')}:${fM.toString().padStart(2, '0')}:${fS.toString().padStart(2, '0')}`;
            statusText = `FINISH (${finishClock})`;
          } else {
            runnerPos = this.getLatLngAtDistance(coords, distKm);
            statusText = `KM ${distKm.toFixed(2)} / ${totalKm.toFixed(2)} km`;
          }
        }

        if (!runnerPos) return;

        let marker = this.liveRunnerMarkers.get(key);
        const iconHtml = `
          <div class="live-runner-marker-wrap ${isFinished ? 'finished' : ''} ${isWaiting ? 'waiting' : ''}" style="--pace-color: ${pItem.color};">
            <div class="live-runner-halo"></div>
            <div class="live-runner-avatar">
              <i class="fa-solid ${isFinished ? 'fa-flag-checkered' : (isWaiting ? 'fa-hourglass-start' : 'fa-person-running')}"></i>
              <span class="live-runner-pnum">P${pItem.pace}</span>
            </div>
            <div class="live-runner-route-tag" style="background-color: ${route.color};">${route.name}</div>
          </div>
        `;

        const runnerIcon = L.divIcon({
          className: '',
          html: iconHtml,
          iconSize: [48, 48],
          iconAnchor: [24, 24]
        });

        const tooltipContent = `
          <div style="font-family: inherit; font-size: 11px;">
            <div style="font-weight: 800; color: ${route.color}; margin-bottom: 2px;">
              ● ${route.name} (Start: ${route.startTime})
            </div>
            <div style="font-size: 12px; font-weight: 700; color: ${pItem.color};">
              Pelari Pace ${pItem.pace} (${pItem.pace}:00/km &bull; ${pItem.speedKmH} km/jam)
            </div>
            <div style="color: #cbd5e1; margin-top: 3px;">
              Posisi: <strong>${statusText}</strong>
            </div>
          </div>
        `;

        if (!marker) {
          marker = L.marker(runnerPos, {
            icon: runnerIcon,
            zIndexOffset: 2500 + pItem.pace * 10
          }).addTo(this.map);

          marker.bindTooltip(tooltipContent, {
            direction: 'top',
            offset: [0, -20],
            className: 'runner-live-tooltip'
          });

          this.liveRunnerMarkers.set(key, marker);
        } else {
          marker.setLatLng(runnerPos);
          marker.setIcon(runnerIcon);
          marker.setTooltipContent(tooltipContent);
        }

        runnersRowsHtml += `
          <div class="lrsc-runner-row">
            <div class="lrsc-runner-left">
              <span class="lrsc-pace-badge" style="background-color: ${pItem.color};">P${pItem.pace}</span>
              <span>${pItem.name}</span>
            </div>
            <div class="lrsc-runner-status ${isFinished ? 'finished' : (isWaiting ? 'waiting' : '')}">
              ${isFinished ? '<i class="fa-solid fa-flag-checkered"></i> ' : ''}${statusText}
            </div>
          </div>
        `;
      });

      let routeCard = this.liveRunnerStatusList.querySelector(`.live-route-status-card[data-route-id="${route.id}"]`);
      if (!routeCard) {
        routeCard = document.createElement('div');
        routeCard.className = 'live-route-status-card';
        routeCard.setAttribute('data-route-id', route.id);
        routeCard.style.borderLeftColor = route.color;

        routeCard.innerHTML = `
          <div class="lrsc-header">
            <span class="lrsc-title" style="color: ${route.color};">● ${route.name} (${totalKm.toFixed(2)} km)</span>
            <div class="lrsc-start-wrap" title="Ubah jam start rute ${route.name}">
              <i class="fa-regular fa-clock"></i>
              <span style="font-size: 0.68rem; color: #64748b;">Start:</span>
              <input type="time" class="lrsc-time-input" value="${route.startTime || '06:00'}" data-route-id="${route.id}" title="Klik untuk mengubah jam start rute ini">
            </div>
          </div>
          <div class="lrsc-runners-table">
            ${runnersRowsHtml}
          </div>
        `;

        const timeInput = routeCard.querySelector('.lrsc-time-input');
        if (timeInput) {
          timeInput.addEventListener('click', (e) => e.stopPropagation());
          timeInput.addEventListener('mousedown', (e) => e.stopPropagation());
          const onTimeChange = (e) => {
            e.stopPropagation();
            this.updateRouteStartTime(route.id, e.target.value);
          };
          timeInput.addEventListener('input', onTimeChange);
          timeInput.addEventListener('change', onTimeChange);
        }

        this.liveRunnerStatusList.appendChild(routeCard);
      } else {
        // Update elemen yang ada tanpa merusak fokus input saat user sedang mengetik
        const titleEl = routeCard.querySelector('.lrsc-title');
        if (titleEl) titleEl.textContent = `● ${route.name} (${totalKm.toFixed(2)} km)`;
        titleEl.style.color = route.color;
        routeCard.style.borderLeftColor = route.color;

        const timeInput = routeCard.querySelector('.lrsc-time-input');
        if (timeInput && timeInput !== document.activeElement && timeInput.value !== (route.startTime || '06:00')) {
          timeInput.value = route.startTime || '06:00';
        }

        const tableEl = routeCard.querySelector('.lrsc-runners-table');
        if (tableEl) tableEl.innerHTML = runnersRowsHtml;
      }
    });

    this.liveRunnerMarkers.forEach((m, key) => {
      if (!activeMarkerKeys.has(key)) {
        this.map.removeLayer(m);
        this.liveRunnerMarkers.delete(key);
      }
    });
  }

  calculateTotalDistance(targetRoute = null) {
    const route = targetRoute || this.getActiveRoute();
    if (!route || !route.polyline) return 0;
    const coords = route.polyline.getLatLngs();
    if (!coords || coords.length < 2) return 0;

    let totalMeters = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      totalMeters += coords[i].distanceTo(coords[i + 1]);
    }
    return totalMeters;
  }

  updateStats() {
    const activeRoute = this.getActiveRoute();
    const totalMeters = this.calculateTotalDistance(activeRoute);
    const km = totalMeters / 1000;
    this.distKmEl.textContent = km.toFixed(2);

    const paceSec = activeRoute ? activeRoute.paceSeconds : 360;
    const totalSeconds = Math.round(km * paceSec);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const formattedTime = [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0')
    ].join(':');

    this.estTimeEl.textContent = formattedTime;
    this.pointCountEl.textContent = activeRoute ? activeRoute.waypoints.length : 0;
    this.landmarkCountEl.textContent = this.landmarks.length;

    if (this.activeRouteStatsBadge && activeRoute) {
      this.activeRouteStatsBadge.textContent = activeRoute.name;
      this.activeRouteStatsBadge.style.color = activeRoute.color;
      this.activeRouteStatsBadge.style.borderColor = activeRoute.color;
    }
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

  initModeScrollNavigation() {
    const container = this.modeSelectorGroup;
    if (!container) return;

    if (this.modeScrollLeftBtn) {
      this.modeScrollLeftBtn.addEventListener('click', () => {
        container.scrollBy({ left: -140, behavior: 'smooth' });
      });
    }

    if (this.modeScrollRightBtn) {
      this.modeScrollRightBtn.addEventListener('click', () => {
        container.scrollBy({ left: 140, behavior: 'smooth' });
      });
    }

    // Scroll horizontal via mouse wheel jika kursor diarahkan ke area selector
    container.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // Drag to scroll untuk kenyamanan mouse desktop
    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    container.addEventListener('mousedown', (e) => {
      isDown = true;
      startX = e.pageX - container.offsetLeft;
      scrollLeft = container.scrollLeft;
    });

    window.addEventListener('mouseup', () => {
      isDown = false;
    });

    container.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - container.offsetLeft;
      const walk = (x - startX) * 1.5;
      container.scrollLeft = scrollLeft - walk;
    });
  }

  locateUser() {
    const isInsecure = !window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';

    if (!navigator.geolocation) {
      if (isInsecure) {
        this.openGpsHelpModal();
      } else {
        this.fetchIpLocation();
      }
      return;
    }

    this.showLoading(true, 'Mendeteksi lokasi GPS...');
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
        }).addTo(this.map).bindPopup('<strong>Lokasi Anda Saat Ini</strong><br>Akurasi GPS Tinggi').openPopup();
      },
      (err) => {
        this.showLoading(false);
        console.warn('Geolocation error:', err);
        const errMsg = (err && err.message) ? err.message.toLowerCase() : '';
        const isSecureOriginErr = isInsecure || (err && (
          err.code === 1 || 
          errMsg.includes('secure') || 
          errMsg.includes('origin')
        ));

        if (isSecureOriginErr) {
          this.openGpsHelpModal();
        } else {
          alert('Gagal mendapatkan lokasi GPS: ' + (err.message || 'Izin ditolak'));
        }
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  }

  openGpsHelpModal() {
    if (this.gpsOriginUrlCode) {
      this.gpsOriginUrlCode.textContent = window.location.origin;
    }
    if (this.gpsHelpModal) {
      this.gpsHelpModal.style.display = 'flex';
    }
  }

  closeGpsHelpModal() {
    if (this.gpsHelpModal) {
      this.gpsHelpModal.style.display = 'none';
    }
  }

  async fetchIpLocation() {
    this.showLoading(true, 'Mendeteksi perkiraan lokasi via jaringan (IP)...');
    try {
      let lat = null, lng = null, label = '';
      
      try {
        const res = await fetch('https://ipwho.is/');
        const data = await res.json();
        if (data && data.success && data.latitude && data.longitude) {
          lat = data.latitude;
          lng = data.longitude;
          label = `${data.city || ''}, ${data.region || ''} (${data.country || ''})`;
        }
      } catch (err1) {
        console.warn('ipwho.is failed, trying fallback...', err1);
      }

      if (lat === null) {
        const res2 = await fetch('https://get.geojs.io/v1/ip/geo.json');
        const data2 = await res2.json();
        if (data2 && data2.latitude && data2.longitude) {
          lat = parseFloat(data2.latitude);
          lng = parseFloat(data2.longitude);
          label = `${data2.city || ''}, ${data2.country || ''}`;
        }
      }

      this.showLoading(false);

      if (lat !== null && lng !== null) {
        this.map.flyTo([lat, lng], 13);
        L.circleMarker([lat, lng], {
          radius: 11,
          fillColor: '#0284c7',
          color: '#ffffff',
          weight: 3,
          opacity: 1,
          fillOpacity: 0.85
        }).addTo(this.map).bindPopup(`<strong>Lokasi Perkiraan (Jaringan/IP)</strong><br>${label}<br><small style="color:#64748b;">Akurasi tingkat kota/wilayah</small>`).openPopup();
        this.closeGpsHelpModal();
      } else {
        alert('Tidak dapat memperkirakan lokasi dari jaringan internet.');
      }
    } catch (e) {
      this.showLoading(false);
      console.error('IP Geolocation error:', e);
      alert('Tidak dapat menghubungkan ke layanan lokasi jaringan.');
    }
  }

  fitRouteBounds() {
    const group = [];
    this.routes.forEach(r => {
      if (r.visible && r.polyline && r.polyline.getLatLngs().length > 0) {
        group.push(r.polyline);
      }
    });
    this.landmarks.forEach(l => {
      if (l.marker) group.push(l.marker);
    });

    if (group.length > 0) {
      const fg = L.featureGroup(group);
      this.map.fitBounds(fg.getBounds(), { padding: [50, 50] });
    }
  }

  showLoading(show, message = 'Memproses...') {
    this.loadingOverlay.style.display = show ? 'flex' : 'none';
    this.loadingText.textContent = message;
  }

  exportGPX() {
    const visibleRoutesWithCoords = this.routes.filter(r => r.visible && r.polyline && r.polyline.getLatLngs().length > 0);
    if (visibleRoutesWithCoords.length === 0 && this.landmarks.length === 0) {
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

    visibleRoutesWithCoords.forEach(route => {
      const routeCoords = route.polyline.getLatLngs();
      gpx += `  <trk>
    <name>${(route.name || title).replace(/[<>&'"]/g, '')}</name>
    <type>Running</type>
    <trkseg>\n`;

      let cumulativeSeconds = 0;
      const baseTime = Date.now();
      const pSec = route.paceSeconds || 360;

      for (let i = 0; i < routeCoords.length; i++) {
        const pt = routeCoords[i];
        if (i > 0) {
          const segDistKm = routeCoords[i - 1].distanceTo(pt) / 1000;
          cumulativeSeconds += segDistKm * pSec;
        }
        const ptTime = new Date(baseTime + cumulativeSeconds * 1000).toISOString();
        gpx += `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}">
        <time>${ptTime}</time>
      </trkpt>\n`;
      }

      gpx += `    </trkseg>
  </trk>\n`;
    });

    gpx += `</gpx>`;

    this.downloadFile(gpx, `${title.toLowerCase().replace(/\s+/g, '_')}.gpx`, 'application/gpx+xml');
  }

  exportKML() {
    const visibleRoutesWithCoords = this.routes.filter(r => r.visible && r.polyline && r.polyline.getLatLngs().length > 0);
    if (visibleRoutesWithCoords.length === 0 && this.landmarks.length === 0) {
      alert('Silakan buat jalur lari atau tambahkan landmark terlebih dahulu!');
      return;
    }

    const title = (this.routeTitleInput.value.trim() || 'Running Route').replace(/[<>&'"]/g, '');

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

    let styleDefinitions = '';

    visibleRoutesWithCoords.forEach(r => {
      const hex = r.color.replace('#', '');
      const red = hex.substr(0, 2);
      const green = hex.substr(2, 2);
      const blue = hex.substr(4, 2);
      const kmlColor = `ff${blue}${green}${red}`;

      styleDefinitions += `
    <Style id="routeStyle_${r.id}">
      <LineStyle>
        <color>${kmlColor}</color>
        <width>6</width>
      </LineStyle>
    </Style>`;
    });

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

    visibleRoutesWithCoords.forEach(r => {
      const coords = r.polyline.getLatLngs();
      const coordStr = coords.map(pt => `${pt.lng.toFixed(6)},${pt.lat.toFixed(6)},0`).join(' ');
      kml += `    <Placemark>
      <name>${r.name}</name>
      <styleUrl>#routeStyle_${r.id}</styleUrl>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
          ${coordStr}
        </coordinates>
      </LineString>
    </Placemark>\n`;
    });

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
