import './styles.css'
import { createApp } from './app.js'
import { createPluginLifecycle } from './app/lifecycle.js'
import * as platform from './platform.js'
import { SAMPLE_JSON } from './sample.js'
import { showToast } from './ui/toast.js'

const lifecycle = createPluginLifecycle({
  createApp: (options) => createApp(document.getElementById('app'), options),
  platform,
  notify: showToast,
})

// 浏览器中调试时没有历史内容，放一份示例数据
if (!platform.isUtools) {
  lifecycle.enter({ type: 'text' }).then(() => {
    if (!lifecycle.app.hasSavedContent) lifecycle.app.setContent(SAMPLE_JSON)
  })
}

platform.onPluginEnter((action) => lifecycle.enter(action))
platform.onPluginDetach(() => lifecycle.detach())

// 文件拖到编辑器以外的区域时也能打开，并阻止 Electron 默认跳转到该文件
document.addEventListener('dragover', (event) => event.preventDefault())
document.addEventListener('drop', (event) => {
  // 编辑器自己处理过的拖放（已 preventDefault）不再重复加载
  const handledByEditor = event.defaultPrevented
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file && !handledByEditor) lifecycle.app?.loadDroppedFile(file)
})

platform.onPluginOut(() => lifecycle.out())
window.addEventListener('beforeunload', () => lifecycle.flushSave())
