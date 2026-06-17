# -*- coding: utf-8 -*-
"""
OfficeFit 端云协同服务 — 对话工作流
====================================

三段式工作流（与客户端本地规则在语义上保持一致，便于演示"端云一致性"）：

    parse_intent(user_text)            -> 意图标签 / 疲劳部位
    recommend_actions(parsed, state)   -> 动作中文名列表
    generate_reply(parsed, actions, state) -> 回复文本

编排方式：
    - 若 langgraph 可导入：用 StateGraph 编排 parse -> recommend -> reply
    - 否则：使用普通 Python 函数链路（行为完全一致）
    - 任何情况下，langgraph 缺失或运行出错都不允许让服务崩溃。

本模块刻意不依赖 game_frontend / PySide6 / cv2，保证服务端可独立运行。
关键词表为本地规则 (game_frontend/health_intent_rules.py) 的精简镜像。
"""

from typing import Dict, List, Optional, TypedDict


# ── 意图关键词（本地规则的精简镜像）─────────────────────────

INTENT_KEYWORDS: Dict[str, dict] = {
    "neck_stiff":      {"part": "颈部", "keywords": [
        "脖子酸", "脖子僵", "脖子紧", "脖子疼", "脖子沉重",
        "颈椎酸", "颈椎紧", "颈子酸", "脖子栓", "波子酸",
    ]},
    "shoulder_sore":   {"part": "肩颈", "keywords": [
        "肩膀酸", "肩很酸", "肩膀僵", "肩膀紧", "肩很紧",
        "肩背", "肩颈", "间帮酸", "坚绑紧",
    ]},
    "back_upper_sore": {"part": "腰背", "keywords": [
        "后背酸", "后背僵", "背酸", "背紧", "上背酸",
        "背部发紧", "肩胛",
    ]},
    "waist_sore":      {"part": "腰背", "keywords": [
        "腰酸", "腰痛", "腰僵", "腰背僵硬", "腰很酸",
        "腰很疼", "要背僵硬", "腰背将应",
    ]},
    "chest_tight":     {"part": "胸腔", "keywords": [
        "胸口闷", "胸腔打不开", "含胸", "驼背", "坐不直",
    ]},
}

# ── 意图 -> 动作 ID ─────────────────────────────────────────

INTENT_TO_ACTIONS: Dict[str, List[str]] = {
    "neck_stiff":      ["neck_turn_left", "neck_turn_right",
                        "both_hands_up", "chest_open"],
    "shoulder_sore":   ["both_hands_up", "chest_open",
                        "left_stretch", "right_stretch"],
    "back_upper_sore": ["chest_open", "both_hands_up",
                        "left_stretch", "right_stretch"],
    "waist_sore":      ["left_stretch", "right_stretch",
                        "both_hands_up", "chest_open"],
    "chest_tight":     ["chest_open", "both_hands_up",
                        "left_stretch", "right_stretch"],
}

# ── 动作中文名 ──────────────────────────────────────────────

ACTION_DISPLAY: Dict[str, str] = {
    "neck_turn_left": "颈部左转",
    "neck_turn_right": "颈部右转",
    "both_hands_up": "双手上举",
    "left_hand_up": "左手上举",
    "right_hand_up": "右手上举",
    "chest_open": "扩胸打开",
    "left_stretch": "左侧拉伸",
    "right_stretch": "右侧拉伸",
}

DEFAULT_PLAN: List[str] = ["颈部左转", "颈部右转", "双手上举", "扩胸打开"]

# ── 控制指令（与客户端 dialog_manager 对齐）─────────────────

CONTROL_COMMANDS: Dict[str, str] = {
    "开始办公": "enter_office",
    "返回办公模式": "enter_office",
    "结束办公": "end_office",
    "开始放松": "start_relax",
    "开始计分挑战": "start_challenge",
    "进入挑战": "start_challenge",
    "开始挑战": "start_challenge",
    "开始游戏": "start_game",
    "暂停": "pause",
    "继续": "resume",
    "换一个动作": "skip",
    "结束": "end",
    "上半身": "set_mode_upper",
    "全身": "set_mode_full",
}

CONTROL_REPLIES: Dict[str, str] = {
    "enter_office": "我已进入办公守护模式。感到不适时可以说：我肩膀酸、开始放松。",
    "end_office": "已退出办公模式，本次守护结束。建议起来走动一下。",
    "start_relax": "好的，先做一组 AI 引导放松，跟随提示自然呼吸。",
    "start_challenge": "进入标准放松。请跟随屏幕提示完成动作，注意呼吸节奏。",
    "start_game": "进入放松训练模式！跟随屏幕引导完成每个动作。",
    "pause": "已暂停，准备好后可以说「继续」。",
    "resume": "好的，继续当前训练。",
    "skip": "好的，切换到下一个动作。",
    "end": "本轮放松结束。建议活动一下肩颈，喝点水。",
    "set_mode_upper": "已选择上半身放松模式。",
    "set_mode_full": "已选择全身互动模式。",
}

CONTROL_NEXT_MODE: Dict[str, str] = {
    "enter_office": "office",
    "end_office": "summary",
    "start_relax": "relax_guidance",
    "start_challenge": "training",
    "start_game": "training",
    "pause": "paused",
    "resume": "relax_guidance",
    "skip": "training",
    "end": "summary",
    "set_mode_upper": "office",
    "set_mode_full": "office",
}


# ── 阶段 1：意图解析 ────────────────────────────────────────

def parse_intent(user_text: str) -> dict:
    """从用户文本解析意图。

    返回:
        kind: control / fatigue / unknown
        intent: 主意图标签（或控制动作名）
        intents: list[str]  全部命中意图
        body_parts: list[str]  疲劳部位
        raw: 原始文本
    """
    text = (user_text or "").strip()

    if text in CONTROL_COMMANDS:
        return {
            "kind": "control",
            "intent": CONTROL_COMMANDS[text],
            "intents": [],
            "body_parts": [],
            "raw": text,
        }

    matched: List[tuple] = []
    for intent_id, meta in INTENT_KEYWORDS.items():
        for kw in meta["keywords"]:
            if kw and kw in text:
                matched.append((intent_id, meta["part"]))
                break

    intents = [m[0] for m in matched]
    parts: List[str] = []
    for _, part in matched:
        if part not in parts:
            parts.append(part)

    if intents:
        return {
            "kind": "fatigue",
            "intent": intents[0],
            "intents": intents,
            "body_parts": parts,
            "raw": text,
        }

    return {
        "kind": "unknown",
        "intent": "unknown",
        "intents": [],
        "body_parts": [],
        "raw": text,
    }


# ── 阶段 2：动作推荐 ────────────────────────────────────────

def recommend_actions(parsed: dict,
                      user_state: Optional[dict] = None) -> List[str]:
    """根据意图推荐动作中文名列表。无明确意图时回退到默认上半身计划。"""
    if parsed.get("kind") != "fatigue" or not parsed.get("intents"):
        return list(DEFAULT_PLAN)

    seen = set()
    ordered: List[str] = []
    for intent in parsed["intents"]:
        for a in INTENT_TO_ACTIONS.get(intent, []):
            if a not in seen:
                seen.add(a)
                ordered.append(a)

    names = [ACTION_DISPLAY.get(a, a) for a in ordered]
    return names or list(DEFAULT_PLAN)


# ── 阶段 3：回复生成 ────────────────────────────────────────

def generate_reply(parsed: dict, actions: List[str],
                   user_state: Optional[dict] = None) -> str:
    """根据意图/动作/状态生成简短可执行回复。"""
    user_state = user_state or {}
    kind = parsed.get("kind")
    raw = parsed.get("raw", "")
    sit = user_state.get("sitting_minutes", 0) or 0

    prefix = f"你已久坐约 {sit} 分钟，" if sit and sit >= 45 else ""

    if kind == "control":
        return CONTROL_REPLIES.get(
            parsed.get("intent"), "好的，已处理你的指令。")

    if kind == "fatigue":
        parts = "、".join(parsed.get("body_parts", [])) or "紧张部位"
        plan = "、".join(actions) if actions else "上半身放松"
        if len(parsed.get("intents", [])) > 1:
            return (f"{prefix}我识别到你主要是{parts}紧张。"
                    f"建议先做{plan}，我会为你安排一组放松流程。"
                    f"是否开始上半身放松？")
        return (f"{prefix}检测到{parts}不适。建议做{plan}。"
                f"是否开始上半身放松？")

    return (f"我还没完全理解「{raw}」。你可以试试："
            f"我肩膀酸、我脖子酸、开始放松、换一个动作。")


# ── 下一模式 ────────────────────────────────────────────────

def compute_next_mode(parsed: dict) -> str:
    kind = parsed.get("kind")
    if kind == "control":
        return CONTROL_NEXT_MODE.get(parsed.get("intent"), "office")
    if kind == "fatigue":
        return "relax_guidance"
    return "office"


# ── LangGraph 可选编排 ──────────────────────────────────────

try:  # noqa: SIM105  故意宽泛捕获，保证缺失时不崩
    from langgraph.graph import StateGraph, START, END  # type: ignore
    _HAS_LANGGRAPH = True
except Exception:
    StateGraph = None  # type: ignore
    START = "START"    # type: ignore
    END = "END"        # type: ignore
    _HAS_LANGGRAPH = False


class _WFState(TypedDict, total=False):
    user_text: str
    user_state: dict
    parsed: dict
    actions: List[str]
    reply: str
    intent: str
    next_mode: str


def _node_parse(state: _WFState) -> dict:
    parsed = parse_intent(state.get("user_text", ""))
    return {"parsed": parsed, "intent": parsed.get("intent", "unknown")}


def _node_recommend(state: _WFState) -> dict:
    parsed = state.get("parsed", {})
    actions = recommend_actions(parsed, state.get("user_state"))
    return {"actions": actions, "next_mode": compute_next_mode(parsed)}


def _node_reply(state: _WFState) -> dict:
    reply = generate_reply(
        state.get("parsed", {}),
        state.get("actions", []),
        state.get("user_state"),
    )
    return {"reply": reply}


def _build_graph():
    builder = StateGraph(_WFState)
    builder.add_node("parse", _node_parse)
    builder.add_node("recommend", _node_recommend)
    builder.add_node("reply", _node_reply)
    builder.add_edge(START, "parse")
    builder.add_edge("parse", "recommend")
    builder.add_edge("recommend", "reply")
    builder.add_edge("reply", END)
    return builder.compile()


_GRAPH = None


def _run_chain(user_text: str, user_state: dict) -> dict:
    """普通函数链路：行为与 langgraph 编排完全一致。"""
    parsed = parse_intent(user_text)
    actions = recommend_actions(parsed, user_state)
    reply = generate_reply(parsed, actions, user_state)
    return {
        "parsed": parsed,
        "actions": actions,
        "reply": reply,
        "intent": parsed.get("intent", "unknown"),
        "next_mode": compute_next_mode(parsed),
    }


def run_workflow(user_text: str,
                 user_state: Optional[dict] = None) -> dict:
    """统一入口。

    返回:
        reply, intent, recommended_actions, next_mode, backend
    backend ∈ {"langgraph", "rules", "rules(fallback)"}
    """
    user_state = user_state or {}

    if _HAS_LANGGRAPH:
        try:
            global _GRAPH
            if _GRAPH is None:
                _GRAPH = _build_graph()
            result = _GRAPH.invoke(
                {"user_text": user_text, "user_state": user_state})
            backend = "langgraph"
        except Exception as e:  # langgraph 运行异常 → 降级到函数链路
            print(f"[ai_service] langgraph run failed, "
                  f"fallback to function chain: {e}")
            result = _run_chain(user_text, user_state)
            backend = "rules(fallback)"
    else:
        result = _run_chain(user_text, user_state)
        backend = "rules"

    parsed = result.get("parsed", {})
    return {
        "reply": result.get("reply", ""),
        "intent": result.get("intent", parsed.get("intent", "unknown")),
        "recommended_actions": result.get("actions", []),
        "next_mode": result.get("next_mode", "office"),
        "backend": backend,
    }
