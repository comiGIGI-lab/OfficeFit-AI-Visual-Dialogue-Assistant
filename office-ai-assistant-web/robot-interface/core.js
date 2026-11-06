/**
 * OfficeFit 机器人接口模块 - 感知决策核心 (v1)
 *
 * 与 UI 完全解耦：不碰 DOM、不读摄像头、不听麦克风。
 * 只消费协议观察（Observation），产出协议反馈（Feedback）。
 *
 * 运行模式：
 *  - 'robot'  : 机器人端推送观察，核心返回结构化反馈（speech / state / action / robot_hint）
 *  - 'degrade': 纯本地降级路径。行为完全一致，只是明确声明"无需任何云端/LLM 依赖"，
 *               供机器人离线使用。核心本身即是纯本地实现，两个模式共享全部逻辑。
 *
 * 依赖：ExerciseLibrary + parseSymptomIntent（来自 symptomIntentParser.js），
 *      RobotInterfaceProtocol（protocol.js）。浏览器下通过 <script> 全局引入，
 *      Node 下通过 require 注入（见 module.exports 处的依赖注入说明）。
 */

(function (global) {
    // ---------- 依赖解析（浏览器全局 / Node require） ----------
    let ExerciseLibrary, parseSymptomIntent, Protocol;

    if (typeof module !== 'undefined' && module.exports) {
        const parser = require('../symptomIntentParser.js');
        ExerciseLibrary = parser.ExerciseLibrary;
        parseSymptomIntent = parser.parseSymptomIntent;
        Protocol = require('./protocol.js');
    } else {
        ExerciseLibrary = global.ExerciseLibrary;
        parseSymptomIntent = global.parseSymptomIntent;
        Protocol = global.RobotInterfaceProtocol;
    }

    const { makeSpeechFeedback, makeStateFeedback, makeActionFeedback, makeRobotHint } = Protocol;

    // ---------- 配置 ----------
    const DEFAULT_CONFIG = {
        postureRules: {
            shoulderSlopeWarn: 0.05,      // 双肩高度差阈值（归一化坐标）
            forwardLeanWarn: 0.02,        // 耳-肩垂直距离低于此值判为前倾
            minVisibility: 0.4            // 关键点可见度下限，低于则该帧判定不可信
        },
        sedentary: {
            remindEverySeconds: 30,       // 久坐提醒间隔
            awayResetSeconds: 60          // 人离开多久后坐姿计时清零
        },
        intervention: {
            minIntervalSeconds: 20        // 干预节流：两条 speech 之间的最小间隔
        }
    };

    const MODE = {
        IDLE: 'idle',
        GUIDING: 'guiding',
        GAMING: 'gaming'
    };

    class OfficeFitCore {
        /**
         * @param {'robot'|'degrade'} [mode='robot'] 运行模式（逻辑一致，degrade 仅作显式声明）
         * @param {Object} [userConfig] 覆盖默认配置
         */
        constructor(mode = 'robot', userConfig = {}) {
            this.runMode = mode === 'degrade' ? 'degrade' : 'robot';
            this.config = {
                postureRules: { ...DEFAULT_CONFIG.postureRules, ...(userConfig.postureRules || {}) },
                sedentary: { ...DEFAULT_CONFIG.sedentary, ...(userConfig.sedentary || {}) },
                intervention: { ...DEFAULT_CONFIG.intervention, ...(userConfig.intervention || {}) }
            };

            this._resetState();
        }

        _resetState() {
            this.state = {
                mode: MODE.IDLE,
                personPresent: false,
                sittingStartTs: null,       // ms
                sittingSeconds: 0,
                lastSeenTs: null,           // 最近一次检测到人的时间
                awaySinceTs: null,          // 最近一次确认人离开的时间
                posture: 'unknown',         // 'good' | 'unbalanced_shoulders' | 'forward_lean' | 'unknown'
                distanceCm: null,
                // 动作引导进度
                exerciseName: null,
                scheduledActions: [],
                currentActionIndex: 0,
                // 干预节流（初始化为 -Infinity，保证第一条干预不被自己拦住）
                lastSpeechTs: -Infinity,
                lastRemindedSittingSeconds: -1,
                // 事件队列（一次性语音队列，机器人端每次 poll 后清空）
                _pendingSpeech: []
            };
        }

        // ================================================================
        // 输入入口
        // ================================================================

        /**
         * 消费一条观察。返回本次观察立即产生的反馈数组（通常为空或 1-2 条；
         * 持续性状态请通过 getStateSnapshot() 周期拉取）。
         * @param {Object} obs 协议观察，见 protocol.js
         * @returns {Array<Object>} 反馈数组
         */
        pushObservation(obs) {
            const check = Protocol.validateObservation(obs);
            if (!check.valid) {
                return [makeSpeechFeedback(`[协议错误] ${check.error}`, 3)];
            }

            switch (obs.type) {
                case 'pose':      return this._handlePose(obs);
                case 'person':    return this._handlePerson(obs);
                case 'distance':  return this._handleDistance(obs);
                case 'utterance': return this._handleUtterance(obs);
                default:          return [];
            }
        }

        // ---------- pose ----------
        _handlePose(obs) {
            const fb = [];
            const lm = obs.landmarks;

            this.state.personPresent = true;
            this.state.lastSeenTs = obs.ts;
            this.state.awaySinceTs = null;
            this._updateSittingTimer(obs.ts);

            // 姿态判断（关键点可见度不足时保持上一帧结论）
            const vis = (i) => (lm[i].visibility === undefined ? 1 : lm[i].visibility);
            const r = this.config.postureRules;
            if (vis(11) >= r.minVisibility && vis(12) >= r.minVisibility &&
                vis(7) >= r.minVisibility && vis(8) >= r.minVisibility) {
                const shoulderSlope = Math.abs(lm[11].y - lm[12].y);
                const earY = (lm[7].y + lm[8].y) / 2;
                const shoulderY = (lm[11].y + lm[12].y) / 2;
                const earShoulderDiff = Math.abs(earY - shoulderY);

                if (shoulderSlope > r.shoulderSlopeWarn) {
                    this.state.posture = 'unbalanced_shoulders';
                } else if (earShoulderDiff < r.forwardLeanWarn) {
                    this.state.posture = 'forward_lean';
                } else {
                    this.state.posture = 'good';
                }
            }

            // 久坐提醒（节流 + 同一秒内不重复）
            const s = this.state.sittingSeconds;
            if (this.state.mode === MODE.IDLE &&
                s > 0 &&
                s % this.config.sedentary.remindEverySeconds === 0 &&
                s !== this.state.lastRemindedSittingSeconds) {
                this.state.lastRemindedSittingSeconds = s;
                fb.push(makeSpeechFeedback(`您已连续坐了 ${s} 秒，建议起身活动一下。`, 2));
                fb.push(makeRobotHint('nod', 0.4));
                this.state.lastSpeechTs = obs.ts;
            }

            // 引导模式下检测当前动作完成度
            if (this.state.mode === MODE.GUIDING && this.state.scheduledActions.length > 0) {
                const actionFb = this._checkCurrentAction(lm);
                if (actionFb) fb.push(...actionFb);
            }

            fb.push(makeStateFeedback(this._publicState()));
            return fb;
        }

        // ---------- person ----------
        _handlePerson(obs) {
            const fb = [];
            const wasPresent = this.state.personPresent;
            this.state.personPresent = obs.present;

            if (obs.present) {
                this.state.lastSeenTs = obs.ts;
                this.state.awaySinceTs = null;
                this._updateSittingTimer(obs.ts);
                if (!wasPresent) {
                    fb.push(makeSpeechFeedback('检测到您回到座位，我会继续关注您的坐姿。', 1));
                }
            } else if (wasPresent) {
                // 人离开：记录离开时刻，持续离开超过阈值后清零坐姿计时
                this.state.awaySinceTs = obs.ts;
            }

            // 人持续不在场则重置久坐计时（从确认离开那一刻起算）
            if (!obs.present && this.state.sittingStartTs !== null && this.state.awaySinceTs !== null &&
                (obs.ts - this.state.awaySinceTs) / 1000 >= this.config.sedentary.awayResetSeconds) {
                this.state.sittingStartTs = null;
                this.state.sittingSeconds = 0;
                this.state.lastRemindedSittingSeconds = -1;
            }

            fb.push(makeStateFeedback(this._publicState()));
            return fb;
        }

        // ---------- distance ----------
        _handleDistance(obs) {
            this.state.distanceCm = obs.distanceCm;
            const fb = [];
            if (obs.distanceCm < 40) {
                // 视距过近（节流）
                if (this._canSpeak(obs.ts)) {
                    fb.push(makeSpeechFeedback('您离屏幕太近了，请保持 40 厘米以上的距离。', 2));
                    fb.push(makeRobotHint('shake', 0.3));
                    this.state.lastSpeechTs = obs.ts;
                }
            }
            fb.push(makeStateFeedback(this._publicState()));
            return fb;
        }

        // ---------- utterance ----------
        _handleUtterance(obs) {
            const text = (obs.text || '').trim();
            if (!text) return [];
            const fb = [];

            // 打断指令优先（用户在引导中说"暂停/停止"）
            if (this.state.mode === MODE.GUIDING &&
                (text.includes('暂停') || text.includes('停止') || text.includes('结束'))) {
                this._exitGuiding();
                fb.push(makeSpeechFeedback('好的，已停止本次训练。', 2));
                fb.push(makeStateFeedback(this._publicState()));
                return fb;
            }

            const intent = parseSymptomIntent(text);

            if (!intent.matched) {
                // 兜底：黑名单或未识别 → 原样播报提示（响应字段名为 response_text）
                fb.push(makeSpeechFeedback(intent.response_text || intent.message || '没听清，请再说一次。', 2));
                fb.push(makeStateFeedback(this._publicState()));
                return fb;
            }

            // 命中意图 → 进入动作引导
            const actions = intent.recommended_actions || intent.recommendedActions || [];
            const exerciseName = intent.exercise_name || intent.exerciseName || '放松训练';

            this.state.mode = MODE.GUIDING;
            this.state.exerciseName = exerciseName;
            this.state.scheduledActions = actions;
            this.state.currentActionIndex = 0;

            const intro = intent.response_text ||
                `识别到您的${exerciseName}需求，即将开始引导。`;
            fb.push(makeSpeechFeedback(intro, 2));
            fb.push(makeRobotHint('demonstrate', 0.8));

            // 下发第一个动作
            const first = ExerciseLibrary[actions[0]];
            fb.push(makeActionFeedback(
                exerciseName, actions, 0,
                first ? `${first.name}。${first.instruction}` : '请跟随引导开始动作。'
            ));
            fb.push(makeStateFeedback(this._publicState()));
            return fb;
        }

        // ================================================================
        // 动作引导
        // ================================================================

        _checkCurrentAction(landmarks) {
            const idx = this.state.currentActionIndex;
            if (idx >= this.state.scheduledActions.length) return null;

            const actionId = this.state.scheduledActions[idx];
            const action = ExerciseLibrary[actionId];
            if (!action || typeof action.checkLogic !== 'function') return null;

            const result = action.checkLogic(landmarks);
            const fb = [];

            if (result && result.completed) {
                this.state.currentActionIndex++;
                fb.push(makeSpeechFeedback(result.feedback || '动作完成。', 1));

                if (this.state.currentActionIndex < this.state.scheduledActions.length) {
                    const nextId = this.state.scheduledActions[this.state.currentActionIndex];
                    const next = ExerciseLibrary[nextId];
                    fb.push(makeActionFeedback(
                        this.state.exerciseName,
                        this.state.scheduledActions,
                        this.state.currentActionIndex,
                        next ? `${next.name}。${next.instruction}` : '请继续。'
                    ));
                } else {
                    // 全部完成
                    fb.push(makeSpeechFeedback(`太棒了！${this.state.exerciseName}训练完成。`, 2));
                    fb.push(makeRobotHint('wave', 0.8));
                    this._exitGuiding();
                }
            } else if (result && result.feedback) {
                // 未完成的纠正反馈也要下发（节流由机器人端/调用方控制或后续加）
                fb.push(makeSpeechFeedback(result.feedback, 1));
            }
            return fb;
        }

        _exitGuiding() {
            this.state.mode = MODE.IDLE;
            this.state.exerciseName = null;
            this.state.scheduledActions = [];
            this.state.currentActionIndex = 0;
        }

        // ================================================================
        // 内部工具
        // ================================================================

        _updateSittingTimer(nowTs) {
            if (this.state.sittingStartTs === null) {
                this.state.sittingStartTs = nowTs;
            }
            this.state.sittingSeconds = Math.floor((nowTs - this.state.sittingStartTs) / 1000);
        }

        _canSpeak(nowTs) {
            return (nowTs - this.state.lastSpeechTs) / 1000 >= this.config.intervention.minIntervalSeconds;
        }

        _publicState() {
            return {
                mode: this.state.mode,
                runMode: this.runMode,
                personPresent: this.state.personPresent,
                sittingSeconds: this.state.sittingSeconds,
                posture: this.state.posture,
                distanceCm: this.state.distanceCm,
                exerciseName: this.state.exerciseName,
                currentActionIndex: this.state.currentActionIndex,
                totalActions: this.state.scheduledActions.length
            };
        }

        // ================================================================
        // 周期拉取接口（机器人端主循环用）
        // ================================================================

        /** 当前状态快照（state feedback 的 state 部分） */
        getStateSnapshot() {
            return this._publicState();
        }

        /** 当前动作引导信息（无引导时返回 null） */
        getActionState() {
            if (this.state.mode !== MODE.GUIDING) return null;
            const actionId = this.state.scheduledActions[this.state.currentActionIndex];
            const action = actionId ? ExerciseLibrary[actionId] : null;
            return {
                exerciseName: this.state.exerciseName,
                actions: [...this.state.scheduledActions],
                currentActionIndex: this.state.currentActionIndex,
                instruction: action ? `${action.name}。${action.instruction}` : null
            };
        }
    }

    // 导出
    const api = { OfficeFitCore, MODE };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.OfficeFitCore = OfficeFitCore;
        global.OfficeFitCoreMODE = MODE;
    }
})(typeof window !== 'undefined' ? window : globalThis);
