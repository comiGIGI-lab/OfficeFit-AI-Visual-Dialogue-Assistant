// app.js - 办公放松AI助手MVP核心逻辑

// ==================== 全局状态与DOM元素 ====================
// 业务状态（模式/坐姿/引导进度）已全部迁移至 OfficeFitCore，这里只留 UI 相关开关
const state = {
    isCameraActive: false,
    isListening: false
};

// 获取DOM元素
const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const startBtn = document.getElementById('start_btn');
const stopBtn = document.getElementById('stop_btn');
const toggleMicBtn = document.getElementById('toggle_mic_btn');
const cameraSelect = document.getElementById('camera_select');
const currentModeEl = document.getElementById('current_mode');
const sittingTimerEl = document.getElementById('sitting_timer');
const feedbackEl = document.getElementById('feedback_text');
const statusOverlay = document.getElementById('status_overlay');

// 存储可用的摄像头设备
let availableCameras = [];
let selectedCameraId = null;

// ==================== 机器人接口模块接入 ====================
// app.js 不再直接实现姿态/意图/引导逻辑，全部转发给 robot-interface 的核心；
// 这里只保留摄像头、画布、按钮等浏览器特有的部分。
// 机器人端接入方式见 robot-interface/demo-robot.js 与 robot-interface/README.md
const officeFit = new OfficeFitWebAdapter({
    onFeedbackText: (text) => updateFeedback(text),
    onState: (s) => {
        sittingTimerEl.textContent = s.sittingSeconds;
        const postureMap = {
            good: '良好',
            unbalanced_shoulders: '肩膀不平衡',
            forward_lean: '可能前倾',
            unknown: '检测中'
        };
        const postureEl = document.getElementById('posture_status');
        if (postureEl) postureEl.textContent = postureMap[s.posture] || s.posture;
        if (s.distanceCm !== null) {
            const distEl = document.getElementById('distance_status');
            if (distEl) distEl.textContent = s.distanceCm < 40 ? `过近（${s.distanceCm}cm）` : '适中';
        }
        updateModeDisplay(s.mode);
    },
    onAction: (a) => {
        document.getElementById('current_exercise').textContent =
            `进行中：${a.exerciseName}（第${a.currentActionIndex + 1}/${a.actions.length}步）`;
        document.getElementById('exercise_progress').style.width =
            `${Math.round((a.currentActionIndex / a.actions.length) * 100)}%`;
        if (a.instruction) updateFeedback(a.instruction);
    }
});

// ==================== 1. 初始化摄像头 ====================
async function initCamera() {
    try {
        updateStatusOverlay('正在请求摄像头权限...');
        
        // 检查浏览器是否支持
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('您的浏览器不支持摄像头访问，请使用Chrome或Edge浏览器');
        }
        
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: true // 同时请求麦克风权限
        });
        
        videoElement.srcObject = stream;
        
        // 等待视频元数据加载完成
        await new Promise((resolve, reject) => {
            videoElement.onloadedmetadata = () => {
                videoElement.play()
                    .then(resolve)
                    .catch(reject);
            };
            videoElement.onerror = reject;
        });
        
        updateStatusOverlay('摄像头已就绪');
        
        // 设置画布尺寸与视频一致
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
        
        state.isCameraActive = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        updateFeedback('系统已启动，正在初始化姿态检测...');
        
        return true;
    } catch (err) {
        console.error('摄像头初始化失败:', err);
        
        let errorMessage = '无法访问摄像头';
        if (err.name === 'NotAllowedError') {
            errorMessage = '摄像头权限被拒绝，请在浏览器地址栏左侧允许摄像头访问';
        } else if (err.name === 'NotFoundError') {
            errorMessage = '未检测到摄像头设备，请确保摄像头已连接';
        } else if (err.name === 'NotReadableError') {
            errorMessage = '摄像头被其他程序占用，请关闭其他使用摄像头的应用';
        } else if (err.message) {
            errorMessage = err.message;
        }
        
        updateStatusOverlay('错误: ' + errorMessage);
        updateFeedback('初始化失败: ' + errorMessage + '。请检查后刷新页面重试。');
        return false;
    }
}

// ==================== 2. 初始化MediaPipe Pose ====================
let pose = null;
let camera = null;

async function initPoseDetection() {
    try {
        updateStatusOverlay('正在加载姿态检测模型...');
        
        // 检查MediaPipe是否已加载
        if (typeof Pose === 'undefined') {
            throw new Error('MediaPipe Pose库未加载，请检查网络连接');
        }
        
        if (typeof Camera === 'undefined') {
            throw new Error('MediaPipe Camera库未加载，请检查网络连接');
        }
        
        pose = new Pose({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
            }
        });
        
        pose.setOptions({
            modelComplexity: 1, // 0=轻量，1=标准，2=高精度
            smoothLandmarks: true,
            enableSegmentation: false,
            smoothSegmentation: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        
        pose.onResults(onPoseResults);
        
        updateStatusOverlay('正在启动姿态检测...');
        
        // 开始从摄像头发送帧到Pose检测器
        camera = new Camera(videoElement, {
            onFrame: async () => {
                if (state.isCameraActive && pose) {
                    await pose.send({ image: videoElement });
                }
            },
            width: 1280,
            height: 720
        });
        
        await camera.start();
        updateStatusOverlay('姿态检测运行中');
        updateFeedback('系统初始化完成！您可以尝试说"我脖子酸"或点击麦克风按钮。');
        
    } catch (err) {
        console.error('姿态检测初始化失败:', err);
        updateStatusOverlay('姿态检测初始化失败');
        updateFeedback('错误: ' + err.message + '。请刷新页面重试。');
    }
}

// ==================== 3. 处理姿态检测结果 ====================
function onPoseResults(results) {
    // 1. 清空画布
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // 2. 绘制摄像头原始画面（作为背景）
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    // 3. 如果检测到姿态，绘制关键点和连接线
    if (results.poseLandmarks) {
        drawLandmarks(canvasCtx, results.poseLandmarks, {
            color: '#FF0000',
            lineWidth: 2,
            radius: 4
        });
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {
            color: '#00FF00',
            lineWidth: 3
        });
    }

    // 4. 姿态/坐姿/引导逻辑全部交给机器人接口核心（无人时也要通知，坐姿计时依赖）
    officeFit.handlePoseResults(results);

    canvasCtx.restore();
}

// 辅助函数：绘制关键点
function drawLandmarks(ctx, landmarks, style) {
    ctx.fillStyle = style.color;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.lineWidth;
    
    for (const landmark of landmarks) {
        const x = landmark.x * canvasElement.width;
        const y = landmark.y * canvasElement.height;
        
        ctx.beginPath();
        ctx.arc(x, y, style.radius, 0, 2 * Math.PI);
        ctx.fill();
    }
}

// 姿态判断、坐姿计时、久坐提醒已迁移至 robot-interface/core.js（OfficeFitCore）

// ==================== 4. 语音识别（Web Speech API） ====================
let recognition = null;

function initSpeechRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false; // 每次点击说一句话
        recognition.interimResults = false;
        recognition.lang = 'zh-CN';
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            console.log('识别结果:', transcript);
            handleVoiceCommand(transcript);
        };
        
        recognition.onerror = (event) => {
            console.error('语音识别错误:', event.error);
            updateFeedback('抱歉，没听清楚，请再说一次。');
        };
        
        toggleMicBtn.disabled = false;
        toggleMicBtn.textContent = '🎤 点击说话';
    } else {
        console.warn('浏览器不支持Web Speech API');
        toggleMicBtn.disabled = true;
        toggleMicBtn.textContent = '🎤 浏览器不支持';
    }
}

function toggleListening() {
    if (!recognition) return;
    
    if (!state.isListening) {
        recognition.start();
        state.isListening = true;
        toggleMicBtn.textContent = '🎤 正在聆听...';
        toggleMicBtn.style.background = 'linear-gradient(90deg, #dc3545, #c82333)';
        updateFeedback('请说出指令...');
    } else {
        recognition.stop();
        state.isListening = false;
        toggleMicBtn.textContent = '🎤 点击说话';
        toggleMicBtn.style.background = '';
    }
}

// ==================== 5. 处理语音指令 ====================
// 意图解析与动作引导已迁移至机器人接口核心，这里只负责把识别文本转成协议观察
function handleVoiceCommand(text) {
    console.log('用户语音:', text);
    officeFit.handleUtterance(text);
}

// ==================== 6. 模式显示 ====================
// 模式控制（开始/暂停/完成引导）已全部由 OfficeFitCore 驱动，这里只负责显示
function updateModeDisplay(mode) {
    const modeTexts = {
        'idle': '待机中',
        'guiding': '引导训练',
        'gaming': '小游戏'
    };
    currentModeEl.textContent = modeTexts[mode] || '待机中';
    currentModeEl.style.color = mode === 'guiding' ? '#28a745' :
                               mode === 'gaming' ? '#17a2b8' : '#6c757d';
    if (mode === 'idle') {
        document.getElementById('exercise_progress').style.width = '0%';
    }
}

// ==================== 7. UI辅助函数 ====================
function updateStatusOverlay(text) {
    statusOverlay.innerHTML = `<span>${text}</span>`;
}

function updateFeedback(text) {
    feedbackEl.innerHTML = `<p>${text}</p>`;
    // 简单模拟语音反馈（实际中可调用Web Speech Synthesis）
    console.log('AI反馈:', text);
}

// ==================== 8. 事件监听器 ====================
startBtn.addEventListener('click', async () => {
    updateFeedback('正在初始化系统...');
    const cameraOk = await initCamera();
    if (cameraOk) {
        await initPoseDetection();
        initSpeechRecognition();
    }
});

stopBtn.addEventListener('click', () => {
    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
    }
    state.isCameraActive = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    updateStatusOverlay('已停止');
    updateFeedback('系统已停止。点击"启动助手"重新开始。');
});

toggleMicBtn.addEventListener('click', toggleListening);

// ==================== 9. 页面加载初始化 ====================
// 注：MediaPipe 的绘图工具（drawing_utils）与 POSE_CONNECTIONS 由 CDN 脚本以全局变量提供，
// 本文件内定义的 drawLandmarks 为本地简化版，无需再挂载到 window
document.addEventListener('DOMContentLoaded', () => {
    updateFeedback('欢迎使用办公放松AI助手！请点击"启动助手"开始。');
});
