# 办公健康AI助手 - 症状意图解析系统

## 系统概述

本系统是基于MediaPipe Pose人体关键点检测的大肢体拉伸动作匹配系统，专门为久坐办公人群提供基于视觉和姿态识别的放松指导。

## 核心功能

### 1. 症状识别与动作匹配

系统能够识别以下6大类身体不适症状：

- **颈部不适**：脖子僵硬、颈椎不舒服等
- **肩部不适**：肩膀酸痛、圆肩难受等
- **上背部不适**：后背僵硬、肩胛骨疼等
- **腰部不适**：腰酸、腰椎不舒服等
- **臀腿不适**：屁股发麻、大腿后侧紧绷等
- **体态不适**：含胸难受、体态驼背等

### 2. 智能匹配规则

#### 单一部位匹配
- 用户描述单一部位不适时，系统推荐该部位的专属动作
- 例如："脖子僵硬" → 推荐 `neck_rotation`（左右转头）、`neck_side_stretch`（颈侧拉伸）

#### 多部位复合匹配
- 用户描述多个部位不适时，系统按"颈肩背腰"优先级组合动作
- 例如："脖子肩膀都酸" → 推荐 `neck_rotation`、`side_raise`等组合动作

#### 全身综合匹配
- 用户描述全身僵硬或超过3个部位不适时，推荐全身综合放松方案
- 例如："坐久了全身僵硬" → 推荐 `neck_rotation`、`side_raise`、`chest_open_back`、`side_waist_stretch`

### 3. 黑名单过滤

以下症状**不支持动作引导**，系统会明确告知用户：

- 手指、手腕、手肘、小臂的疼痛或麻木
- 眼部疲劳、头晕、头痛
- 腹部不适、消化不良
- 脚部、小腿、脚踝问题

## 输出格式

系统返回严格的JSON格式：

```json
{
  "matched": boolean,           // 是否成功匹配
  "intent_tags": array,         // 意图标签，如 ["neck_stiff", "shoulder_sore"]
  "recommended_actions": array, // 推荐的动作ID，如 ["neck_rotation", "side_raise"]
  "exercise_name": string,      // 训练名称，如 "颈部+肩部放松"
  "response_text": string,      // 给用户的自然语言回复
  "reason": string              // 匹配原因或未匹配的原因
}
```

## 使用示例

### 示例1：单一部位匹配

**输入：** "脖子僵硬"

**输出：**
```json
{
  "matched": true,
  "intent_tags": ["neck_stiff", "neck_pain", "neck_tension"],
  "recommended_actions": ["neck_rotation", "neck_side_stretch"],
  "exercise_name": "颈部放松",
  "response_text": "识别到您的颈部放松需求，为您推荐左右转头、颈侧拉伸等动作，帮助缓解不适。",
  "reason": "精确匹配到颈部放松相关症状关键词。"
}
```

### 示例2：多部位复合匹配

**输入：** "脖子肩膀都酸"

**输出：**
```json
{
  "matched": true,
  "intent_tags": ["composite_intent", "neck_stiff", "shoulder_sore"],
  "recommended_actions": ["neck_rotation", "neck_side_stretch", "side_raise", "shoulder_open"],
  "exercise_name": "颈部放松+肩部放松",
  "response_text": "识别到您有颈部放松、肩部放松不适，为您组合定制放松方案，包括左右转头、颈侧拉伸、侧平举、开肩运动等动作。",
  "reason": "匹配到多个部位不适（颈部放松、肩部放松），按优先级组合定制方案。"
}
```

### 示例3：黑名单症状

**输入：** "手指麻"

**输出：**
```json
{
  "matched": false,
  "intent_tags": [],
  "recommended_actions": [],
  "exercise_name": "",
  "response_text": "您描述的症状暂不支持动作引导，建议咨询专业医生。",
  "reason": "黑名单症状：涉及手指、手腕、手肘、小臂、眼部、头部、腹部、脚部、小腿等精细部位或非运动系统问题，无法通过MediaPipe Pose骨架检测进行动作引导。"
}
```

## 动作库说明

系统支持以下17种大肢体拉伸动作：

### 颈部动作（2个）
- `neck_rotation`：左右转头 - 缓解颈部僵硬
- `neck_side_stretch`：颈侧拉伸 - 缓解颈部单侧紧张

### 肩部动作（4个）
- `side_raise`：侧平举 - 缓解肩部酸痛
- `shoulder_open`：开肩运动 - 改善圆肩驼背
- `shrug_relax`：耸肩放松 - 缓解肩部沉重感
- `arm_up_stretch`：手臂上举拉伸 - 舒展肩关节

### 上背部动作（3个）
- `chest_open_back`：开胸展背 - 缓解上背部僵硬
- `side_stretch`：左右侧拉伸 - 舒展背部侧方
- `expand_chest`：扩胸动作 - 改善胸椎活动度

### 腰部动作（3个）
- `side_waist_stretch`：左右侧腰拉伸 - 缓解腰部酸痛
- `trunk_side_bend`：躯干侧弯 - 改善腰部灵活性
- `back_extension`：腰背舒展 - 缓解久坐腰背僵硬

### 臀腿动作（3个）
- `seated_stretch`：坐姿舒展 - 缓解臀部麻木
- `trunk_forward_bend`：躯干前屈 - 拉伸大腿后侧
- `back_stretch`：腰背拉伸 - 整体放松

### 体态动作（2个）
- `shoulder_chest_open`：开肩展胸 - 改善含胸体态
- `full_body_stretch`：全身挺拔拉伸 - 改善整体姿势

## 技术架构

### MediaPipe Pose关键点检测

系统基于MediaPipe Pose的33个人体关键点进行动作检测，主要使用以下关键点：

- **颈部**：关键点0（鼻子）、7、8（耳朵）、11、12（肩膀）
- **肩部**：关键点11、12（肩膀）、13、14（手肘）、15、16（手腕）
- **背部**：关键点11、12（肩膀）、23、24（髋部）
- **腰部**：关键点11、12（肩膀）、23、24（髋部）
- **臀腿**：关键点23、24（髋部）、25、26（膝盖）、27、28（脚踝）

### 角度计算

系统使用向量角度计算来判断动作是否标准：

```javascript
function calculateAngle(a, b, c) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return angle;
}
```

## 集成方式

### Node.js环境

```javascript
const { parseSymptomIntent } = require('./symptomIntentParser.js');

// 解析用户症状
const result = parseSymptomIntent("脖子僵硬");
console.log(result);
```

### 浏览器环境

```html
<script src="symptomIntentParser.js"></script>
<script>
    const result = parseSymptomIntent("脖子僵硬");
    console.log(result);
</script>
```

## 测试

运行测试文件：

```bash
node test_symptomParser.js
```

测试覆盖以下场景：
- 单一部位匹配（6个部位）
- 多部位复合匹配
- 全身综合匹配
- 黑名单症状过滤
- 未识别症状处理

## 注意事项

1. **黑名单症状**：涉及精细部位的症状无法通过骨架检测，需明确告知用户
2. **复合症状**：多部位不适时，系统按"颈肩背腰"优先级组合动作
3. **全身症状**：超过3个部位不适时，推荐全身综合放松方案
4. **关键词匹配**：系统使用中文关键词匹配，确保用户输入为中文

## 版本信息

- 版本：1.0.0
- 作者：honor
- 创建时间：2026-06-15
- 技术栈：JavaScript, MediaPipe Pose

## 许可证

本项目仅供学习和研究使用。
