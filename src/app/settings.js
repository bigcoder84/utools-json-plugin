export const MIN_FONT_SIZE = 10
export const MAX_FONT_SIZE = 24

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  fontSize: 14,
  indent: 2,
  wrap: false,
  imagePanelOpen: true,
})

/** 旧版本的偏好和异常的存储值都回退到可用的设置。 */
export function normalizeSettings(value = {}) {
  return {
    theme: ['system', 'light', 'dark'].includes(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    fontSize: Number.isInteger(value.fontSize) && value.fontSize >= MIN_FONT_SIZE && value.fontSize <= MAX_FONT_SIZE
      ? value.fontSize : DEFAULT_SETTINGS.fontSize,
    indent: value.indent === 4 ? 4 : DEFAULT_SETTINGS.indent,
    wrap: value.wrap === true,
    imagePanelOpen: value.imagePanelOpen !== false,
  }
}
