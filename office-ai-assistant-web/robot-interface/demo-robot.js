/**
 * 模拟机器人端 demo
 *
 * 不用浏览器、不用摄像头：模拟一个带摄像头的桌面机器人，
 * 按协议向 OfficeFitCore 推送观察，打印收到的反馈。
 *
 * 运行：node robot-interface/demo-robot.js
 *
 * 演示场景（约 90 秒的压缩时间线）：
 *   1. 人坐下 → 姿态良好 → 久坐 30s 触发提醒
 *   2. 人说"我脖子酸" → 进入颈部放松引导 → 模拟完成两个动作 → 训练结束
 *   3. 人离开 → 计时清零
 */

const path = require('path');
const { OfficeFitCore } = require(path.join(__dirname, 'core.js'));

// ---------- 模拟硬件能力 ----------
const fakeRobot = {
    speak(text) { console.log(`  🤖 [TTS] ${text}`); },
    move(motion, intensity) { console.log(`  🦾 [动作] ${motion} (强度 ${intensity})`); },
    showState(state) {
        console.log(`  📊 [状态] 人在场=${state.personPresent} 坐姿=${state.sittingSeconds}s 姿态=${state.posture} 模式=${state.mode}`);
    },
    showAction(a) {
        console.log(`  🏃 [引导] ${a.exerciseName} 第${a.currentActionIndex + 1}/${a.actions.length}步: ${a.instruction}`);
    }
};

function dispatch(feedbacks) {
    for (const fb of feedbacks) {
        if (fb.kind === 'speech') fakeRobot.speak(fb.text);
        else if (fb.kind === 'state') fakeRobot.showState(fb.state);
        else if (fb.kind === 'action') fakeRobot.showAction(fb);
        else if (fb.kind === 'robot_hint') fakeRobot.move(fb.motion, fb.intensity);
    }
}

// ---------- 造一帧假关键点（33 个，全部可见，姿态端正） ----------
function makeLandmarks(overrides = {}) {
    const lm = Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: 0.5 + i * 0.01, z: 0, visibility: 0.99 }));
    // 默认：双肩水平（11/12 同高），耳肩距离正常
    lm[7] = { x: 0.45, y: 0.30, z: 0, visibility: 0.99 };   // 左耳
    lm[8] = { x: 0.55, y: 0.30, z: 0, visibility: 0.99 };   // 右耳
    lm[11] = { x: 0.42, y: 0.45, z: 0, visibility: 0.99 };  // 左肩
    lm[12] = { x: 0.58, y: 0.45, z: 0, visibility: 0.99 };  // 右肩
    Object.assign(lm, overrides);
    return lm;
}

// ---------- 场景播放 ----------
const core = new OfficeFitCore('robot');
let t = 0; // 模拟时间轴（ms），用虚拟时间压缩久坐等待
const step = (ms) => { t += ms; return t; };

console.log('=== 场景1: 人坐下，姿态良好 ===');
dispatch(core.pushObservation({ type: 'person', ts: step(0), present: true }));
dispatch(core.pushObservation({ type: 'pose', ts: step(1000), landmarks: makeLandmarks() }));

console.log('\n=== 场景1b: 久坐 30 秒，应触发提醒 ===');
dispatch(core.pushObservation({ type: 'pose', ts: step(30000), landmarks: makeLandmarks() }));

console.log('\n=== 场景2: 双肩不平（右肩抬高） ===');
const tilted = makeLandmarks();
tilted[12] = { x: 0.58, y: 0.38, z: 0, visibility: 0.99 }; // 右肩明显抬高
dispatch(core.pushObservation({ type: 'pose', ts: step(1000), landmarks: tilted }));

console.log('\n=== 场景3: 用户说"我脖子酸" → 进入引导 ===');
dispatch(core.pushObservation({ type: 'utterance', ts: step(1000), text: '我脖子酸' }));

console.log('\n=== 场景3b: 模拟完成第 1 个动作（侧平举 checkLogic 真实检测手臂角度） ===');
// 注：颈部放松第一个动作 neck_rotation 的 checkLogic 恒 true，一帧即过
dispatch(core.pushObservation({ type: 'pose', ts: step(1000), landmarks: makeLandmarks() }));

console.log('\n=== 场景3c: 再完成第 2 个动作 → 训练结束 ===');
dispatch(core.pushObservation({ type: 'pose', ts: step(1000), landmarks: makeLandmarks() }));

console.log('\n=== 场景4: 视距过近（35cm） ===');
dispatch(core.pushObservation({ type: 'distance', ts: step(1000), distanceCm: 35 }));

console.log('\n=== 场景5: 黑名单症状（"我手指麻"）→ 拒绝引导 ===');
dispatch(core.pushObservation({ type: 'utterance', ts: step(30000), text: '我手指麻' }));

console.log('\n=== 场景6: 人离开 61 秒 → 坐姿计时清零 ===');
dispatch(core.pushObservation({ type: 'person', ts: step(1000), present: false }));
dispatch(core.pushObservation({ type: 'person', ts: step(61000), present: false }));

console.log('\n=== 最终状态快照 ===');
console.log(JSON.stringify(core.getStateSnapshot(), null, 2));
