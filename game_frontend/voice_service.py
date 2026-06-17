# -*- coding: utf-8 -*-
"""
本地语音指令识别服务 (MVP)
===========================

支持可插拔语音识别后端：

- VoskOfflineBackend      — 离线中文识别（推荐路演使用）
- SpeechRecognitionGoogleBackend — Google 在线识别（需网络）
- MockQuickCommandBackend — 快捷输入兜底（无语音识别时）

选择规则（环境变量 OFFICEFIT_ASR_BACKEND）：
  "vosk"   → 仅 Vosk 离线识别
  "google" → 仅 Google 在线识别
  "auto"   → Vosk 优先 → Google 降级 → 快捷输入兜底
  未设置   → 等同 "auto"

用法:
    from game_frontend.voice_service import VoiceService

    voice = VoiceService()
    if voice.is_available():
        voice.set_callback(on_command)  # on_command(text: str)
        voice.start_listening()
        ...
        voice.stop_listening()

支持的关键词:
    - 开始放松
    - 暂停
    - 继续
    - 换一个动作
    - 结束
    - 上半身
    - 全身
"""

import os
import threading
import time
from typing import Optional, Callable


# ============================================================================
# 关键词列表 + 别名映射（不变）
# ============================================================================

_KEYWORD_ALIASES = {
    "开始放松": [
        "开始", "开始训练", "开始放松一下", "开始运动",
        "开始锻炼", "开始吧", "ready", "开始活动", "开始标准放松",
    ],
    "暂停": ["暂停一下", "停一下", "休息一下", "pause", "停止"],
    "继续": ["继续吧", "继续训练", "恢复", "resume", "go on"],
    "换一个动作": [
        "换一个", "换个动作", "换动作", "下一个动作",
        "下一个", "刷一个动作", "skip", "换",
    ],
    "结束": ["结束训练", "停止训练", "退出", "finish", "stop"],
    "上半身": ["上半身放松", "上半身训练", "upper body", "上半身模式"],
    "全身": ["全身放松", "全身训练", "full body", "全身互动", "全身模式"],
    "我脖子酸": ["脖子酸", "颈部酸", "低头久了", "脖子不舒服"],
    "我肩膀酸": ["肩膀酸", "肩膀发麻", "肩颈僵硬", "肩膀不舒服"],
    "腰背僵硬": ["背酸", "腰酸", "腰背不适"],
    # 旧口令兼容：统一归一化到"开始放松"，不在 UI 中主动展示。
    "开始放松": ["开始游戏", "开始挑战", "体感挑战", "游戏模式", "start"],
    "开始办公": ["开始工作", "办公模式"],
    "返回办公模式": ["回办公", "回到办公"],
    "结束办公": ["退出办公", "停止办公"],
}

_KEYWORD_MAP: dict = {}
for _std, _aliases in _KEYWORD_ALIASES.items():
    _KEYWORD_MAP[_std] = _std
    for _a in _aliases:
        _KEYWORD_MAP[_a] = _std

KEYWORDS = list(_KEYWORD_ALIASES.keys())


def _match_keyword(text: str):
    """在文本中匹配关键词（含同义词），返回标准关键词或 None"""
    if not text:
        return None
    text_lower = text.strip().lower()
    for keyword in KEYWORDS:
        if keyword in text_lower:
            return keyword
    for alias, standard in _KEYWORD_MAP.items():
        if alias in text_lower and alias != standard:
            return standard
    return None


# ── Vosk / 离线 ASR 常见错误修正 ─────────────────────────

# 已知 Vosk 中文短指令常见同音/近音错误 → 标准词
_ASR_PHONETIC_FIXES = {
    # 开始放松
    "开始放送": "开始放松", "开始方松": "开始放松", "开始放": "开始放松",
    "开始松": "开始放松", "开始饭送": "开始放松", "开时放松": "开始放松",
    "开始方": "开始放松", "开始放生": "开始放松", "开始方送": "开始放松",
    # 暂停
    "暂挺": "暂停", "站停": "暂停", "先停": "暂停", "停一下": "暂停",
    "暂停下": "暂停", "暂定": "暂停",
    # 继续
    "既续": "继续", "断续": "继续", "计序": "继续",
    # 换一个动作
    "换一个": "换一个动作", "换个动作": "换一个动作", "换一下": "换一个动作",
    "下一个动作": "换一个动作", "换个": "换一个动作", "换一个动做": "换一个动作",
    "换亿个动作": "换一个动作", "换动作": "换一个动作",
    # 结束
    "结速": "结束", "借宿": "结束", "结数": "结束", "姐束": "结束",
    # 肩膀症状
    "我间帮酸": "我肩膀酸", "我肩帮酸": "我肩膀酸", "肩酸": "我肩膀酸",
    "肩颈酸": "我肩膀酸", "肩颈紧": "我肩膀酸", "我肩酸": "我肩膀酸",
    "我坚绑酸": "我肩膀酸", "我肩膀栓": "我肩膀酸",
    # 脖子症状
    "我波子酸": "我脖子酸", "我博子酸": "我脖子酸", "我泊子酸": "我脖子酸",
    # 腰背症状
    "腰倍僵硬": "腰背僵硬", "要背僵硬": "腰背僵硬", "腰背将应": "腰背僵硬",
    "我腰酸": "腰背僵硬",
    # 上半身
    "上班身": "上半身",
    # 全身
    "权身": "全身", "全体": "全身",
}

# 可剥离的句尾语气词
_SENTENCE_PARTICLES = ["啊", "吧", "呢", "的", "了", "哦", "嗯", "呀", "嘛", "哈", "哟"]


def _normalize_common_asr_errors(text: str) -> str:
    """修正离线 ASR（Vosk）常见同音/近音识别错误。

    返回修正后的文本；如果没有匹配的修正规则，返回原文本。
    """
    t = text.strip()
    if not t:
        return t

    # 精确匹配
    if t in _ASR_PHONETIC_FIXES:
        return _ASR_PHONETIC_FIXES[t]

    # 剥离句尾语气词后再试
    for particle in _SENTENCE_PARTICLES:
        if t.endswith(particle) and len(t) > len(particle):
            stripped = t[:-len(particle)]
            if stripped in _ASR_PHONETIC_FIXES:
                return _ASR_PHONETIC_FIXES[stripped]

    # 如果文本包含已知错误片段，做部分替换（仅替换长度 >= 3 的片段，避免短词误伤）
    for wrong, correct in _ASR_PHONETIC_FIXES.items():
        if len(wrong) >= 3 and wrong in t:
            t = t.replace(wrong, correct)

    return t


def _dedup_repeated_phrase(text: str) -> str:
    """去除语音识别中常见的重复/截断现象。

    「开始放松开始放松开」→「开始放松」
    「暂停暂停」→「暂停」
    「换一个动作换一个动作」→「换一个动作」
    """
    if not text:
        return text
    n = len(text)
    for pat_len in range(2, n // 2 + 1):
        pat = text[:pat_len]
        i = pat_len
        while i + pat_len <= n and text[i:i + pat_len] == pat:
            i += pat_len
        remaining = n - i
        if i > pat_len and remaining > 0 and remaining < pat_len:
            if pat[:remaining] == text[i:]:
                i = n
        if i >= n:
            return pat
    return text


def normalize_command(text: str) -> str:
    """识别文本归一化。

    1. 去除重复识别（如「开始放松开始放松开」→「开始放松」）
    2. 修正离线 ASR 常见同音错误
    3. 关键词匹配 → 标准控制指令
    4. 身体不适等非控制语句原样返回，交给上层 intent_recognizer 处理
    """
    if not text:
        return ""
    t = text.strip()
    t = _dedup_repeated_phrase(t)
    t = _normalize_common_asr_errors(t)

    # ── 开始放松（含常见 Vosk 误识别变体）──
    if any(k in t for k in (
        "开始放", "开始方", "开始练", "开始训", "开始活动", "开始运动",
        "开始放松", "开始休息", "开始锻炼", "开始吧", "开始做",
        "计分挑战", "进入挑战", "开始挑战", "挑战模式",
        "开始游戏", "游戏模式", "体感挑战",
    )):
        return "开始放松"

    # ── 暂停 ──
    if any(k in t for k in (
        "暂停", "暂挺", "站停", "先停", "停一下", "暂定",
        "休息一下", "歇一下",
    )):
        return "暂停"

    # ── 继续 ──
    if any(k in t for k in (
        "继续", "既续", "接着来", "接着做", "接着训练", "接着",
        "继续吧", "继续训练",
    )):
        return "继续"

    # ── 换一个动作 ──
    if any(k in t for k in (
        "换一个", "下一个", "刷一个动作", "换个动作", "换动作",
        "换一下", "换个", "跳过", "下一个动作",
    )):
        return "换一个动作"

    # ── 结束 ──
    if any(k in t for k in (
        "结束", "结速", "借宿", "停止训练", "停止运动",
        "退出训练", "不做了",
    )):
        return "结束"
    if "停止" in t and "停止办公" not in t:
        return "结束"

    # ── 上半身 ──
    if any(k in t for k in ("上半身", "上班身", "上半身模式", "上半身放松")):
        return "上半身"

    # ── 全身 ──
    if any(k in t for k in ("全身", "全体", "权身", "全身模式", "全身放松", "全身互动")):
        return "全身"

    # ── 办公 ──
    if any(k in t for k in ("开始办公", "办公模式", "开始工作", "开启办公")):
        return "开始办公"
    if any(k in t for k in ("结束办公", "退出办公", "停止办公")):
        return "结束办公"

    # 其它（含身体不适）→ 原样返回，交给意图识别
    return t


# ============================================================================
# 语音后端基类
# ============================================================================

class VoiceBackendBase:
    """语音识别后端抽象基类"""

    @property
    def name(self) -> str:
        """后端标识名（vosk / google / mock）"""
        raise NotImplementedError

    @property
    def mode_label(self) -> str:
        """UI 显示标签（离线识别 / 在线识别 / 快捷输入 / 不可用）"""
        raise NotImplementedError

    @property
    def hint_text(self) -> str:
        """UI 提示文本（可选）"""
        return ""

    def is_available(self) -> bool:
        """后端是否可用"""
        raise NotImplementedError

    def recognize(self, audio_data) -> Optional[str]:
        """对音频数据执行识别，返回文本或 None（识别失败）"""
        raise NotImplementedError

    def cleanup(self):
        """释放后端资源"""
        pass


# ============================================================================
# Google 在线识别后端
# ============================================================================

class SpeechRecognitionGoogleBackend(VoiceBackendBase):
    """基于 speech_recognition + Google Web Speech API 的在线识别"""

    def __init__(self, language: str = "zh-CN"):
        self._language = language
        self._available = False
        try:
            import speech_recognition as sr  # noqa: F401
            self._available = True
        except ImportError:
            self._available = False

    @property
    def name(self) -> str:
        return "google"

    @property
    def mode_label(self) -> str:
        return "在线识别"

    @property
    def hint_text(self) -> str:
        return "在线识别依赖网络，路演建议使用离线识别或快捷输入。"

    def is_available(self) -> bool:
        return self._available

    def recognize(self, audio_data) -> Optional[str]:
        import speech_recognition as sr
        try:
            recognizer = sr.Recognizer()
            text = recognizer.recognize_google(audio_data, language=self._language)
            return text
        except sr.UnknownValueError:
            return None
        except sr.RequestError as e:
            raise ConnectionError(
                f"在线语音识别连接失败，已切换为快捷输入模式。"
            ) from e
        except OSError as e:
            raise ConnectionError(
                f"在线语音识别连接失败，已切换为快捷输入模式。"
            ) from e


# ============================================================================
# Vosk 离线识别后端
# ============================================================================

class VoskOfflineBackend(VoiceBackendBase):
    """基于 Vosk 的离线中文语音识别"""

    def __init__(self, model_path: Optional[str] = None, language: str = "zh-CN"):
        self._language = language
        self._model = None
        self._available = False
        self._error_message = ""

        # 确定模型路径
        if model_path:
            self._model_path = model_path
        else:
            self._model_path = os.environ.get(
                "OFFICEFIT_VOSK_MODEL_PATH", "").strip()

        if not self._model_path:
            # 默认路径
            script_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(script_dir)
            self._model_path = os.path.join(
                project_root, "models", "vosk-model-small-cn")

        # 尝试初始化
        self._init_vosk()

    def _init_vosk(self):
        """初始化 Vosk 模型"""
        # 1. 检查 vosk 包
        try:
            import vosk  # noqa: F401
        except ImportError:
            self._available = False
            self._error_message = (
                "vosk 未安装，请执行: pip install vosk"
            )
            return

        # 2. 检查模型目录
        if not os.path.isdir(self._model_path):
            self._available = False
            self._error_message = (
                f"未检测到离线语音模型，可下载 Vosk 中文小模型并放入 "
                f"{self._model_path}\n"
                f"下载地址: https://alphacephei.com/vosk/models\n"
                f"推荐模型: vosk-model-small-cn-0.22 (42MB)"
            )
            return

        # 3. 加载模型
        try:
            import vosk
            self._model = vosk.Model(self._model_path)
            self._available = True
            self._error_message = ""
            print(f"[Vosk] 离线模型已加载: {self._model_path}")
        except Exception as e:
            self._available = False
            self._error_message = (
                f"Vosk 模型加载失败: {e}\n"
                f"模型路径: {self._model_path}"
            )

    @property
    def name(self) -> str:
        return "vosk"

    @property
    def mode_label(self) -> str:
        return "离线识别"

    @property
    def hint_text(self) -> str:
        return ""

    def is_available(self) -> bool:
        return self._available

    @property
    def error_message(self) -> str:
        return self._error_message

    def recognize(self, audio_data) -> Optional[str]:
        if not self._model:
            return None
        try:
            import vosk
            import json

            # audio_data 是 speech_recognition AudioData
            # 获取原始 PCM 字节
            raw_pcm = audio_data.get_raw_data(
                convert_rate=16000,
                convert_width=2,
            )

            rec = vosk.KaldiRecognizer(self._model, 16000)
            if rec.AcceptWaveform(raw_pcm):
                result = json.loads(rec.Result())
                text = result.get("text", "").strip()
            else:
                partial = json.loads(rec.PartialResult())
                text = partial.get("partial", "").strip()

            return text if text else None
        except Exception as e:
            print(f"[Vosk] 识别异常: {e}")
            return None

    def cleanup(self):
        self._model = None
        self._available = False


# ============================================================================
# Mock 快捷输入后端（无语音识别时的兜底）
# ============================================================================

class MockQuickCommandBackend(VoiceBackendBase):
    """无语音识别时的占位后端 — 仅支持 simulate_command 快捷输入"""

    def __init__(self, reason: str = ""):
        self._reason = reason

    @property
    def name(self) -> str:
        return "mock"

    @property
    def mode_label(self) -> str:
        return "快捷输入"

    @property
    def hint_text(self) -> str:
        if self._reason:
            return self._reason
        return "语音识别未启用，可使用快捷输入"

    def is_available(self) -> bool:
        return False  # 麦克风不可用，但 simulate_command 仍可用

    def recognize(self, audio_data) -> Optional[str]:
        return None

    @property
    def reason(self) -> str:
        return self._reason


# ============================================================================
# 语音服务（后端编排 + 麦克风管理）
# ============================================================================

class VoiceService:
    """语音指令识别服务 — 自动选择后端并管理麦克风生命周期"""

    def __init__(self, language: str = "zh-CN"):
        self._language = language
        self._callback: Optional[Callable[[str], None]] = None
        self._volume_callback: Optional[Callable[[float], None]] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._stop_requested = False
        self._last_text: str = ""
        self._last_raw_text: str = ""
        self._last_normalized: str = ""
        self._last_error: str = ""
        self._last_error_type: str = ""
        self._voice_available: bool = False
        self._mic_device_name: str = ""
        self._mic_device_index: Optional[int] = None

        self._recognizer = None
        self._microphone = None
        self._pa = None
        self._volume_stream = None

        # ── 后端选择 ──
        self._backend: VoiceBackendBase = None
        self._backend_mode: str = "unavailable"
        self._select_backend()

        # 如果后端需要麦克风（google / vosk），初始化麦克风
        if self._backend is not None and self._backend.name in ("google", "vosk"):
            self._voice_available = self._mic_init()
        else:
            self._voice_available = False

        # 打印后端状态
        print(f"[Voice] 语音后端: {self._backend_mode} "
              f"({self._backend.mode_label if self._backend else '无'})"
              f"{' — 麦克风可用' if self._voice_available else ''}")

    # ── 后端选择逻辑 ────────────────────────────────────────

    def _select_backend(self):
        """根据环境变量选择语音后端"""
        backend_env = os.environ.get("OFFICEFIT_ASR_BACKEND", "auto").strip().lower()

        if backend_env == "vosk":
            self._try_vosk()
            if self._backend is None:
                # Vosk 不可用 — 降级到 mock
                reason = (
                    "离线语音模型不可用。可下载 Vosk 中文小模型：\n"
                    "models/vosk-model-small-cn\n"
                    "或设置 $env:OFFICEFIT_ASR_BACKEND='google' 使用在线识别"
                )
                self._backend = MockQuickCommandBackend(reason)
                self._backend_mode = "mock"
                print(f"[Voice] Vosk 不可用，降级为快捷输入")
        elif backend_env == "google":
            self._backend = SpeechRecognitionGoogleBackend(self._language)
            self._backend_mode = "google"
        else:  # "auto" 或未设置
            # 优先级：Vosk → Google → Mock
            self._try_vosk()
            if self._backend is not None:
                return  # Vosk 成功

            self._backend = SpeechRecognitionGoogleBackend(self._language)
            if self._backend.is_available():
                self._backend_mode = "google"
                return

            # 全部不可用 → Mock
            reason = (
                "语音识别未启用，可使用快捷输入。\n"
                "提示：安装 vosk + 中文模型可启用离线识别。"
            )
            self._backend = MockQuickCommandBackend(reason)
            self._backend_mode = "mock"

    def _try_vosk(self):
        """尝试初始化 Vosk 后端；成功则设置 self._backend 和 self._backend_mode"""
        backend = VoskOfflineBackend()
        if backend.is_available():
            self._backend = backend
            self._backend_mode = "vosk"
        else:
            print(f"[Voice] Vosk: {backend.error_message}")
            self._backend = None

    # ── 后端信息（供 UI 查询）─────────────────────────────

    @property
    def backend_mode(self) -> str:
        """当前语音模式标签: vosk / google / mock / unavailable"""
        return self._backend_mode

    @property
    def backend_label(self) -> str:
        """UI 显示的语音模式: 离线识别 / 在线识别 / 快捷输入 / 不可用"""
        if self._backend is None:
            return "不可用"
        return self._backend.mode_label

    @property
    def backend_hint(self) -> str:
        """UI 显示的提示文本"""
        if self._backend is None:
            return "语音识别未启用，可使用快捷输入"
        return self._backend.hint_text

    # ── 麦克风初始化 ─────────────────────────────────────

    def _list_input_devices(self):
        devices = []
        try:
            import pyaudio
            pa = pyaudio.PyAudio()
            for i in range(pa.get_device_count()):
                info = pa.get_device_info_by_index(i)
                if info.get("maxInputChannels", 0) > 0:
                    devices.append((i, info.get("name", "")))
            pa.terminate()
        except Exception:
            pass
        return devices

    def _mic_init(self):
        """初始化麦克风，返回 True/False"""
        try:
            import speech_recognition as sr
        except ImportError:
            self._last_error = (
                "speech_recognition 未安装，无法使用麦克风\n"
                "pip install SpeechRecognition"
            )
            self._last_error_type = "no_mic"
            return False

        sr_names = sr.Microphone.list_microphone_names()
        pa_devices = self._list_input_devices()

        if os.environ.get("OFFICEFIT_VOICE_DEBUG", "").strip() == "1":
            print("[Voice] Available microphones (speech_recognition):")
            for i, name in enumerate(sr_names):
                print(f"  [{i}] {name}")
            if pa_devices:
                print("[Voice] Input-capable devices (PyAudio):")
                for idx, name in pa_devices:
                    print(f"  [{idx}] {name}")

        if not pa_devices and not sr_names:
            self._last_error = "未检测到任何麦克风输入设备"
            self._last_error_type = "no_mic"
            return False

        env_index = os.environ.get("OFFICEFIT_MIC_INDEX", "").strip()
        recognizer = sr.Recognizer()

        if env_index:
            try:
                idx = int(env_index)
                mic = sr.Microphone(device_index=idx)
                name = (sr_names[idx] if idx < len(sr_names)
                        else pa_devices[0][1] if pa_devices else f"device {idx}")
                self._microphone = mic
                self._mic_device_index = idx
                self._mic_device_name = name
                self._recognizer = recognizer
                print(f"[Voice] Using microphone index: {idx}, name: {name} "
                      f"(OFFICEFIT_MIC_INDEX)")
                return True
            except Exception as e:
                self._last_error = (
                    f"麦克风设备编号 {env_index} 不可用: {e}\n"
                    f"请检查 OFFICEFIT_MIC_INDEX 是否正确设置\n"
                    f"可用编号: {[d[0] for d in pa_devices]}"
                )
                self._last_error_type = "no_mic"
                return False

        # 自动模式
        try:
            mic = sr.Microphone()
            self._microphone = mic
            self._mic_device_index = 0
            self._mic_device_name = sr_names[0] if sr_names else "default"
            self._recognizer = recognizer
            print(f"[Voice] Using microphone index: {self._mic_device_index}, "
                  f"name: {self._mic_device_name} (default)")
            return True
        except Exception as e:
            print(f"[Voice] 默认麦克风失败: {e}, 尝试 fallback...")

        for idx, name in pa_devices:
            try:
                mic = sr.Microphone(device_index=idx)
                self._microphone = mic
                self._mic_device_index = idx
                self._mic_device_name = name
                self._recognizer = recognizer
                print(f"[Voice] Using microphone index: {idx}, name: {name} "
                      f"(fallback)")
                return True
            except Exception:
                continue

        self._last_error = (
            "所有麦克风设备初始化失败\n"
            "可尝试手动指定: $env:OFFICEFIT_MIC_INDEX='编号'"
        )
        self._last_error_type = "no_mic"
        return False

    # ── 公开 API ──────────────────────────────────────────

    def is_available(self) -> bool:
        """语音识别是否可用（有可用的后端 + 麦克风就绪）"""
        return self._voice_available

    @property
    def mic_device_name(self) -> str:
        return self._mic_device_name

    @property
    def mic_device_index(self) -> Optional[int]:
        return self._mic_device_index

    @property
    def last_text(self) -> str:
        return self._last_text

    @property
    def last_error(self) -> str:
        return self._last_error

    @property
    def last_error_type(self) -> str:
        return self._last_error_type

    @property
    def last_raw_text(self) -> str:
        return self._last_raw_text

    @property
    def last_normalized(self) -> str:
        return self._last_normalized

    def set_callback(self, callback: Callable[[str], None]):
        self._callback = callback

    def set_volume_callback(self, callback: Callable[[float], None]):
        self._volume_callback = callback

    def start_listening(self):
        """启动单次监听（最长 5 秒，识别到或超时后自动停止）"""
        if not self._voice_available:
            self._last_error = "语音识别不可用，无法启动监听"
            self._last_error_type = "no_mic"
            return

        if self._running:
            return

        self._running = True
        self._stop_requested = False
        self._last_text = ""
        self._last_error = ""
        self._last_error_type = ""
        self._start_volume_monitor()
        self._thread = threading.Thread(target=self._listen_once, daemon=True)
        self._thread.start()
        print("[Voice] Listening started (max 5s)...")

    def request_stop(self):
        self._stop_requested = True
        print("[Voice] Stop requested by user")

    def stop_listening(self):
        self._running = False
        self._stop_volume_monitor()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
        print("[Voice] Listening stopped")

    # ── 音量监测 ──────────────────────────────────────────

    def _start_volume_monitor(self):
        self._stop_volume_monitor()
        try:
            import pyaudio
            self._pa = pyaudio.PyAudio()
            device_index = (self._mic_device_index
                           if self._mic_device_index is not None
                           else None)
            self._volume_stream = self._pa.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=16000,
                input=True,
                input_device_index=device_index,
                frames_per_buffer=512,
                stream_callback=self._volume_stream_callback,
            )
        except Exception as e:
            print(f"[Voice] Volume monitor init failed: {e}")
            self._volume_stream = None

    def _volume_stream_callback(self, in_data, frame_count, time_info, status):
        try:
            import pyaudio
            import numpy as np
            audio_data = np.frombuffer(in_data, dtype=np.int16).astype(np.float32)
            rms = np.sqrt(np.mean(audio_data ** 2)) if len(audio_data) > 0 else 0
            level = min(1.0, max(0.0, rms / 4000.0))
            if self._volume_callback:
                self._volume_callback(level)
            return (None, pyaudio.paContinue)
        except Exception:
            return (None, 0)

    def _stop_volume_monitor(self):
        if self._volume_stream is not None:
            try:
                self._volume_stream.stop_stream()
                self._volume_stream.close()
            except Exception:
                pass
            self._volume_stream = None
        if self._pa is not None:
            try:
                self._pa.terminate()
            except Exception:
                pass
            self._pa = None

    # ── 单次监听 ──────────────────────────────────────────

    def _listen_once(self):
        """单次监听：录音 → 后端识别 → 回调"""
        import speech_recognition as sr

        if not self._microphone or not self._recognizer:
            self._running = False
            self._stop_volume_monitor()
            return

        # 噪声校准
        try:
            with self._microphone as source:
                self._recognizer.adjust_for_ambient_noise(source, duration=0.5)
        except Exception as e:
            self._last_error = f"噪声校准失败: {e}"
            self._last_error_type = "no_mic"
            self._running = False
            self._stop_volume_monitor()
            return

        # 录音
        try:
            with self._microphone as source:
                audio = self._recognizer.listen(
                    source, timeout=5.0, phrase_time_limit=3.0)

            if self._stop_requested:
                print("[Voice] User stopped recording, recognizing captured audio...")

            # ── 使用后端识别 ──
            try:
                text = self._backend.recognize(audio)
            except ConnectionError as e:
                # 在线识别连接失败 → 用户可理解文案
                self._last_error = str(e)
                self._last_error_type = "service_error"
                print(f"[Voice] 在线语音识别连接失败，已切换为快捷输入模式。")
                print(f"[Voice] 详细错误: {e.__cause__ if e.__cause__ else e}")
                self._running = False
                self._stop_volume_monitor()
                return
            except Exception as e:
                self._last_error = f"识别异常: {e}"
                self._last_error_type = "service_error"
                print(f"[Voice] {self._last_error}")
                self._running = False
                self._stop_volume_monitor()
                return

            if text:
                # 识别成功
                self._last_error = ""
                self._last_error_type = ""
                self._last_raw_text = text
                command = normalize_command(text)
                self._last_normalized = command
                self._last_text = command
                print(f"[Voice] raw: {text}")
                if command != text:
                    print(f"[Voice] normalized: {command}")
                if command and self._callback:
                    self._callback(command)
            else:
                # 后端返回 None（没听清 / 无语音）
                if self._stop_requested:
                    self._last_error = "录音已结束"
                    self._last_error_type = "user_stop"
                else:
                    self._last_error = "没有听清，请再试一次或使用快捷输入"
                    self._last_error_type = "no_speech"
                print(f"[Voice] {self._last_error}")

        except sr.WaitTimeoutError:
            if self._stop_requested:
                self._last_error = "录音已结束"
                self._last_error_type = "user_stop"
            else:
                self._last_error = "未检测到语音，请再试一次"
                self._last_error_type = "timeout"
            print(f"[Voice] {self._last_error}")
        except OSError as e:
            self._last_error = f"麦克风异常: {e}"
            self._last_error_type = "no_mic"
            print(f"[Voice] {self._last_error}")
        except Exception as e:
            self._last_error = f"监听异常: {e}"
            self._last_error_type = "service_error"
            print(f"[Voice] {self._last_error}")

        self._running = False
        self._stop_volume_monitor()

    def simulate_command(self, text: str):
        """快捷输入（用于演示 / 无麦克风环境的备用输入）"""
        command = normalize_command(text)
        self._last_raw_text = text
        self._last_normalized = command
        self._last_text = command
        print(f"[Voice] Quick input raw: {text}")
        if command != text:
            print(f"[Voice] Quick input normalized: {command}")
        if command and self._callback:
            self._callback(command)

    def cleanup(self):
        """释放所有资源"""
        self.stop_listening()
        if self._backend is not None:
            self._backend.cleanup()
