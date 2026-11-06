# OfficeFit 机器人接口模块（robot-interface）

把原本只在浏览器里跑的"办公放松 AI 视觉对话助手"，重构为**可被带摄像头的 AI 硬件（桌面机器人/陪伴硬件）直接调用的接口模块**。

核心思想：**感知决策逻辑与运行载体解耦**。
同一套 `OfficeFitCore`，web 端通过 `web-adapter.js` 接浏览器摄像头，机器人端按同样的协议接自己的深度相机/麦克风阵列——核心代码一行不用改。全部计算本地完成，**零云端依赖、零 LLM 调用**，机器人离线可跑（纯本地降级路径）。

## 目录结构

```
robot-interface/
├── protocol.js      # 通信协议：Observation 输入 / Feedback 输出的数据格式与校验
├── core.js          # 感知决策核心 OfficeFitCore（与 UI、硬件完全解耦）
├── web-adapter.js   # Web 浏览器适配层（参考实现：感知源怎么接进核心）
├── demo-robot.js    # 模拟机器人端 demo（node 直接跑，无需摄像头）
└── test-core.js     # 19 项冒烟测试（node 直接跑）
```

## 快速开始

```bash
# 跑测试（19 项）
node robot-interface/test-core.js

# 看模拟机器人 demo：久坐提醒 → 语音"我脖子酸" → 动作引导 → 训练完成
node robot-interface/demo-robot.js

# web 版：直接双击打开 index.html（需要摄像头权限）
```

## 机器人端接入（3 步）

```js
const { OfficeFitCore } = require('./robot-interface/core.js');
const core = new OfficeFitCore('robot');   // 或 'degrade'，行为一致

// 1. 周期性地把相机/ASR 数据转成协议观察推入
const feedbacks = core.pushObservation({ type: 'pose', ts: Date.now(), landmarks: /* MediaPipe 33 关键点 */ });
core.pushObservation({ type: 'utterance', ts: Date.now(), text: '我脖子酸' });

// 2. 把反馈分发给你的硬件能力
for (const fb of feedbacks) {
  if (fb.kind === 'speech')     myRobot.tts(fb.text);          // 语音播报（带优先级）
  if (fb.kind === 'robot_hint') myRobot.move(fb.motion);       // 机身动作提示：nod/shake/wave/demonstrate
  if (fb.kind === 'action')     myRobot.showGuide(fb);         // 动作引导进度
  if (fb.kind === 'state')      myRobot.updateDashboard(fb.state);
}

// 3. 主循环里也可以主动拉快照
const s = core.getStateSnapshot();  // { personPresent, sittingSeconds, posture, mode, ... }
```

## 协议摘要（详见 protocol.js 头部注释）

**输入 Observation**（机器人 → 核心）：

| type | 载荷 | 说明 |
|---|---|---|
| `pose` | `landmarks[33]` | MediaPipe Pose 关键点（归一化坐标，含 visibility） |
| `person` | `present: bool` | 人在场/离开（坐姿计时与人离开重置依赖此项） |
| `distance` | `distanceCm` | 可选：深度相机提供的视距，<40cm 触发护眼提醒 |
| `utterance` | `text` | ASR 文本，驱动症状意图识别与动作引导 |

**输出 Feedback**（核心 → 机器人）：

| kind | 载荷 | 机器人端怎么执行 |
|---|---|---|
| `speech` | `text, priority` | TTS 播报；priority 3 可打断当前播报 |
| `state` | 状态快照 | 仪表盘/指示灯 |
| `action` | `exerciseName, actions, currentActionIndex, instruction` | 屏幕显示引导进度，机身可做示范动作 |
| `robot_hint` | `motion, intensity` | 机身情绪动作：nod / shake / wave / light_flash / demonstrate |

## 核心能力一览

- **久坐监测**：在场自动计时，每 30s 提醒；离开 ≥60s 自动清零（含防抖修复）
- **姿态判断**：双肩不平衡 / 前倾 / 良好（关键点可见度过滤，坏帧不污染结论）
- **症状意图识别**：7 大部位 90+ 口语关键词（颈/肩/背/腰/臀腿/体态/全身），复合症状自动组合方案；黑名单（手指/眼/头等精细部位）明确拒答并建议就医
- **动作引导**：17 个拉伸动作库，逐动作 checkLogic 检测完成度，支持语音"暂停"打断
- **干预节流**：同类型提醒 20s 内不重复轰炸

## 设计说明

- **为什么不上 LLM**：健康引导的意图集合是封闭的（7 类症状 × 17 个动作），关键词解析在本地 100% 可控、零延迟、零成本、无幻觉风险。这正是"计算本地化 + 规则可解释"的架构选择，与玄学宜 do 的"本地排盘 + LLM 只解读"同一条工程思路。
- **web-adapter 是参考实现**：机器人端适配层照抄它的结构，把"浏览器摄像头/MediaPipe"换成"RDK 相机/板端推理"即可，核心无感知。
