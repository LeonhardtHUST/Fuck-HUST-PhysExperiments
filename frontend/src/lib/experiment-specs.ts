/**
 * Runtime registry of artifact specs, built once per experiment from the
 * authoritative backend config files. Imported by the workspace UIs (client
 * components) and by node tests through `tsx`-free strip-types.
 */

import polarizationConfig from "../../../backend/experiments/polarization/config.json";
import soundLightConfig from "../../../backend/experiments/soundlight/config.json";
import multimeterConfig from "../../../backend/experiments/multimeter/config.json";
import bridgeConfig from "../../../backend/experiments/bridge/config.json";
import photoelectricConfig from "../../../backend/experiments/photoelectric/config.json";
import franckHertzConfig from "../../../backend/experiments/franck_hertz/config.json";
import solarCellConfig from "../../../backend/experiments/solar_cell/config.json";
import gmrConfig from "../../../backend/experiments/gmr/config.json";
import nmrConfig from "../../../backend/experiments/nmr/config.json";
import viscosityConfig from "../../../backend/experiments/viscosity/config.json";
import surfaceTensionConfig from "../../../backend/experiments/surface_tension/config.json";
import thermalConductivityConfig from "../../../backend/experiments/thermal_conductivity/config.json";
import michelsonConfig from "../../../backend/experiments/michelson/config.json";
import photoelectricFranckHertzConfig from "../../../backend/experiments/photoelectric_franck_hertz/config.json";

import { buildPolarizationSpec } from "./polarization-spec";
import { buildSoundLightSpec, type SoundLightMethodConfig } from "./soundlight-layouts";
import { buildGenericSpec, type ExperimentSpec, type GenericConfig } from "./table-specs";

const SOUND_LIGHT_META = {
  id: "sound-light",
  name: "声速光速的测量",
  category: "波动",
  description:
    "实验一 · 超声声速：共振干涉法（空气）与相位比较法（水）测声速、时差法（选做）；实验二 · 光速：相位法（正弦波）与李萨如法测光速、方波相位法（选做）",
};

const builders: Record<string, () => ExperimentSpec> = {
  polarization: () => buildPolarizationSpec(polarizationConfig),
  "sound-light": () =>
    buildSoundLightSpec(soundLightConfig as unknown as SoundLightMethodConfig[], SOUND_LIGHT_META),
  multimeter: () => buildGenericSpec(multimeterConfig as unknown as GenericConfig),
  bridge: () => buildGenericSpec(bridgeConfig as unknown as GenericConfig),
  photoelectric: () => buildGenericSpec(photoelectricConfig as unknown as GenericConfig),
  "franck-hertz": () => buildGenericSpec(franckHertzConfig as unknown as GenericConfig),
  "solar-cell": () => buildGenericSpec(solarCellConfig as unknown as GenericConfig),
  gmr: () => buildGenericSpec(gmrConfig as unknown as GenericConfig),
  nmr: () => buildGenericSpec(nmrConfig as unknown as GenericConfig),
  viscosity: () => buildGenericSpec(viscosityConfig as unknown as GenericConfig),
  "surface-tension": () => buildGenericSpec(surfaceTensionConfig as unknown as GenericConfig),
  "thermal-conductivity": () => buildGenericSpec(thermalConductivityConfig as unknown as GenericConfig),
  michelson: () => buildGenericSpec(michelsonConfig as unknown as GenericConfig),
  "photoelectric-franck-hertz": () =>
    buildGenericSpec(photoelectricFranckHertzConfig as unknown as GenericConfig),
};

const cache = new Map<string, ExperimentSpec>();

export const EXPERIMENT_SPEC_IDS = Object.freeze(Object.keys(builders));

export function getExperimentSpec(experimentId: string): ExperimentSpec {
  const cached = cache.get(experimentId);
  if (cached) return cached;
  const builder = builders[experimentId];
  if (!builder) throw new Error(`未知实验：${experimentId}`);
  const spec = builder();
  cache.set(experimentId, spec);
  return spec;
}

export function tryGetExperimentSpec(experimentId: string): ExperimentSpec | undefined {
  try {
    return getExperimentSpec(experimentId);
  } catch (error) {
    console.error("experiment spec unavailable", experimentId, error);
    return undefined;
  }
}
