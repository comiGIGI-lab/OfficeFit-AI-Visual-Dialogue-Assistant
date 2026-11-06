// 测试文件 - 验证症状意图解析系统
// 导入解析模块
const { parseSymptomIntent } = require('./symptomIntentParser.js');

// 测试用例
const testCases = [
    // 单一部位测试
    { input: "脖子僵硬", expected: "neck" },
    { input: "肩膀酸痛", expected: "shoulder" },
    { input: "后背僵硬", expected: "upper_back" },
    { input: "腰酸", expected: "waist" },
    { input: "屁股发麻", expected: "hip" },
    { input: "含胸难受", expected: "posture" },
    
    // 多部位复合测试
    { input: "脖子肩膀都酸", expected: "composite" },
    { input: "脖子肩膀腰都疼", expected: "full_body" },
    { input: "坐久了全身僵硬", expected: "full_body" },
    
    // 黑名单测试
    { input: "手指麻", expected: "blacklist" },
    { input: "手腕疼", expected: "blacklist" },
    { input: "眼睛干", expected: "blacklist" },
    
    // 未匹配测试
    { input: "今天天气不错", expected: "no_match" },
    { input: "我想喝水", expected: "no_match" }
];

// 执行测试
console.log("========== 症状意图解析系统测试结果 ==========\n");

testCases.forEach((testCase, index) => {
    console.log(`测试 ${index + 1}: "${testCase.input}"`);
    const result = parseSymptomIntent(testCase.input);
    console.log(JSON.stringify(result, null, 2));
    console.log("\n" + "=".repeat(50) + "\n");
});

// 详细测试示例
console.log("========== 详细测试示例 ==========\n");

// 示例1: 单一部位 - 颈部
console.log("示例1: 用户说'脖子僵硬'");
const example1 = parseSymptomIntent("脖子僵硬");
console.log(JSON.stringify(example1, null, 2));
console.log("\n");

// 示例2: 多部位复合 - 颈肩
console.log("示例2: 用户说'脖子肩膀都酸'");
const example2 = parseSymptomIntent("脖子肩膀都酸");
console.log(JSON.stringify(example2, null, 2));
console.log("\n");

// 示例3: 全身僵硬
console.log("示例3: 用户说'坐久了全身僵硬'");
const example3 = parseSymptomIntent("坐久了全身僵硬");
console.log(JSON.stringify(example3, null, 2));
console.log("\n");

// 示例4: 黑名单症状
console.log("示例4: 用户说'手指麻'");
const example4 = parseSymptomIntent("手指麻");
console.log(JSON.stringify(example4, null, 2));
console.log("\n");

// 示例5: 未识别症状
console.log("示例5: 用户说'我想喝水'");
const example5 = parseSymptomIntent("我想喝水");
console.log(JSON.stringify(example5, null, 2));
console.log("\n");

console.log("========== 测试完成 ==========");