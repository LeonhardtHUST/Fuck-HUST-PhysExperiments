"""`prompt_context.json` is the curated narrative behind the front-end AI prompt.

The prompt is assembled from two data sources: the table/column definition in
`config.json` and this folder-local context file.  If the two drift apart the
assistant is asked to fill method ids or columns that no longer exist, and the
imported artifact silently loses data.  These tests keep both sides aligned and
guarantee the curated formulas stay in sync with the adapters' `FORMULAS`.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from experiments.core.registry import registry

BACKEND = Path(__file__).resolve().parents[1]
EXPERIMENTS_DIR = BACKEND / "experiments"

#: public / legacy experiment id -> folder name (config.json + prompt_context.json)
FOLDERS = {
    "polarization": "polarization",
    "sound-light": "soundlight",
    "multimeter": "multimeter",
    "bridge": "bridge",
    "photoelectric": "photoelectric",
    "franck-hertz": "franck_hertz",
    "solar-cell": "solar_cell",
    "gmr": "gmr",
    "nmr": "nmr",
    "viscosity": "viscosity",
    "surface-tension": "surface_tension",
    "thermal-conductivity": "thermal_conductivity",
    "michelson": "michelson",
    "photoelectric-franck-hertz": "photoelectric_franck_hertz",
}

MIN_BACKGROUND_CHARS = 60


def _load(folder: str, name: str) -> dict:
    return json.loads((EXPERIMENTS_DIR / folder / name).read_text(encoding="utf-8"))


def context(experiment_id: str) -> dict:
    folder = FOLDERS[experiment_id]
    path = EXPERIMENTS_DIR / folder / "prompt_context.json"
    assert path.is_file(), f"{experiment_id}: 缺少 {path}"
    return _load(folder, "prompt_context.json")


def config(experiment_id: str) -> dict:
    return _load(FOLDERS[experiment_id], "config.json")


def config_methods(experiment_id: str) -> dict[str, dict]:
    """Config shapes differ: `{methods:[...]}`, a bare list, or `{subExperiments:[...]}`."""
    definition = config(experiment_id)
    if isinstance(definition, list):
        methods = definition
    else:
        methods = definition.get("methods") or definition.get("subExperiments") or []
    return {method["id"]: method for method in methods}


def _latex_key(formula: str) -> str:
    """Compare LaTeX ignoring cosmetic differences (`\\mathrm` vs `{\\rm }`, spacing)."""
    text = formula.replace("\\,", "").replace("\\!", "").replace("\\;", "")
    text = text.replace("\\mathrm", "\\rm")
    return "".join(text.split()).replace("{", "").replace("}", "")


def test_every_folder_with_config_has_prompt_context():
    folders = {
        path.name for path in EXPERIMENTS_DIR.iterdir() if (path / "config.json").is_file()
    }
    assert folders, "backend/experiments 下没有找到任何 config.json"
    missing = sorted(folder for folder in folders if not (EXPERIMENTS_DIR / folder / "prompt_context.json").is_file())
    assert missing == [], f"缺少 prompt_context.json 的实验目录：{missing}"


@pytest.mark.parametrize("experiment_id", sorted(FOLDERS))
def test_prompt_context_matches_its_config(experiment_id):
    data = context(experiment_id)
    definition = config(experiment_id)

    # 声光的 config.json 是裸方法列表，id 由前端注册表给出（sound-light）。
    config_id = experiment_id if isinstance(definition, list) else definition["id"]
    assert data["experimentId"] == config_id == experiment_id
    assert len(data["background"].strip()) >= MIN_BACKGROUND_CHARS

    methods = data["methods"]
    assert methods, f"{experiment_id}: methods 为空"
    ids = [method["id"] for method in methods]
    assert len(ids) == len(set(ids)), f"{experiment_id}: methods 中存在重复 id"

    expected = set(config_methods(experiment_id))
    assert set(ids) == expected, (
        f"{experiment_id}: prompt_context 的方法与 config.json 不一致，"
        f"缺少 {sorted(expected - set(ids))}，多余 {sorted(set(ids) - expected)}"
    )


@pytest.mark.parametrize("experiment_id", sorted(FOLDERS))
def test_prompt_context_methods_are_populated(experiment_id):
    data = context(experiment_id)
    for method in data["methods"]:
        assert method.get("name"), f"{experiment_id}/{method['id']}: 缺少 name"
        formulas = method.get("formulas")
        assert formulas, f"{experiment_id}/{method['id']}: formulas 为空"
        for formula in formulas:
            assert isinstance(formula, str) and formula.strip()
        for key in ("criteria", "tips"):
            for line in method.get(key, []):
                assert isinstance(line, str) and line.strip()


def test_prompt_context_covers_every_registered_experiment():
    registered = {experiment.id for experiment in registry.all()}
    assert registered, "registry 为空"
    missing = sorted(registered - set(FOLDERS))
    assert missing == [], f"以下已注册实验没有 prompt_context 映射：{missing}"
    for experiment_id in sorted(registered):
        context(experiment_id)


@pytest.mark.parametrize("experiment_id", sorted(FOLDERS))
def test_prompt_context_carries_adapter_formulas(experiment_id):
    experiment = registry.get(experiment_id)
    formulas = getattr(experiment, "formulas", None)
    if not formulas:
        pytest.skip(f"{experiment_id} 没有暴露 FORMULAS")

    curated = {
        _latex_key(formula)
        for method in context(experiment_id)["methods"]
        for formula in method["formulas"]
    }
    missing = {
        method: [item for item in items if _latex_key(item) not in curated]
        for method, items in formulas.items()
    }
    missing = {method: items for method, items in missing.items() if items}
    assert missing == {}, f"{experiment_id}: adapter FORMULAS 未写入 prompt_context：{missing}"


def test_merged_experiment_context_is_the_union_of_its_parts():
    merged = context("photoelectric-franck-hertz")
    merged_formulas = {
        formula.strip() for method in merged["methods"] for formula in method["formulas"]
    }
    for part in ("photoelectric", "franck-hertz"):
        for method in context(part)["methods"]:
            for formula in method["formulas"]:
                assert formula.strip() in merged_formulas, (
                    f"合并实验缺少 {part}/{method['id']} 的公式：{formula}"
                )
