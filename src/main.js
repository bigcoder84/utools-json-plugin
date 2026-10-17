import './styles.css'
import { createApp } from './app.js'
import { isDarkMode, isUtools, onPluginEnter, onPluginOut, readTextFile } from './platform.js'
import { SAMPLE_JSON } from './sample.js'
import { showToast } from './ui/toast.js'

function applyTheme() {
  document.documentElement.classList.toggle('dark', isDarkMode())
}

applyTheme()
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme)

const app = createApp(document.getElementById('app'))

// 浏览器中调试时没有历史内容，放一份示例数据
if (!isUtools && !app.hasSavedContent) app.setContent(SAMPLE_JSON)

function openFiles(files) {
  const file = Array.isArray(files) ? files.find((item) => item.isFile && item.path) : null
  if (!file) return
  try {
    app.setContent(readTextFile(file.path), { name: file.name })
    showToast(`已打开 ${file.name}`, 'success')
  } catch (error) {
    showToast(`读取文件失败：${error.message}`, 'error')
  }
}

onPluginEnter(({ type, payload }) => {
  applyTheme()
  if (type === 'files') openFiles(payload)
  else if ((type === 'regex' || type === 'over') && typeof payload === 'string') app.setContent(payload)
  app.focus()
})

// 文件拖到编辑器以外的区域时也能打开，并阻止 Electron 默认跳转到该文件
document.addEventListener('dragover', (event) => event.preventDefault())
document.addEventListener('drop', (event) => {
  // 编辑器自己处理过的拖放（已 preventDefault）不再重复加载
  const handledByEditor = event.defaultPrevented
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file && !handledByEditor) app.loadDroppedFile(file)
})

onPluginOut(() => app.flushSave())
window.addEventListener('beforeunload', () => app.flushSave())
