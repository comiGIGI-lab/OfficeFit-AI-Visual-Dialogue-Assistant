// 办公健康AI助手 - 症状意图解析系统
// 基于MediaPipe Pose人体关键点检测的大肢体拉伸动作匹配

// 症状配置库
const SymptomIntentConfig = {
    // 一、颈部不适
    neck: {
        tags: ['neck_stiff', 'neck_pain', 'neck_tension'],
        keywords: [
            '脖子酸', '脖子疼', '脖子僵硬', '脖子发紧', '脖子不灵活', '脖子酸痛',
            '后颈酸胀', '转头痛', '扭头受限', '脖子拉扯痛', '脖子沉重',
            '颈后发僵', '颈椎不舒服', '久坐脖子难受', '脖子紧绷酸胀'
        ],
        recommendedActions: ['neck_rotation', 'neck_side_stretch'],
        exerciseName: '颈部放松'
    },
    // 二、肩膀不适
    shoulder: {
        tags: ['shoulder_sore', 'shoulder_tight', 'shoulder_droop'],
        keywords: [
            '肩膀酸', '肩膀疼', '肩膀酸痛', '肩膀发紧', '肩膀沉重', '双肩僵硬', '肩膀酸胀',
            '肩紧不舒服', '含胸肩累', '圆肩难受', '肩膀打不开', '肩背沉重',
            '肩膀僵硬抬不动', '久坐肩膀很累', '肩部紧绷酸痛'
        ],
        recommendedActions: ['side_raise', 'shoulder_open', 'shrug_relax', 'arm_up_stretch'],
        exerciseName: '肩部放松'
    },
    // 三、上背部/肩胛骨不适
    upper_back: {
        tags: ['back_upper_sore', 'scapula_tension'],
        keywords: [
            '背酸', '背疼', '后背疼', '后背僵硬', '上背酸痛', '背部发紧', '肩胛骨疼', '后背两侧酸胀',
            '肩胛紧绷', '驼背累背', '胸口闷背', '后背打不开', '久坐后背难受',
            '背部牵拉酸胀', '胸椎僵硬', '后背沉重发酸'
        ],
        recommendedActions: ['chest_open_back', 'side_stretch', 'expand_chest'],
        exerciseName: '上背部舒展'
    },
    // 四、腰部/腰椎不适
    waist: {
        tags: ['waist_sore', 'lumbar_tension', 'low_back_pain'],
        keywords: [
            '腰酸', '腰痛', '腰疼', '腰部酸胀', '腰发僵', '腰椎不舒服', '久坐腰硬',
            '直不起腰', '侧腰紧绷', '一边腰酸痛', '腰部拉扯感', '起身腰疼',
            '久坐腰累', '腰背僵硬', '腰肌紧张', '腰部沉重发酸'
        ],
        recommendedActions: ['side_waist_stretch', 'trunk_side_bend', 'back_extension'],
        exerciseName: '腰部放松'
    },
    // 五、臀部&大腿后侧不适
    hip: {
        tags: ['hip_tight', 'thigh_stiff', 'hip_sore'],
        keywords: [
            '屁股发麻', '屁股疼', '臀部僵硬', '坐久屁股疼', '大腿酸', '大腿后侧紧绷', '大腿拉扯酸胀',
            '臀腿发僵', '下半身沉重', '久坐腿紧', '胯部紧绷', '腹股沟拉扯不适'
        ],
        recommendedActions: ['seated_stretch', 'trunk_forward_bend', 'back_stretch'],
        exerciseName: '臀腿放松'
    },
    // 六、体态&胸腔闭合不适
    posture: {
        tags: ['chest_tight', 'posture_collapse'],
        keywords: [
            '胸闷', '胸口发闷', '胸腔打不开', '含胸难受', '驼背', '体态驼背', '坐不直',
            '上身塌累', '整个人紧绷', '上身僵硬舒展不开'
        ],
        recommendedActions: ['shoulder_chest_open', 'full_body_stretch'],
        exerciseName: '体态矫正'
    },
    // 七、全身综合不适
    full_body: {
        tags: ['full_body_stiff', 'multi_part_sore'],
        keywords: [
            '坐久了全身僵硬', '上半身都很紧', '脖子肩膀腰都酸',
            '后背和腰很不舒服', '肩颈腰背整体紧绷', '整个人坐得很僵硬'
        ],
        recommendedActions: ['neck_rotation', 'side_raise', 'chest_open_back', 'side_waist_stretch'],
        exerciseName: '全身综合放松'
    }
};

// 黑名单关键词 - 不支持的动作
const blacklistKeywords = [
    '手指麻', '手腕疼', '小臂酸', '手肘痛', '眼睛干', '眼疲劳',
    '头晕头痛', '犯困', '腹胀', '消化不良', '浑身乏力', '脚凉',
    '脚底痛', '小腿水肿', '手指疼', '手腕酸', '手掌麻'
];

// 动作库定义
const ExerciseLibrary = {
    // 颈部动作
    neck_rotation: {
        name: '左右转头',
        instruction: '请缓慢将头转向左侧,保持3秒,然后转向右侧',
        checkKeypoints: [0, 7, 8, 11, 12],
        checkLogic: (landmarks) => {
            return { completed: true, feedback: '转头动作完成良好' };
        }
    },
    neck_side_stretch: {
        name: '颈侧拉伸',
        instruction: '将头向左侧倾斜,用左手轻压头部,感受右侧颈部拉伸',
        checkKeypoints: [7, 8, 11, 12],
        checkLogic: (landmarks) => ({ completed: true, feedback: '颈部拉伸到位' })
    },
    // 肩部动作
    side_raise: {
        name: '侧平举',
        instruction: '双臂向身体两侧平举,与肩同高,保持5秒',
        checkKeypoints: [11, 12, 13, 14, 15, 16],
        checkLogic: (landmarks) => {
            const leftShoulder = landmarks[11];
            const leftElbow = landmarks[13];
            const leftWrist = landmarks[15];
            const angle = calculateAngle(leftShoulder, leftElbow, leftWrist);
            if (angle > 160) {
                return { completed: true, feedback: '手臂平举姿势标准' };
            } else {
                return { completed: false, feedback: '请将手臂再抬高一些,与肩平行' };
            }
        }
    },
    shoulder_open: {
        name: '开肩运动',
        instruction: '双手在背后交握,向后拉伸,打开胸腔',
        checkKeypoints: [11, 12, 13, 14, 15, 16],
        checkLogic: (landmarks) => ({ completed: true, feedback: '开肩动作完成' })
    },
    shrug_relax: {
        name: '耸肩放松',
        instruction: '将肩膀向上耸起,保持3秒,然后放松下沉',
        checkKeypoints: [11, 12],
        checkLogic: (landmarks) => ({ completed: true, feedback: '耸肩放松完成' })
    },
    arm_up_stretch: {
        name: '手臂上举拉伸',
        instruction: '双手交叉向上伸展,感受腋下和体侧拉伸',
        checkKeypoints: [11, 12, 13, 14, 15, 16],
        checkLogic: (landmarks) => ({ completed: true, feedback: '手臂上举拉伸完成' })
    },
    // 上背部动作
    chest_open_back: {
        name: '开胸展背',
        instruction: '双手背后交叉,挺胸抬头,感受胸廓打开和背部收缩',
        checkKeypoints: [11, 12, 13, 14, 15, 16],
        checkLogic: (landmarks) => ({ completed: true, feedback: '开胸展背完成' })
    },
    side_stretch: {
        name: '左右侧拉伸',
        instruction: '一手叉腰,另一手举过头顶向对侧弯曲,感受体侧拉伸',
        checkKeypoints: [11, 12, 13, 14, 15, 16, 23, 24],
        checkLogic: (landmarks) => ({ completed: true, feedback: '体侧拉伸完成' })
    },
    expand_chest: {
        name: '扩胸动作',
        instruction: '双臂向两侧打开,做扩胸动作,重复5次',
        checkKeypoints: [11, 12, 13, 14, 15, 16],
        checkLogic: (landmarks) => ({ completed: true, feedback: '扩胸运动完成' })
    },
    // 腰部动作
    side_waist_stretch: {
        name: '左右侧腰拉伸',
        instruction: '双手上举,向左侧弯曲拉伸右侧腰部,保持5秒,换边',
        checkKeypoints: [11, 12, 23, 24],
        checkLogic: (landmarks) => ({ completed: true, feedback: '侧腰拉伸完成' })
    },
    trunk_side_bend: {
        name: '躯干侧弯',
        instruction: '站立或坐姿,身体向一侧弯曲,感受对侧腰部拉伸',
        checkKeypoints: [11, 12, 23, 24],
        checkLogic: (landmarks) => ({ completed: true, feedback: '躯干侧弯完成' })
    },
    back_extension: {
        name: '腰背舒展',
        instruction: '双手叉腰,缓慢向后仰,感受腹部和腰部拉伸',
        checkKeypoints: [11, 12, 23, 24],
        checkLogic: (landmarks) => ({ completed: true, feedback: '后仰伸展完成' })
    },
    // 臀腿动作
    seated_stretch: {
        name: '坐姿舒展',
        instruction: '坐姿,双腿伸直,身体前屈,双手触碰脚尖',
        checkKeypoints: [23, 24, 25, 26, 27, 28],
        checkLogic: (landmarks) => ({ completed: true, feedback: '坐姿前屈完成' })
    },
    trunk_forward_bend: {
        name: '躯干前屈',
        instruction: '站立,双腿分开,身体向前弯曲,双手尽量触地',
        checkKeypoints: [23, 24, 25, 26, 27, 28],
        checkLogic: (landmarks) => ({ completed: true, feedback: '体前屈完成' })
    },
    back_stretch: {
        name: '腰背拉伸',
        instruction: '坐姿,双手抱膝,弓背向后拉伸背部',
        checkKeypoints: [11, 12, 23, 24],
        checkLogic: (landmarks) => ({ completed: true, feedback: '背部拉伸完成' })
    },
    // 体态动作
    shoulder_chest_open: {
        name: '开肩展胸',
        instruction: '双手在背后交握,挺胸抬头,向后拉伸肩膀和胸部',
        checkKeypoints: [11, 12, 13, 14, 15, 16],
        checkLogic: (landmarks) => ({ completed: true, feedback: '肩胸打开完成' })
    },
    full_body_stretch: {
        name: '全身挺拔拉伸',
        instruction: '双手上举,脚尖踮起,全身向上伸展,保持5秒',
        checkKeypoints: [11, 12, 23, 24, 25, 26, 27, 28],
        checkLogic: (landmarks) => ({ completed: true, feedback: '全身伸展完成' })
    }
};

// 角度计算辅助函数
function calculateAngle(a, b, c) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return angle;
}

/**
 * 症状意图解析主函数
 * @param {string} userSpeech - 用户描述的症状
 * @returns {Object} 严格JSON格式的解析结果
 */
function parseSymptomIntent(userSpeech) {
    const text = userSpeech.toLowerCase().trim();
    
    // 1. 黑名单过滤
    for (const blackWord of blacklistKeywords) {
        if (text.includes(blackWord)) {
            return {
                matched: false,
                intent_tags: [],
                recommended_actions: [],
                exercise_name: "",
                response_text: "您描述的症状暂不支持动作引导，建议咨询专业医生。",
                reason: "黑名单症状：涉及手指、手腕、手肘、小臂、眼部、头部、腹部、脚部、小腿等精细部位或非运动系统问题，无法通过MediaPipe Pose骨架检测进行动作引导。"
            };
        }
    }
    
    // 2. 多部位复合意图检测
    let matchedCategories = [];
    
    for (const [category, config] of Object.entries(SymptomIntentConfig)) {
        for (const keyword of config.keywords) {
            if (text.includes(keyword)) {
                matchedCategories.push(category);
                break; // 每个类别匹配一个关键词即可
            }
        }
    }
    
    // 3. 根据匹配结果返回严格JSON格式
    if (matchedCategories.length === 0) {
        // 没有匹配到任何症状关键词
        return {
            matched: false,
            intent_tags: [],
            recommended_actions: [],
            exercise_name: "",
            response_text: "未识别到具体不适部位。您可以具体说'脖子酸'、'肩膀疼'、'腰疼'等，我会为您推荐合适的拉伸动作。",
            reason: "未匹配到任何已知症状关键词，无法确定具体不适部位。"
        };
    } else if (matchedCategories.length === 1) {
        // 单一部位匹配
        const category = matchedCategories[0];
        const config = SymptomIntentConfig[category];
        return {
            matched: true,
            intent_tags: config.tags,
            recommended_actions: config.recommendedActions,
            exercise_name: config.exerciseName,
            response_text: `识别到您的${config.exerciseName}需求，为您推荐${config.recommendedActions.map(actionId => ExerciseLibrary[actionId]?.name || actionId).join('、')}等动作，帮助缓解不适。`,
            reason: `精确匹配到${config.exerciseName}相关症状关键词。`
        };
    } else {
        // 多部位复合匹配
        // 智能选择：如果包含全身性关键词或匹配超过3个部位，使用全身综合放松
        const hasFullBodyKeyword = SymptomIntentConfig.full_body.keywords.some(kw => text.includes(kw));
        if (hasFullBodyKeyword || matchedCategories.length >= 3) {
            const config = SymptomIntentConfig.full_body;
            return {
                matched: true,
                intent_tags: config.tags,
                recommended_actions: config.recommendedActions,
                exercise_name: config.exerciseName,
                response_text: `识别到您有多个部位不适，为您安排${config.exerciseName}，包括${config.recommendedActions.map(actionId => ExerciseLibrary[actionId]?.name || actionId).join('、')}等动作。`,
                reason: "匹配到多个部位不适或全身僵硬症状，推荐全身综合放松方案。"
            };
        } else {
            // 组合匹配到的几个部位（按"颈肩背腰"顺序）
            const priorityOrder = ['neck', 'shoulder', 'upper_back', 'waist', 'hip', 'posture'];
            matchedCategories.sort((a, b) => {
                const indexA = priorityOrder.indexOf(a);
                const indexB = priorityOrder.indexOf(b);
                return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
            });
            
            const combinedActions = [];
            const combinedName = [];
            
            matchedCategories.slice(0, 3).forEach(cat => {
                combinedActions.push(...SymptomIntentConfig[cat].recommendedActions.slice(0, 2));
                combinedName.push(SymptomIntentConfig[cat].exerciseName);
            });
            
            // 去重
            const uniqueActions = [...new Set(combinedActions)];
            
            return {
                matched: true,
                intent_tags: ['composite_intent', ...matchedCategories.slice(0, 3).flatMap(cat => SymptomIntentConfig[cat].tags)],
                recommended_actions: uniqueActions,
                exercise_name: combinedName.join('+'),
                response_text: `识别到您有${combinedName.join('、')}不适，为您组合定制放松方案，包括${uniqueActions.map(actionId => ExerciseLibrary[actionId]?.name || actionId).join('、')}等动作。`,
                reason: `匹配到多个部位不适（${combinedName.join('、')}），按优先级组合定制方案。`
            };
        }
    }
}

// 导出模块（如果需要）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseSymptomIntent,
        SymptomIntentConfig,
        ExerciseLibrary,
        blacklistKeywords,
        calculateAngle
    };
}
// 浏览器环境：脚本级 const 不会自动挂到 window，显式挂载供 robot-interface/core.js 取用
if (typeof window !== 'undefined') {
    window.parseSymptomIntent = parseSymptomIntent;
    window.SymptomIntentConfig = SymptomIntentConfig;
    window.ExerciseLibrary = ExerciseLibrary;
    window.blacklistKeywords = blacklistKeywords;
    window.calculateAngle = calculateAngle;
}
