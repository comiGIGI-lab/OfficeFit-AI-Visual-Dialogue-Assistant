# -*- coding: utf-8 -*-
"""
OfficeFit 端云协同服务 — FastAPI 入口
=====================================

启动::

    python -m uvicorn ai_service.main:app --host 127.0.0.1 --port 8000

接口:
    GET  /            服务发现（端点列表 + 后端类型）
    GET  /health      健康检查
    POST /api/dialog  文本理解 + 动作推荐

隐私: 只接收文本与脱敏状态摘要，不接收视频 / 深度图 / 原始音频。
"""

from fastapi import FastAPI

from ai_service.schemas import DialogRequest, DialogResponse
from ai_service.workflow import run_workflow, _HAS_LANGGRAPH

app = FastAPI(
    title="OfficeFit 端云协同服务",
    version="0.1.0",
    description="文本理解与动作推荐（端云协同架构演示）",
)


@app.get("/")
def root():
    return {
        "service": "officefit_service",
        "version": "0.1.0",
        "endpoints": {
            "/health": "GET",
            "/api/dialog": "POST",
        },
        "langgraph_available": _HAS_LANGGRAPH,
        "backend": "langgraph" if _HAS_LANGGRAPH else "rules",
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "langgraph_available": _HAS_LANGGRAPH,
        "backend": "langgraph" if _HAS_LANGGRAPH else "rules",
    }


@app.post("/api/dialog", response_model=DialogResponse)
def dialog(req: DialogRequest) -> DialogResponse:
    """文本理解 + 动作推荐。

    请求体只包含 user_text 与脱敏 user_state；不接收视频/深度图/原始音频。
    """
    user_state = req.user_state.model_dump()
    result = run_workflow(req.user_text, user_state)
    return DialogResponse(
        reply=result["reply"],
        intent=result["intent"],
        recommended_actions=result["recommended_actions"],
        next_mode=result["next_mode"],
        backend=result["backend"],
        provider="officefit_service",
    )
