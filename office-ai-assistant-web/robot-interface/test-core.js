/**
 * OfficeFitCore 冒烟测试（无框架，node test-core.js 直接跑）
 */
const path = require('path');
const assert = require('assert');
const { OfficeFitCore } = require(path.join(__dirname, 'core.js'));
const { validateObservation } = require(path.join(__dirname, 'protocol.js'));

let passed = 0;
function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        console.error(`  ❌ ${name}: ${e.message}`);
        process.exitCode = 1;
    }
}

function makeLandmarks() {
    const lm = Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: 0.5 + i * 0.01, z: 0, visibility: 0.99 }));
    lm[7] = { x: 0.45, y: 0.30, z: 0, visibility: 0.99 };
    lm[8] = { x: 0.55, y: 0.30, z: 0, visibility: 0.99 };
    lm[11] = { x: 0.42, y: 0.45, z: 0, visibility: 0.99 };
    lm[12] = { x: 0.58, y: 0.45, z: 0, visibility: 0.99 };
    return lm;
}

const stateOf = (fbs) => (fbs.find(f => f.kind === 'state') || {}).state || {};
const speeches = (fbs) => fbs.filter(f => f.kind === 'speech');

console.log('--- 协议校验 ---');
check('合法 pose 观察通过', () => {
    assert.strictEqual(validateObservation({ type: 'pose', ts: 1, landmarks: makeLandmarks() }).valid, true);
});
check('33 点数量不符被拒', () => {
    assert.strictEqual(validateObservation({ type: 'pose', ts: 1, landmarks: [] }).valid, false);
});
check('未知类型被拒', () => {
    assert.strictEqual(validateObservation({ type: 'lidar', ts: 1 }).valid, false);
});
check('缺时间戳被拒', () => {
    assert.strictEqual(validateObservation({ type: 'person', present: true }).valid, false);
});

console.log('--- 久坐计时 ---');
check('人在场累计坐姿秒数', () => {
    const c = new OfficeFitCore();
    c.pushObservation({ type: 'pose', ts: 0, landmarks: makeLandmarks() });
    const fbs = c.pushObservation({ type: 'pose', ts: 15000, landmarks: makeLandmarks() });
    assert.strictEqual(stateOf(fbs).sittingSeconds, 15);
});
check('30 秒整触发一次久坐提醒', () => {
    const c = new OfficeFitCore();
    c.pushObservation({ type: 'pose', ts: 0, landmarks: makeLandmarks() });
    const fbs = c.pushObservation({ type: 'pose', ts: 30000, landmarks: makeLandmarks() });
    assert.strictEqual(speeches(fbs).length, 1);
    assert.ok(speeches(fbs)[0].text.includes('30'));
});
check('同一秒不重复提醒', () => {
    const c = new OfficeFitCore();
    c.pushObservation({ type: 'pose', ts: 0, landmarks: makeLandmarks() });
    c.pushObservation({ type: 'pose', ts: 30000, landmarks: makeLandmarks() });
    const fbs = c.pushObservation({ type: 'pose', ts: 30100, landmarks: makeLandmarks() });
    assert.strictEqual(speeches(fbs).length, 0);
});
check('人离开 60s 后计时清零', () => {
    const c = new OfficeFitCore();
    c.pushObservation({ type: 'pose', ts: 0, landmarks: makeLandmarks() });
    c.pushObservation({ type: 'person', ts: 1000, present: false });
    const fbs = c.pushObservation({ type: 'person', ts: 62000, present: false });
    assert.strictEqual(stateOf(fbs).sittingSeconds, 0);
});
check('回归：离开后重置又收到 pose 帧，计时从回座重新起算', () => {
    const c = new OfficeFitCore();
    c.pushObservation({ type: 'pose', ts: 0, landmarks: makeLandmarks() });
    c.pushObservation({ type: 'person', ts: 1000, present: false });
    c.pushObservation({ type: 'person', ts: 62000, present: false }); // 触发清零
    const fbs = c.pushObservation({ type: 'pose', ts: 63000, landmarks: makeLandmarks() }); // 回座
    assert.strictEqual(stateOf(fbs).sittingSeconds, 0);
});

console.log('--- 姿态判断 ---');
check('端正姿态 = good', () => {
    const c = new OfficeFitCore();
    const fbs = c.pushObservation({ type: 'pose', ts: 0, landmarks: makeLandmarks() });
    assert.strictEqual(stateOf(fbs).posture, 'good');
});
check('右肩抬高 = unbalanced_shoulders', () => {
    const c = new OfficeFitCore();
    const lm = makeLandmarks();
    lm[12] = { x: 0.58, y: 0.38, z: 0, visibility: 0.99 };
    const fbs = c.pushObservation({ type: 'pose', ts: 0, landmarks: lm });
    assert.strictEqual(stateOf(fbs).posture, 'unbalanced_shoulders');
});

console.log('--- 语音意图与动作引导 ---');
check('"我脖子酸"进入引导并下发第一个动作', () => {
    const c = new OfficeFitCore();
    const fbs = c.pushObservation({ type: 'utterance', ts: 0, text: '我脖子酸' });
    const action = fbs.find(f => f.kind === 'action');
    assert.ok(action, '应有 action 反馈');
    assert.strictEqual(action.exerciseName, '颈部放松');
    assert.strictEqual(stateOf(fbs).mode, 'guiding');
});
check('两个动作依次完成后回到 idle', () => {
    const c = new OfficeFitCore();
    c.pushObservation({ type: 'utterance', ts: 0, text: '我脖子酸' });
    c.pushObservation({ type: 'pose', ts: 1000, landmarks: makeLandmarks() }); // 完成动作1
    const fbs = c.pushObservation({ type: 'pose', ts: 2000, landmarks: makeLandmarks() }); // 完成动作2
    assert.strictEqual(stateOf(fbs).mode, 'idle');
});
check('引导中说"暂停"立即退出', () => {
    const c = new OfficeFitCore();
    c.pushObservation({ type: 'utterance', ts: 0, text: '我脖子酸' });
    const fbs = c.pushObservation({ type: 'utterance', ts: 500, text: '暂停' });
    assert.strictEqual(stateOf(fbs).mode, 'idle');
});
check('黑名单症状不进入引导', () => {
    const c = new OfficeFitCore();
    const fbs = c.pushObservation({ type: 'utterance', ts: 0, text: '我手指麻' });
    assert.strictEqual(stateOf(fbs).mode, 'idle');
    assert.ok(speeches(fbs)[0].text.includes('医生'));
});
check('未识别文本有兜底回复', () => {
    const c = new OfficeFitCore();
    const fbs = c.pushObservation({ type: 'utterance', ts: 0, text: '今天天气怎么样' });
    assert.ok(speeches(fbs).length >= 1);
    assert.strictEqual(stateOf(fbs).mode, 'idle');
});

console.log('--- 视距 ---');
check('视距 <40cm 触发提醒', () => {
    const c = new OfficeFitCore();
    const fbs = c.pushObservation({ type: 'distance', ts: 0, distanceCm: 35 });
    assert.ok(speeches(fbs).some(s => s.text.includes('太近')));
});
check('干预节流：20s 内不重复提醒', () => {
    const c = new OfficeFitCore();
    c.pushObservation({ type: 'distance', ts: 0, distanceCm: 35 });
    const fbs = c.pushObservation({ type: 'distance', ts: 5000, distanceCm: 30 });
    assert.strictEqual(speeches(fbs).length, 0);
});

console.log('--- degrade 模式 ---');
check('degrade 模式行为一致且无需云端', () => {
    const c = new OfficeFitCore('degrade');
    const fbs = c.pushObservation({ type: 'utterance', ts: 0, text: '腰疼' });
    assert.strictEqual(stateOf(fbs).mode, 'guiding');
    assert.strictEqual(stateOf(fbs).runMode, 'degrade');
});

console.log(`\n${passed} 项通过${process.exitCode ? '，有失败' : ''}`);
