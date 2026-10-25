"""DOCX/PDF report endpoints."""

from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Response

from app.http import attachment
from app.models import GenericExperimentRequest, ProcessRequest, SoundLightReportRequest
from app.routers._helpers import experiment_or_404
from experiments.core.exceptions import ExperimentInputError
from experiments.core.registry import registry


router = APIRouter()


def _response(content: bytes, filename: str, fmt: str) -> Response:
    mime = ("application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            if fmt == "docx" else "application/pdf")
    return Response(content=content, media_type=mime,
                    headers={"Content-Disposition": attachment(filename)})


@router.post("/api/experiments/polarization/report")
async def polarization_report(req: ProcessRequest, fmt: str = "docx", part: str | None = None):
    if fmt not in ("docx", "pdf"):
        raise HTTPException(status_code=400, detail="fmt 必须是 docx 或 pdf")
    try:
        content = registry.get("polarization").build_report(req.model_dump(), fmt)
    except ExperimentInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"报告生成失败: {exc}") from exc
    return _response(content, f"偏振光与双折射实验-完整报告.{fmt}", fmt)


@router.post("/api/experiments/sound-light/report")
async def soundlight_report(req: SoundLightReportRequest, fmt: str = "docx", part: str | None = None):
    if not req.data:
        raise HTTPException(status_code=400, detail="未提供任何实验数据")
    if fmt not in ("docx", "pdf"):
        raise HTTPException(status_code=400, detail="fmt 必须是 docx 或 pdf")
    try:
        content = registry.get("sound-light").build_report(req.data, fmt)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"报告生成失败: {exc}") from exc
    return _response(content, f"声速光速的测量-完整报告.{fmt}", fmt)


@router.post("/api/experiments/{experiment_id}/report")
async def experiment_report(experiment_id: str, req: GenericExperimentRequest, fmt: str = "docx"):
    experiment = experiment_or_404(experiment_id)
    if fmt not in ("docx", "pdf"):
        raise HTTPException(status_code=400, detail="fmt 必须是 docx 或 pdf")
    if not req.data:
        raise HTTPException(status_code=400, detail="未提供任何实验数据")
    try:
        content = experiment.build_report(req.data, fmt)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"报告生成失败: {exc}") from exc
    return _response(content, f"{experiment.config['name']}-完整报告.{fmt}", fmt)
