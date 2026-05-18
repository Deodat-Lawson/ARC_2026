/** Shared refs so world3d / ui / ai can read sim without circular imports from app. */

export const simBridge = {
  /** @type {object | null} */
  state: null,
  /** @type {object | null} */
  plan: null,
  /**
   * Filled by app after modules load.
   * @type {null | {
   *   renderOnce?: () => void,
   *   getTimer?: () => ReturnType<typeof setInterval> | null,
   *   startAuto?: () => void,
   *   getSpeedMultiplier?: () => number,
   *   applyLiveFleetSlidesToDom?: (plan: unknown, slides: unknown) => void,
   * }}
   */
  hooks: null,
};
