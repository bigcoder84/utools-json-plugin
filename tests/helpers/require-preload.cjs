// 用真实 CommonJS 加载器执行入口，避免测试环境隐藏项目根目录的 ESM 配置影响。
global.window = { utools: {}, addEventListener() {} }
require(process.argv[2])
process.stdout.write(JSON.stringify(Object.keys(window.services)))
