"""FastMCP wiring for PhysLab.

Only this module imports ``mcp``.  Each tool is a thin wrapper that adds the
Chinese docstring the model reads (and the payload shape it must send) around a
``physlab_mcp.tools`` function, so the protocol layer never owns business logic.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from typing import Any, Callable

#: matplotlib must never pick an interactive backend under stdio: it would both
#: print to stdout (poisoning the protocol stream) and try to open a window.
os.environ.setdefault("MPLBACKEND", "Agg")

from mcp.server.fastmcp import FastMCP  # noqa: E402  (after MPLBACKEND)

from physlab_mcp import tools  # noqa: E402
from physlab_mcp.errors import ToolError  # noqa: E402

logger = logging.getLogger("physlab_mcp")

SERVER_NAME = "physlab"

INSTRUCTIONS = """PhysLab 是华中科技大学大学物理实验的数据处理助手，全部计算在本地完成，不调用任何外部模型。

推荐顺序：
1. list_experiments 选实验（返回每个实验的 id 与请求结构 payload_kind）
2. get_experiment_config 取该实验的方法、列 key、参数 key 与单位
3. get_data_reference 可看该实验典型数据长什么样（仅量级与形态参考）
4. validate_experiment_data 校验，再 process_experiment_data 计算、拟合、出图
5. generate_experiment_report / generate_record_sheet 生成 Word 或 PDF

要点：
- data 的三种结构见 list_experiments 返回的 request_shapes；不要自己猜字段名。
- 报告、记录表、拟合图都写入本地目录，返回 {path, mime, bytes}；把 path 交给用户打开即可。
- 计算结果是实验读数处理结果，误差与结论仍需用户自行判断。
- OCR 候选值必须由用户逐项确认后才能进入计算。
"""

def _run(tool: str, experiment_id: str | None, call: Callable[[], Any]) -> Any:
    started = time.perf_counter()
    try:
        result = call()
    except ToolError as exc:
        logger.warning("%s 失败%s：%s", tool,
                       f"（{experiment_id}）" if experiment_id else "", exc)
        raise
    logger.info("%s%s 成功，用时 %.0f ms", tool,
                f"（{experiment_id}）" if experiment_id else "",
                (time.perf_counter() - started) * 1000)
    return result


def build_server(name: str = SERVER_NAME) -> FastMCP:
    """Create a FastMCP instance with the full PhysLab tool surface."""
    mcp = FastMCP(name=name, instructions=INSTRUCTIONS)

    @mcp.tool()
    def list_experiments(include_legacy: bool = False) -> dict[str, Any]:
        """列出 PhysLab 支持的全部大学物理实验（含分类、子实验、记录表路径与请求结构）。"""
        return _run("list_experiments", None,
                    lambda: tools.list_experiments(include_legacy=include_legacy))

    @mcp.tool()
    def get_experiment_config(experiment_id: str) -> dict[str, Any]:
        """取一个实验的完整配置：子实验、列 key、参数 key、单位与建议范围。

        experiment_id 必须是 list_experiments 返回的 id，不要用中文名。
        """
        return _run("get_experiment_config", experiment_id,
                    lambda: tools.get_experiment_config(experiment_id))

    @mcp.tool()
    def get_experiment_schema(experiment_id: str) -> dict[str, Any]:
        """取一个实验的 2.0 JSON schema（definition.methods 与前端导入格式一致）。"""
        return _run("get_experiment_schema", experiment_id,
                    lambda: tools.get_experiment_schema(experiment_id))

    @mcp.tool()
    def get_data_reference(experiment_id: str) -> dict[str, Any]:
        """取一个实验的「数据特征参考」：典型量级、填写规律与常见错误。

        仅用于量级与形态对照，不是标准答案；不要据此编造测量数据。
        """
        return _run("get_data_reference", experiment_id,
                    lambda: tools.get_data_reference(experiment_id))

    @mcp.tool()
    def validate_experiment_data(experiment_id: str, data: dict[str, Any]) -> dict[str, Any]:
        """校验实验数据是否可计算，返回 {valid, errors, warnings}，不会计算。"""
        return _run("validate_experiment_data", experiment_id,
                    lambda: tools.validate_experiment_data(experiment_id, data))

    @mcp.tool()
    def process_experiment_data(
        experiment_id: str, data: dict[str, Any], inline_plots: bool = False,
    ) -> dict[str, Any]:
        """完成计算、误差分析与最小二乘拟合，返回 results / derived / errors / plots。

        plots 默认写成 PNG 文件并返回 {path, mime, bytes}；inline_plots=True 时返回
        base64 data URI（仅当需要直接看图时使用）。
        """
        return _run("process_experiment_data", experiment_id,
                    lambda: tools.process_experiment_data(
                        experiment_id, data, inline_plots=inline_plots))

    @mcp.tool()
    def generate_experiment_report(
        experiment_id: str, data: dict[str, Any], fmt: str = "docx",
    ) -> dict[str, Any]:
        """生成 Word / PDF 实验报告（含数据表、拟合图与误差分析），返回文件路径。

        fmt 只能是 docx 或 pdf。必做子实验没填完会拒绝生成并说明缺哪一项。
        """
        return _run("generate_experiment_report", experiment_id,
                    lambda: tools.generate_experiment_report(experiment_id, data, fmt))

    @mcp.tool()
    def generate_record_sheet(experiment_id: str, fmt: str = "docx") -> dict[str, Any]:
        """生成空白数据记录表（Word / PDF），用于打印后手写记录。"""
        return _run("generate_record_sheet", experiment_id,
                    lambda: tools.generate_record_sheet(experiment_id, fmt))

    @mcp.tool()
    def recognize_record_sheet(
        image_path: str, experiment_id: str = "", table_id: str = "",
    ) -> dict[str, Any]:
        """识别手写记录表照片，返回按视觉顺序排列的数值候选（含置信度与 bbox）。

        image_path 必须是本机可读的图片文件绝对路径（JPG/PNG/WebP/BMP/TIFF，≤12 MB）。
        候选值只是识别结果，必须由用户逐项确认后才能用于计算。
        """
        return _run("recognize_record_sheet", experiment_id or None,
                    lambda: tools.recognize_record_sheet(image_path, experiment_id, table_id))

    if tools.data_collection_tools_enabled():
        _register_collection_tools(mcp)

    return mcp


def _register_collection_tools(mcp: FastMCP) -> None:
    """Privacy-sensitive tools; only present when explicitly switched on."""

    @mcp.tool()
    def data_collection_status() -> dict[str, Any]:
        """查看 AI 实验共建模式当前是否开启，以及模板版本与隐私提示。"""
        return _run("data_collection_status", None, tools.data_collection_status)

    @mcp.tool()
    def contribute_record_sheet(
        image_path: str,
        experiment_id: str,
        consent: bool,
        template_version: str = "2.0",
        collection_mode: bool = False,
    ) -> dict[str, Any]:
        """贡献一张脱敏后的实验记录表照片（写操作，需要使用者明确同意）。

        consent 必须为 true；upload 前请确认图片已删除姓名、学号、联系方式与人脸。
        """
        return _run("contribute_record_sheet", experiment_id,
                    lambda: tools.contribute_record_sheet(
                        image_path, experiment_id, consent,
                        template_version=template_version,
                        collection_mode=collection_mode))

    @mcp.tool()
    def commit_contributed_data(
        session_id: str,
        experiment_id: str,
        confirmed_data: dict[str, Any],
        consent: bool,
        template_version: str = "2.0",
    ) -> dict[str, Any]:
        """提交经使用者确认后的共建数据（写操作，需要 consent=true）。"""
        return _run("commit_contributed_data", experiment_id,
                    lambda: tools.commit_contributed_data(
                        session_id, experiment_id, confirmed_data, consent,
                        template_version=template_version))

    @mcp.tool()
    def withdraw_contribution(session_id: str) -> dict[str, Any]:
        """撤回一次数据共建：删除原图与由它生成的数据样本。"""
        return _run("withdraw_contribution", None,
                    lambda: tools.withdraw_contribution(session_id))


def _manifest(server: FastMCP) -> list[str]:
    registered = asyncio.run(server.list_tools())
    lines = [f"{SERVER_NAME}: 已注册 {len(registered)} 个 MCP 工具"]
    lines.extend(f"- {tool.name}" for tool in registered)
    return lines


def main(argv: list[str] | None = None) -> int:
    """Run the stdio server; ``--check`` prints the tool manifest and exits."""
    args = list(sys.argv[1:] if argv is None else argv)
    server = build_server()
    if "--check" in args or "--list-tools" in args:
        sys.stderr.write("\n".join(_manifest(server)) + "\n")
        return 0
    server.run(transport="stdio")
    return 0
