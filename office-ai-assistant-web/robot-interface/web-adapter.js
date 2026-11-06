/**
 * Web 浏览器适配层
 *
 * 把浏览器特有的感知源（MediaPipe Pose 结果、Web Speech API 语音识别）
 * 转换成协议观察（Observation）推给 OfficeFitCore；
 * 再把核心返回的反馈（Feedback）渲染成 UI（文字提示）+ 语音合成播报。
 *
 * 这个文件是"web 端怎么接入接口模块"的参考实现：
 * 机器人端的适配层（RDK / ROS 上跑的那个）和它结构一致——
 * 换成从深度相机 SDK 收关键点、从麦克风阵列收 ASR 文本即可，核心不用动。
 *
 * 依赖（需在此之前加载）：
 *   symptomIntentParser.js → robot-interface/protocol.js → robot-interface/core.js → 本文件
 */

class OfficeFitWebAdapter {
    /**
     * @param {Object} callbacks
     *   onFeedbackText(text)  把 speech 类反馈显示在 UI 上
     *   onState(state)        状态快照更新（坐姿时长、姿态等）
     *   onAction(actionInfo)  动作引导更新
     */
    constructor(callbacks = {}) {
        // 降级路径声明：web 端同样跑纯本地核心，不依赖云端 LLM
        this.core = new OfficeFitCore('degrade');
        this.onFeedbackText = callbacks.onFeedbackText || ((t) => console.log('[OfficeFit]', t));
        this.onState = callbacks.onState || (() => {});
        this.onAction = callbacks.onAction || (() => {});

        this._lastSpoken = '';
        this._speechEnabled = typeof window !== 'undefined' && 'speechSynthesis' in window;
    }

    /** MediaPipe onResults 回调接入点：直接传 results.poseLandmarks（没有就传 null） */
    handlePoseResults(results) {
        const now = Date.now();
        let feedbacks;
        if (results && results.poseLandmarks) {
            feedbacks = this.core.pushObservation({
                type: 'pose',
                ts: now,
                landmarks: results.poseLandmarks
            });
        } else {
            // 人离开画面也要通知核心（坐姿计时逻辑依赖）
            feedbacks = this.core.pushObservation({ type: 'person', ts: now, present: false });
        }
        this._dispatch(feedbacks);
    }

    /** Web Speech API 识别结果接入点 */
    handleUtterance(text) {
        const feedbacks = this.core.pushObservation({
            type: 'utterance',
            ts: Date.now(),
            text
        });
        this._dispatch(feedbacks);
    }

    /** 如果浏览器端接了深度信息（如 RealSense Web 桥），从这里推 */
    handleDistance(distanceCm) {
        const feedbacks = this.core.pushObservation({
            type: 'distance',
            ts: Date.now(),
            distanceCm
        });
        this._dispatch(feedbacks);
    }

    /** 反馈分发：speech → UI+TTS，state/action → UI 回调，robot_hint → 控制台提示 */
    _dispatch(feedbacks) {
        for (const fb of feedbacks) {
            switch (fb.kind) {
                case 'speech':
                    this.onFeedbackText(fb.text);
                    this._speak(fb.text);
                    break;
                case 'state':
                    this.onState(fb.state);
                    break;
                case 'action':
                    this.onAction({
                        exerciseName: fb.exerciseName,
                        actions: fb.actions,
                        currentActionIndex: fb.currentActionIndex,
                        instruction: fb.instruction
                    });
                    break;
                case 'robot_hint':
                    // web 端没有机身，用 emoji 在控制台模拟一下动作提示
                    console.log(`[robot_hint] ${fb.motion} (intensity=${fb.intensity})`);
                    break;
                default:
                    console.warn('[OfficeFitWebAdapter] 未知反馈类型', fb);
            }
        }
    }

    /** 浏览器 TTS 播报（简单去抖：同一句不重复念） */
    _speak(text) {
        if (!this._speechEnabled || !text || text === this._lastSpoken) return;
        this._lastSpoken = text;
        try {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'zh-CN';
            u.rate = 1.05;
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(u);
        } catch (e) {
            console.warn('TTS 播报失败', e);
        }
    }
}

// 浏览器全局导出
if (typeof window !== 'undefined') {
    window.OfficeFitWebAdapter = OfficeFitWebAdapter;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OfficeFitWebAdapter };
}
