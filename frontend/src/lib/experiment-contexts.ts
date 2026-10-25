/**
 * Static registry of the curated "来龙去脉 + 公式" narratives.
 *
 * Each `prompt_context.json` lives next to its experiment config in the backend
 * folder, exactly like `config.json` and `data_reference.json`; the front end
 * only reads it to assemble the AI prompt (the backend never loads it).
 */

import polarizationContext from "../../../backend/experiments/polarization/prompt_context.json";
import soundLightContext from "../../../backend/experiments/soundlight/prompt_context.json";
import multimeterContext from "../../../backend/experiments/multimeter/prompt_context.json";
import bridgeContext from "../../../backend/experiments/bridge/prompt_context.json";
import photoelectricContext from "../../../backend/experiments/photoelectric/prompt_context.json";
import franckHertzContext from "../../../backend/experiments/franck_hertz/prompt_context.json";
import solarCellContext from "../../../backend/experiments/solar_cell/prompt_context.json";
import gmrContext from "../../../backend/experiments/gmr/prompt_context.json";
import nmrContext from "../../../backend/experiments/nmr/prompt_context.json";
import viscosityContext from "../../../backend/experiments/viscosity/prompt_context.json";
import surfaceTensionContext from "../../../backend/experiments/surface_tension/prompt_context.json";
import thermalConductivityContext from "../../../backend/experiments/thermal_conductivity/prompt_context.json";
import michelsonContext from "../../../backend/experiments/michelson/prompt_context.json";
import photoelectricFranckHertzContext from "../../../backend/experiments/photoelectric_franck_hertz/prompt_context.json";

import type { PromptContext } from "./prompt-context";

const CONTEXTS: Record<string, PromptContext> = {
  polarization: polarizationContext as PromptContext,
  "sound-light": soundLightContext as PromptContext,
  multimeter: multimeterContext as PromptContext,
  bridge: bridgeContext as PromptContext,
  photoelectric: photoelectricContext as PromptContext,
  "franck-hertz": franckHertzContext as PromptContext,
  "solar-cell": solarCellContext as PromptContext,
  gmr: gmrContext as PromptContext,
  nmr: nmrContext as PromptContext,
  viscosity: viscosityContext as PromptContext,
  "surface-tension": surfaceTensionContext as PromptContext,
  "thermal-conductivity": thermalConductivityContext as PromptContext,
  michelson: michelsonContext as PromptContext,
  "photoelectric-franck-hertz": photoelectricFranckHertzContext as PromptContext,
};

export const PROMPT_CONTEXT_IDS = Object.freeze(Object.keys(CONTEXTS));

/** Curated narrative for one experiment; `undefined` when not yet written. */
export function getPromptContext(experimentId: string): PromptContext | undefined {
  return CONTEXTS[experimentId];
}
