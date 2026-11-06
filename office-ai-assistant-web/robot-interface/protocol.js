/**
 * OfficeFit 机器人接口模块 - 通信协议定义 (v1)
 *
 * 约定硬件端（机器人 / 摄像头硬件）与感知决策核心之间的标准化输入输出。
 * 协议设计目标：
 *  1. 机器人端只需要会"推观察、收反馈"，不需要理解健康引导业务逻辑；
 *  2. 全部计算本地完成（纯本地降级路径），不依赖云端 LLM；
 *  3. 每条消息带协议版本号，便于后续兼容升级。
 *
 * ============================ 输入：Observation ============================
 * 机器人端周期性（建议 5-10 Hz）或事件驱动地推送观察数据：
 *
 * { type: 'pose',        ts, landmarks: [{x, y, z, visibility} x33] }  // MediaPipe Pose 33 关键点（归一化坐标）
 * { type: 'person',      ts, present: bool }                            // 人是否在场（无关键点时也要报）
 * { type: 'distance',    ts, distanceCm: number }                       // 可选：深度相机提供的视距
 * { type: 'utterance',   ts, text: string }                             // ASR 识别出的用户语音文本
 *
 * ============================ 输出：Feedback ============================
 * 核心模块返回结构化反馈数组，机器人端按 kind 分发执行：
 *
 * { kind: 'speech',     priority, text }               // 需要 TTS 播报的文案，priority: 1=低 2=中 3=高（可打断）
 * { kind: 'state',      state }                        // 状态快照：{ personPresent, sittingSeconds, posture, mode }
 * { kind: 'action',     exerciseName, actions, currentActionIndex, instruction }  // 动作引导进度
 * { kind: 'robot_hint', motion, intensity }            // 建议的机身表现：motion = 'nod'|'shake'|'wave'|'light_flash'|'demonstrate'
 */

const PROTOCOL_VERSION = 'officefit-robot/v1';

/** 支持的动作库动作 id（与 ExerciseLibrary 对齐），供协议文档与校验使用 */
const KNOWN_OBSERVATION_TYPES = ['pose', 'person', 'distance', 'utterance'];

/**
 * 校验一条观察输入是否合法。
 * @param {Object} obs
 * @returns {{ valid: boolean, error?: string }}
 */
function validateObservation(obs) {
    if (!obs || typeof obs !== 'object') {
        return { valid: false, error: 'observation 必须是对象' };
    }
    if (!KNOWN_OBSERVATION_TYPES.includes(obs.type)) {
        return { valid: false, error: `未知观察类型: ${obs.type}，支持: ${KNOWN_OBSERVATION_TYPES.join('/')}` };
    }
    if (typeof obs.ts !== 'number') {
        return { valid: false, error: '缺少时间戳 ts（number, ms）' };
    }
    if (obs.type === 'pose') {
        if (!Array.isArray(obs.landmarks) || obs.landmarks.length !== 33) {
            return { valid: false, error: 'pose 观察需要 33 个关键点的 landmarks 数组' };
        }
    }
    if (obs.type === 'person' && typeof obs.present !== 'boolean') {
        return { valid: false, error: 'person 观察需要 present: boolean' };
    }
    if (obs.type === 'distance' && typeof obs.distanceCm !== 'number') {
        return { valid: false, error: 'distance 观察需要 distanceCm: number' };
    }
    if (obs.type === 'utterance' && typeof obs.text !== 'string') {
        return { valid: false, error: 'utterance 观察需要 text: string' };
    }
    return { valid: true };
}

/** 构造一条标准化反馈 */
function makeSpeechFeedback(text, priority = 1) {
    return { protocol: PROTOCOL_VERSION, kind: 'speech', priority, text };
}

function makeStateFeedback(state) {
    return { protocol: PROTOCOL_VERSION, kind: 'state', state: { ...state } };
}

function makeActionFeedback(exerciseName, actions, currentActionIndex, instruction) {
    return {
        protocol: PROTOCOL_VERSION,
        kind: 'action',
        exerciseName,
        actions: [...actions],
        currentActionIndex,
        instruction
    };
}

function makeRobotHint(motion, intensity = 0.5) {
    return { protocol: PROTOCOL_VERSION, kind: 'robot_hint', motion, intensity };
}

// 浏览器全局 + CommonJS 双导出
const RobotInterfaceProtocol = {
    PROTOCOL_VERSION,
    KNOWN_OBSERVATION_TYPES,
    validateObservation,
    makeSpeechFeedback,
    makeStateFeedback,
    makeActionFeedback,
    makeRobotHint
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RobotInterfaceProtocol;
}
if (typeof window !== 'undefined') {
    window.RobotInterfaceProtocol = RobotInterfaceProtocol;
}
