import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * 构建产物中的 plugin.json 去掉 development 字段：
 * 否则在 uTools 开发模式下加载 dist 时仍会连接本地开发服务器，测不到真正的构建结果。
 * 需要热更新时加载 public/plugin.json。
 */
const productionPluginJson = () => ({
  name: 'production-plugin-json',
  apply: 'build',
  writeBundle(options) {
    const file = resolve(options.dir, 'plugin.json')
    const { development, ...config } = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
  },
})

export default defineConfig({
  plugins: [productionPluginJson()],
  // uTools 通过 file:// 加载插件，资源必须使用相对路径
  base: './',
  build: {
    // uTools 7.x 内核为 Chrome 108
    target: 'chrome108',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  test: {
    include: ['tests/**/*.test.js'],
    coverage: {
      include: ['src/core/**/*.js'],
      reporter: ['text', 'html'],
    },
  },
})
