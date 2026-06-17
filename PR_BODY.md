## 概述
在 `feature/local-voice-mvp` 基础上完成两项工作：① 修复录音期 paintEvent 崩溃；② 新增端云协同 AI 服务层，供路演展示端云协同架构。

## 改动一：修复录音 paintEvent 崩溃（SystemError: PY_SSIZE_T_CLEAN / QBackingStore::endPaint）
- 根因：PortAudio 音频线程回调直接触发 `VolumeBar.update()`，跨线程绘制破坏 backing store。
- `VolumeBar` 改为原生 `QProgressBar`，移除自绘 paintEvent。
- `AssistantPanel` 通过 Qt `Signal` 把音量投递回 GUI 线程更新（跨线程自动 queued）。
- 其余 paintEvent 补 `try/except/finally` 兜底，确保 `painter.end()` 必执行。

## 改动二：端云协同 AI 服务（新增 `ai_service/`）
- FastAPI：`GET /health`、`POST /api/dialog`。
- `workflow.py`：`parse_intent → recommend_actions → generate_reply`；`langgraph` 可导入则用 `StateGraph` 编排，缺失/出错自动降级为函数链路，**不崩溃**。
- `ai_client.py`：新增 `OFFICEFIT_AI_PROVIDER=officefit_service`；服务不可用时 `generate_reply` 返回 `None`，主流程**自动回退本地 `dialog_manager` 规则**。
- **隐私**：仅上传文本 + 脱敏状态（posture/久坐/疲劳部位/相机/深度/模式），不上传视频/深度图/原始音频。
- README 补「端云协同服务」运行说明。

## 自测
- [x] `py_compile ai_service/*.py game_frontend/*.py`（20 文件）
- [x] `uvicorn ai_service.main:app` 起服务，`/health` + `/api/dialog`（症状/控制/未知 3 例）返回正确
- [x] 服务宕机 → 客户端 `generate_reply` 返回 `None` → 本地规则回退
- [x] 跨线程音量渲染复测：0 SystemError / 0 QBackingStore 警告
- [ ] 交互式麦克风点击测试（待人工）

## 不在本 PR
- 未改相机 / YOLO / MediaPipe / Vosk / `dialog_manager` / PySide6 主流程
- 未提交 `models/vosk-model-small-cn/`（已加入 .gitignore）