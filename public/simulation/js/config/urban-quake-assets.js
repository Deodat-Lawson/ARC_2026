const MODEL_ROOT = "/simulation/data/urban-quake/assets/models";

export const URBAN_QUAKE_ASSETS = {
  sourceNote: "Optimized local GLBs sampled from the EAM165 disaster OBJ pack for this simulation.",
  buildings: [
    { id: "building-intact-a", url: `${MODEL_ROOT}/building-intact-a.glb`, kind: "apartment" },
    { id: "building-intact-b", url: `${MODEL_ROOT}/building-intact-b.glb`, kind: "civic" },
  ],
  collapsedBuildings: [
    { id: "collapsed-facade-a", url: `${MODEL_ROOT}/collapsed-facade-a.glb` },
    { id: "collapsed-facade-b", url: `${MODEL_ROOT}/collapsed-facade-b.glb` },
  ],
  rubble: [
    { id: "debris-pile-a", url: `${MODEL_ROOT}/debris-pile-a.glb` },
  ],
  vehicles: [
    { id: "vehicle-wreck-a", url: `${MODEL_ROOT}/vehicle-wreck-a.glb` },
  ],
  streetProps: [
    { id: "street-prop-a", url: `${MODEL_ROOT}/street-prop-a.glb` },
  ],
  survivors: [
    { id: "survivor", url: "/models/survivor.glb" },
  ],
};
