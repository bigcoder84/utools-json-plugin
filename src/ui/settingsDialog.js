import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../app/settings.js'
import { h } from './dom.js'
import { icon } from './icons.js'

export function createSettingsDialog({ onChange, onReset, onClose }) {
  let settings
  const themes = [
    { value: 'system', label: '跟随系统', icon: 'monitor' },
    { value: 'light', label: '浅色', icon: 'sun' },
    { value: 'dark', label: '深色', icon: 'moon' },
  ].map(({ value, label, icon: iconName }) => h('button', {
    type: 'button',
    className: 'settings-theme',
    dataset: { theme: value },
    onClick: () => onChange('theme', value),
  }, h('span', { className: 'icon', html: icon(iconName, 20) }), label))

  const fontSize = h('input', {
    id: 'settings-font-size',
    className: 'settings-font-size__input',
    type: 'number',
    min: MIN_FONT_SIZE,
    max: MAX_FONT_SIZE,
    step: 1,
    'aria-label': '编辑器字号',
    onInput: () => {
      if (fontSize.validity.valid && fontSize.value !== '') onChange('fontSize', fontSize.valueAsNumber)
    },
    onBlur: () => { fontSize.value = String(settings.fontSize) },
  })
  const decrease = h('button', {
    type: 'button', className: 'settings-step', 'aria-label': '减小字号',
    onClick: () => onChange('fontSize', settings.fontSize - 1),
  }, '−')
  const increase = h('button', {
    type: 'button', className: 'settings-step', 'aria-label': '增大字号',
    onClick: () => onChange('fontSize', settings.fontSize + 1),
  }, '+')
  const indent = h('select', {
    id: 'settings-indent', className: 'settings-select',
    onChange: () => onChange('indent', Number(indent.value)),
  }, h('option', { value: 2 }, '2 空格'), h('option', { value: 4 }, '4 空格'))
  const wrap = h('input', {
    type: 'checkbox', role: 'switch', className: 'settings-switch',
    onChange: () => onChange('wrap', wrap.checked),
  })
  const images = h('input', {
    type: 'checkbox', role: 'switch', className: 'settings-switch',
    onChange: () => onChange('imagePanelOpen', images.checked),
  })

  const root = h('dialog', {
    id: 'settings-dialog',
    className: 'settings-dialog',
    'aria-labelledby': 'settings-title',
    'aria-describedby': 'settings-description',
    onClose,
    onClick: (event) => {
      // 原生 dialog 的 backdrop 点击也以 dialog 为 target，避免把内容留白当作遮罩。
      if (event.target !== root) return
      const rect = root.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) root.close()
    },
  },
  h('header', { className: 'settings-dialog__header' },
    h('div', {},
      h('h2', { id: 'settings-title' }, '设置'),
      h('p', { id: 'settings-description' }, '修改立即生效，并自动保存'),
    ),
    h('button', {
      type: 'button', className: 'icon-btn', 'aria-label': '关闭设置', onClick: () => root.close(),
    }, h('span', { className: 'icon', html: icon('close') })),
  ),
  h('div', { className: 'settings-dialog__body' },
    h('section', { className: 'settings-section', 'aria-labelledby': 'settings-appearance' },
      h('h3', { id: 'settings-appearance' }, '外观'),
      h('div', { className: 'settings-themes', role: 'group', 'aria-label': '主题' }, themes),
      h('div', { className: 'settings-row' },
        h('label', { for: 'settings-font-size' }, '编辑器字号', h('small', {}, `${MIN_FONT_SIZE}–${MAX_FONT_SIZE} px`)),
        h('div', { className: 'settings-font-size' }, decrease, fontSize, increase),
      ),
    ),
    h('section', { className: 'settings-section', 'aria-labelledby': 'settings-editor' },
      h('h3', { id: 'settings-editor' }, '编辑器'),
      h('div', { className: 'settings-row' }, h('label', { for: 'settings-indent' }, '缩进'), indent),
      h('label', { className: 'settings-row settings-row--toggle' },
        h('span', {}, '自动换行', h('small', {}, '长行按编辑区宽度换行')), wrap,
      ),
      h('label', { className: 'settings-row settings-row--toggle' },
        h('span', {}, '图片面板', h('small', {}, '在右侧显示提取的图片')), images,
      ),
    ),
  ),
  h('footer', { className: 'settings-dialog__footer' },
    h('button', { type: 'button', className: 'settings-reset', onClick: onReset }, '恢复默认'),
    h('button', { type: 'button', className: 'settings-done', onClick: () => root.close() }, '完成'),
  ))

  return {
    root,
    open() { if (!root.open) root.showModal() },
    render(next) {
      settings = next
      for (const button of themes) button.setAttribute('aria-pressed', String(button.dataset.theme === next.theme))
      // 输入过程中保留光标和临时值，离开输入框时再校正。
      if (document.activeElement !== fontSize) fontSize.value = String(next.fontSize)
      decrease.disabled = next.fontSize <= MIN_FONT_SIZE
      increase.disabled = next.fontSize >= MAX_FONT_SIZE
      indent.value = String(next.indent)
      wrap.checked = next.wrap
      images.checked = next.imagePanelOpen
    },
  }
}
