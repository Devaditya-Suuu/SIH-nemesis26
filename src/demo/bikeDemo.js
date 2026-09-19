import * as Cesium from 'cesium';

const DEMO_ROOT = '/demo/bike-test/';
const MANIFEST_URL = `${DEMO_ROOT}cameras.json`;
const GENERATED_DETECTIONS_URL = `${DEMO_ROOT}detections.generated.json`;
const FALLBACK_DETECTIONS_URL = `${DEMO_ROOT}detections.json`;
const ROUTING_URL = 'https://router.project-osrm.org/route/v1/driving';
const TUMAKURU = Cesium.Cartesian3.fromDegrees(77.124, 13.333, 1800);
const CAMERA_MARKER_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
    '<path d="M8 17h22l5 5h5v15H8z" fill="#07131b" stroke="#00d4ff" stroke-width="3"/>' +
    '<circle cx="25" cy="29" r="7" fill="none" stroke="#00d4ff" stroke-width="3"/>' +
    '<path d="M13 17l3-6h10l3 6" fill="none" stroke="#00d4ff" stroke-width="3"/>' +
    '</svg>',
)}`;

function cameraPosition(camera, height = 18) {
  return Cesium.Cartesian3.fromDegrees(
    camera.longitude,
    camera.latitude,
    height,
  );
}

export function initBikeDemo({ viewer, signal, documentRef = document } = {}) {
  const panel = documentRef.getElementById('bike-demo-panel');
  if (!panel || !viewer) return null;
  const collapseButton = panel.querySelector(
    '[data-collapse-target="bike-demo-panel"]',
  );
  const search = panel.querySelector('[data-bike-demo-search]');
  const searchButton = panel.querySelector('[data-bike-demo-search-button]');
  const cameraSelect = panel.querySelector('[data-bike-demo-camera]');
  const video = panel.querySelector('[data-bike-demo-video]');
  const playButton = panel.querySelector('[data-bike-demo-play]');
  const trackButton = panel.querySelector('[data-bike-demo-track]');
  const status = panel.querySelector('[data-bike-demo-status]');
  const plateInput = panel.querySelector('[data-bike-demo-plate]');
  const cameraDataSource = new Cesium.CustomDataSource('bike-demo-cameras');
  const matchDataSource = new Cesium.CustomDataSource('bike-demo-plate-matches');
  let cameras = [];
  let detections = null;
  let trackedPlate = null;
  const visitedCameraIds = new Set();
  let routedCameraKey = '';
  let routeRequestId = 0;
  let destroyed = false;

  const setStatus = (text) => {
    if (status) status.textContent = text;
  };

  const orderedDetections = () =>
    detections?.detections
      ?.slice()
      .sort((a, b) => {
        return (a.routeOrder ?? 0) - (b.routeOrder ?? 0);
      }) || [];

  const detectionMatchesPlate = (entry, plate) =>
    entry.plate ? entry.plate === plate : detections?.vehicle?.plate === plate;

  const clearPlateMatches = (removeRoute = true) => {
    matchDataSource.entities.removeAll();
    if (removeRoute) {
      const matchRoute = viewer.entities.getById('bike-demo-plate-route');
      if (matchRoute) viewer.entities.remove(matchRoute);
    }
  };

  const renderMatchRoute = async (matches) => {
    const cameraKey = matches.map(({ camera }) => camera.id).join('>');
    if (cameraKey === routedCameraKey && viewer.entities.getById('bike-demo-plate-route')) return;
    routedCameraKey = cameraKey;
    const requestId = ++routeRequestId;
    const fallbackCoordinates = matches.flatMap(({ camera }) => [
      camera.longitude,
      camera.latitude,
    ]);
    let coordinates = fallbackCoordinates;
    try {
      const waypoints = matches
        .map(({ camera }) => `${camera.longitude},${camera.latitude}`)
        .join(';');
      const response = await fetch(
        `${ROUTING_URL}/${waypoints}?overview=full&geometries=geojson&steps=false`,
        { signal },
      );
      if (!response.ok) throw new Error(`OSRM ${response.status}`);
      const route = await response.json();
      const geometry = route.routes?.[0]?.geometry?.coordinates;
      if (!Array.isArray(geometry) || geometry.length < 2)
        throw new Error('OSRM returned no route geometry');
      coordinates = geometry.flatMap(([longitude, latitude]) => [longitude, latitude]);
    } catch {
      // Keep the tracked markers usable when the public router is unavailable.
    }
    if (destroyed || requestId !== routeRequestId) return;
    const previousRoute = viewer.entities.getById('bike-demo-plate-route');
    if (previousRoute) viewer.entities.remove(previousRoute);
    viewer.entities.add({
      id: 'bike-demo-plate-route',
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(coordinates),
        width: 8,
        material: Cesium.Color.YELLOW,
        clampToGround: true,
      },
    });
  };

  const renderPlateMatchesAtTime = (plate, currentTimeSeconds) => {
    clearPlateMatches(false);
    const byId = new Map(cameras.map((camera) => [camera.id, camera]));
    const currentCameraId = cameraSelect?.value;
    const currentCameraMatches = orderedDetections()
      .filter((entry) => detectionMatchesPlate(entry, plate))
      .filter((entry) => entry.cameraId === currentCameraId)
      .filter((entry) => (entry.videoTimeSeconds ?? 0) <= currentTimeSeconds + 0.5);

    currentCameraMatches.forEach((entry) => visitedCameraIds.add(entry.cameraId));

    const matches = orderedDetections()
      .filter((entry) => detectionMatchesPlate(entry, plate))
      .filter((entry) => visitedCameraIds.has(entry.cameraId))
      .map((entry) => ({ entry, camera: byId.get(entry.cameraId) }))
      .filter(({ camera }) => camera)
      .sort((a, b) => (a.entry.routeOrder ?? 0) - (b.entry.routeOrder ?? 0));

    if (!matches.length) return 0;

    const seenCameraIds = new Set();
    for (const { entry, camera } of matches) {
      const position = cameraPosition(camera);
      if (!seenCameraIds.has(camera.id)) {
        seenCameraIds.add(camera.id);
      }
      matchDataSource.entities.add({
        id: `bike-demo-plate-${camera.id}`,
        position,
        point: {
          pixelSize: 18,
          color: Cesium.Color.YELLOW,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        label: {
          text: `${plate} · ${camera.id.toUpperCase()}`,
          font: 'bold 12px monospace',
          fillColor: Cesium.Color.YELLOW,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -28),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        },
        description: `ANPR ${plate} · ${camera.name} · ${Math.round(entry.confidence * 100)}% confidence · ${entry.videoTimeSeconds}s`,
      });
    }

    void renderMatchRoute(matches);
    matchDataSource.show = true;
    return matches.length;
  };

  const selectCamera = () => {
    const camera = cameras.find(({ id }) => id === cameraSelect?.value);
    if (!camera || !video) return;
    video.src = `${DEMO_ROOT}${camera.video}`;
    video.load();
    setStatus(trackedPlate
      ? `TRACKING · ${trackedPlate} · ${camera.name} loaded, press PLAY`
      : `${camera.name} · ${camera.latitude.toFixed(5)}, ${camera.longitude.toFixed(5)}`);
  };

  const advanceToNextCamera = () => {
    if (!trackedPlate || !cameraSelect || !cameras.length) return;
    const currentIndex = cameras.findIndex(({ id }) => id === cameraSelect.value);
    const nextCamera = cameras[currentIndex + 1];
    if (!nextCamera) {
      setStatus(`TRACKING · ${trackedPlate} · route complete`);
      return;
    }
    cameraSelect.value = nextCamera.id;
    selectCamera();
    video?.play().catch(() => {});
  };

  const focusTumakuru = () => {
    viewer.camera.flyTo({ destination: TUMAKURU, duration: 1.5 });
    cameraDataSource.show = true;
  };

  const searchPlace = () => {
    const query = search?.value.trim().toLowerCase();
    if (query === 'tumakuru' || query === 'tumkur') {
      focusTumakuru();
      setStatus('TUMAKURU · ANPR demo location loaded');
    } else {
      setStatus('ANPR demo available only for Tumakuru');
    }
  };

  const syncTrackedPlateOnVideo = () => {
    if (!trackedPlate) return;
    const currentTimeSeconds = video?.currentTime ?? 0;
    const count = renderPlateMatchesAtTime(trackedPlate, currentTimeSeconds);
    if (!count) {
      setStatus(`TRACKING · ${trackedPlate} · waiting for matching video frame`);
      return;
    }
    setStatus(`TRACKING · ${trackedPlate} · ${count} camera hit(s) visible at ${currentTimeSeconds.toFixed(1)}s`);
  };

  const findPlate = () => {
    const plate = plateInput?.value.trim().toUpperCase();
    const matches = orderedDetections().filter((entry) =>
      detectionMatchesPlate(entry, plate),
    );

    trackedPlate = null;
    visitedCameraIds.clear();
    routedCameraKey = '';
    routeRequestId += 1;
    clearPlateMatches();

    if (!plate || !matches.length) {
      setStatus('No ANPR match in the generated detections.');
      return;
    }

    trackedPlate = plate;
    focusTumakuru();
    if (video) {
      video.currentTime = 0;
      video.pause();
      clearPlateMatches();
      setStatus(`TRACK STARTED · ${plate} · playback will reveal only the visited camera points`);
    }
  };

  const onAbort = () => destroy();
  const onVideoTimeUpdate = () => {
    if (!trackedPlate) return;
    syncTrackedPlateOnVideo();
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    signal?.removeEventListener('abort', onAbort);
    searchButton?.removeEventListener('click', searchPlace);
    search?.removeEventListener('keydown', onSearchKey);
    cameraSelect?.removeEventListener('change', selectCamera);
    playButton?.removeEventListener('click', playVideo);
    trackButton?.removeEventListener('click', onTrack);
    plateInput?.removeEventListener('keydown', onPlateKey);
    video?.removeEventListener('timeupdate', onVideoTimeUpdate);
    video?.removeEventListener('ended', advanceToNextCamera);
    cameraDataSource.entities.removeAll();
    matchDataSource.entities.removeAll();
    viewer.dataSources.remove(cameraDataSource, true);
    viewer.dataSources.remove(matchDataSource, true);
    const matchRoute = viewer.entities.getById('bike-demo-plate-route');
    if (matchRoute) viewer.entities.remove(matchRoute);
  };
  const onSearchKey = (event) => {
    if (event.key === 'Enter') searchPlace();
  };
  const onPlateKey = (event) => {
    if (event.key === 'Enter') findPlate();
  };
  const onTrack = () => findPlate();
  const playVideo = () => {
    if (!video) return;
    video.play().catch(() => {});
    if (trackedPlate) {
      syncTrackedPlateOnVideo();
    }
  };

  searchButton?.addEventListener('click', searchPlace);
  search?.addEventListener('keydown', onSearchKey);
  cameraSelect?.addEventListener('change', selectCamera);
  playButton?.addEventListener('click', playVideo);
  trackButton?.addEventListener('click', onTrack);
  plateInput?.addEventListener('keydown', onPlateKey);
  video?.addEventListener('timeupdate', onVideoTimeUpdate);
  video?.addEventListener('ended', advanceToNextCamera);
  signal?.addEventListener('abort', onAbort, { once: true });

  Promise.all([
    fetch(MANIFEST_URL, { signal }).then((response) => response.json()),
    fetch(GENERATED_DETECTIONS_URL, { signal })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((generated) =>
        generated || fetch(FALLBACK_DETECTIONS_URL, { signal }).then((response) => response.json()),
      ),
  ])
    .then(([manifest, detectionData]) => {
      if (destroyed) return;
      cameras = manifest;
      detections = detectionData;
      cameras.forEach((camera) => {
        const entity = cameraDataSource.entities.add({
          id: `bike-demo-${camera.id}`,
          position: cameraPosition(camera, 26),
          billboard: {
            image: CAMERA_MARKER_IMAGE,
            width: 28,
            height: 28,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          },
          label: {
            text: camera.id.toUpperCase(),
            font: '12px monospace',
            fillColor: Cesium.Color.CYAN,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          },
        });
        entity.properties = new Cesium.PropertyBag({
          heading: camera.heading,
          video: camera.video,
        });
        cameraSelect?.add(new Option(camera.id.toUpperCase(), camera.id));
      });
      viewer.dataSources.add(cameraDataSource);
      viewer.dataSources.add(matchDataSource);
      selectCamera();
      setStatus('Search Tumakuru to load the ANPR demo');
    })
    .catch((error) => {
      if (!destroyed && error.name !== 'AbortError') setStatus('Demo package unavailable');
    });

  return { destroy };
}
