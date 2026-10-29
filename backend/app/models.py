"""API request models shared by route modules."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class DMSAngle(BaseModel):
    deg: float
    min: float = 0.0


class MalusRow(BaseModel):
    theta: float
    i_left: Optional[float] = None
    i_right: Optional[float] = None
    #: 原始读数的原样字符串（{"theta": "90.0", "i_left": "1.20"}），只用于报告里的原始数据表
    raw: Optional[Dict[str, str]] = None


class MalusData(BaseModel):
    rows: List[MalusRow]


class HalfWaveInitial(BaseModel):
    c_deg: Optional[float] = None
    c_min: float = 0.0
    p2_deg: Optional[float] = None
    p2_min: float = 0.0
    raw: Optional[Dict[str, str]] = None


class HalfWaveRow(BaseModel):
    offset: float
    c_deg: Optional[float] = None
    c_min: float = 0.0
    p2_deg: Optional[float] = None
    p2_min: float = 0.0
    raw: Optional[Dict[str, str]] = None


class HalfWaveData(BaseModel):
    initial: HalfWaveInitial
    rows: List[HalfWaveRow]


class QuarterWaveRow(BaseModel):
    phi: float
    i_raw: Optional[float] = None
    raw: Optional[Dict[str, str]] = None


class QuarterWaveData(BaseModel):
    rows: List[QuarterWaveRow]


class CircularRow(BaseModel):
    angle: float
    i_raw: Optional[float] = None
    raw: Optional[Dict[str, str]] = None


class CircularData(BaseModel):
    rows: List[CircularRow]


class ProcessRequest(BaseModel):
    bg_uw: float = 0.0
    theta_qwp: float = 30.0
    bg_uw_raw: Optional[str] = None
    theta_qwp_raw: Optional[str] = None
    malus: Optional[MalusData] = None
    halfwave: Optional[HalfWaveData] = None
    quarterwave: Optional[QuarterWaveData] = None
    circular: Optional[CircularData] = None


class SoundLightProcessRequest(BaseModel):
    method: str
    rows: Dict[str, List[Optional[float]]] = Field(default_factory=dict)
    params: Dict[str, float] = Field(default_factory=dict)


class SoundLightReportRequest(BaseModel):
    data: Dict[str, Dict[str, Any]] = Field(default_factory=dict)


class GenericExperimentRequest(BaseModel):
    data: Dict[str, Dict[str, Any]] = Field(default_factory=dict)


class AnalyticsEventRequest(BaseModel):
    event_name: str
    anonymous_session_id: str
    experiment_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    app_version: str = "2.0"


class OCRFeedbackRequest(BaseModel):
    sample_id: Optional[str] = None
    experiment_id: str
    field_id: str
    prediction: str
    confidence: Optional[float] = None
    confirmed_value: str
    was_corrected: bool
    verified: bool = False
    consent: bool = False
    ocr_provider: str = "unknown"
    ocr_model_version: str = "unknown"
    anonymous_session_id: str


class CollectionCommitRequest(BaseModel):
    experiment_id: str
    template_version: str = "2.0"
    consent: bool = False
    confirmed_data: Dict[str, Any]
