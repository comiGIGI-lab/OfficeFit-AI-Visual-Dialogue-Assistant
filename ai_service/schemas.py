# -*- coding: utf-8 -*-
"""
OfficeFit 端云协同服务 — 数据模型
=================================

只承载"可上传"的最小状态摘要：文本 + 久坐时长 + 疲劳部位 + 相机/深度/模式/姿态。
隐私约束：本服务不接收也不存储视频、深度图、原始音频。
"""

from typing import List

from pydantic import BaseModel, Field


class UserState(BaseModel):
    """客户端上传的用户状态摘要（已脱敏）。"""

    posture: str = Field(
        "unknown",
        description="姿态摘要: unknown / seated / standing / upper_body_visible",
    )
    sitting_minutes: int = Field(0, ge=0, description="累计久坐分钟")
    fatigue_parts: List[str] = Field(
        default_factory=list, description="疲劳部位，如 ['肩颈', '腰背']"
    )
    current_mode: str = Field(
        "office",
        description="当前模式: office / ready / relax_guidance / training / ...",
    )
    camera_source: str = Field(
        "unknown", description="相机来源: orbbec / webcam / unknown"
    )
    depth_available: bool = Field(False, description="深度是否可用")


class DialogRequest(BaseModel):
    """POST /api/dialog 请求体。"""

    user_text: str = Field("", description="用户语音转写文本")
    user_state: UserState = Field(default_factory=UserState)


class DialogResponse(BaseModel):
    """POST /api/dialog 响应体。"""

    reply: str = Field("", description="AI 回复文本")
    intent: str = Field("unknown", description="识别到的意图标签")
    recommended_actions: List[str] = Field(
        default_factory=list, description="推荐动作中文名列表"
    )
    next_mode: str = Field("office", description="建议的下一模式")
    backend: str = Field("rules", description="实际执行后端: rules / langgraph")
    provider: str = Field("officefit_service", description="服务标识")
