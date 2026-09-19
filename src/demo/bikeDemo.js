import * as Cesium from 'cesium';

const DEMO_ROOT = '/demo/bike-test/';
const MANIFEST_URL = `${DEMO_ROOT}cameras.json`;
const DETECTIONS_URL = `${DEMO_ROOT}detections.json`;
const ROUTING_URL = 'https://router.project-osrm.org/route/v1/driving';
const TUMAKURU = Cesium.Cartesian3.fromDegrees(77.124, 13.333, 1800);
const CAMERA_MARKER_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
    '<path d="M8 17h22l5 5h5v15H8z" fill="#07131b" stroke="#00d4ff" stroke-width="3"/>' +
    '<circle cx="25" cy="29" r="7" fill="none" stroke="#00d4ff" stroke-width="3"/>' +
    '<path d="M13 17l3-6h10l3 6" fill="none" stroke="#00d4ff" stroke-width="3"/>' +
    '</svg>',
)}`;

function cameraPosition(camera) {
  return Cesium.Cartesian3.fromDegrees(
    camera.longitude,
    camera.latitude,
    0,
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
  let cameras = [];
  let detections = null;
  let destroyed = false;

  const setStatus = (text) => {
    if (status) status.textContent = text;
  };

  const showRoute = async () => {
    if (!detections || !cameras.length) return;
    const byId = new Map(cameras.map((camera) => [camera.id, camera]));
    const orderedCameras = detections.detections
      .slice()
      .sort((a, b) => a.routeOrder - b.routeOrder)
      .map((entry) => byId.get(entry.cameraId))
      .filter(Boolean);
    const fallbackPoints = orderedCameras.flatMap((camera) => [
      camera.longitude,
      camera.latitude,
    ]);
    let points = fallbackPoints;
    try {
      const segments = [];
      for (const [index, start] of orderedCameras.entries()) {
        const end = orderedCameras[index + 1];
        if (!end) break;
        const url = `${ROUTING_URL}/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson&steps=false`;
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`OSRM ${response.status}`);
        const payload = await response.json();
        const coordinates = payload.routes?.[0]?.geometry?.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2)
          throw new Error('OSRM returned no route geometry');
        segments.push(coordinates);
      }
      if (segments.length) {
        points = segments.flatMap((segment, index) =>
          segment
            .slice(index ? 1 : 0)
            .flatMap(([longitude, latitude]) => [longitude, latitude]),
        );
      }
    } catch {
      // The local demo remains usable when the public router is unavailable.
    }
    const route = viewer.entities.getById('bike-demo-route');
    if (route) viewer.entities.remove(route);
    viewer.entities.add({
      id: 'bike-demo-route',
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(points),
        width: 5,
        material: Cesium.Color.CYAN,
        clampToGround: true,
      },
    });
  };

  const selectCamera = () => {
    const camera = cameras.find(({ id }) => id === cameraSelect?.value);
    if (!camera || !video) return;
    video.src = `${DEMO_ROOT}${camera.video}`;
    video.load();
    setStatus(`${camera.name} · ${camera.latitude.toFixed(5)}, ${camera.longitude.toFixed(5)}`);
  };

  const focusTumakuru = () => {
    viewer.camera.flyTo({ destination: TUMAKURU, duration: 1.5 });
    cameraDataSource.show = true;
    void showRoute();
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

  const findPlate = () => {
    const plate = plateInput?.value.trim();
    if (plate !== detections?.vehicle?.plate) {
      setStatus('No demo match. Try plate 5826.');
      return;
    }
    focusTumakuru();
    setStatus(`MATCH · ${plate} · black scooter · ${detections.detections.length} cameras`);
  };

  const onAbort = () => destroy();
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
    cameraDataSource.entities.removeAll();
    viewer.dataSources.remove(cameraDataSource, true);
    const route = viewer.entities.getById('bike-demo-route');
    if (route) viewer.entities.remove(route);
  };
  const onSearchKey = (event) => {
    if (event.key === 'Enter') searchPlace();
  };
  const onPlateKey = (event) => {
    if (event.key === 'Enter') findPlate();
  };
  const onTrack = () => void showRoute();
  const playVideo = () => video?.play().catch(() => {});

  searchButton?.addEventListener('click', searchPlace);
  search?.addEventListener('keydown', onSearchKey);
  cameraSelect?.addEventListener('change', selectCamera);
  playButton?.addEventListener('click', playVideo);
  trackButton?.addEventListener('click', onTrack);
  plateInput?.addEventListener('keydown', onPlateKey);
  signal?.addEventListener('abort', onAbort, { once: true });

  Promise.all([
    fetch(MANIFEST_URL, { signal }).then((response) => response.json()),
    fetch(DETECTIONS_URL, { signal }).then((response) => response.json()),
  ])
    .then(([manifest, detectionData]) => {
      if (destroyed) return;
      cameras = manifest;
      detections = detectionData;
      cameras.forEach((camera) => {
        const entity = cameraDataSource.entities.add({
          id: `bike-demo-${camera.id}`,
          position: cameraPosition(camera),
          billboard: {
            image: CAMERA_MARKER_IMAGE,
            width: 28,
            height: 28,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: camera.id.toUpperCase(),
            font: '12px monospace',
            fillColor: Cesium.Color.CYAN,
            pixelOffset: new Cesium.Cartesian2(0, -20),
          },
        });
        entity.properties = new Cesium.PropertyBag({
          heading: camera.heading,
          video: camera.video,
        });
        cameraSelect?.add(new Option(camera.id.toUpperCase(), camera.id));
      });
      viewer.dataSources.add(cameraDataSource);
      selectCamera();
      setStatus('Search Tumakuru to load the ANPR demo');
    })
    .catch((error) => {
      if (!destroyed && error.name !== 'AbortError') setStatus('Demo package unavailable');
    });

  return { destroy };
}
