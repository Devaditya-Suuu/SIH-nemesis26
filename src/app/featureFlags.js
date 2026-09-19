/** Layers intentionally disabled for this deployment. */
export const DISABLED_LAYER_IDS = Object.freeze([
  'satellites',
  'flights',
  'military',
  'ais-live-vessels',
  'transit',
  'bikeshare',
  'rocket-launches',
  'earthquakes',
  'military-installations',
  'local-datacenters',
  'local-dams',
  'telegeography-submarine-cables',
  'local-firms',
]);

export const DISABLED_LAYER_ID_SET = new Set(DISABLED_LAYER_IDS);