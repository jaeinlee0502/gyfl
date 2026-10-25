import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QuestionImageDialog from './QuestionImageDialog.vue'

const props = { src: 'blob:private-question', alt: '2025년 고1 3월 한국사 7번 문제 원문', width: 1000, height: 1200 }
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  document.body.style.overflow = ''
})

describe('문제 이미지 크게 보기', () => {
  it('기존 비공개 이미지를 비율에 맞춰 표시하고 확대·축소·화면 맞춤을 지원한다', async () => {
    const wrapper = mount(QuestionImageDialog, { props })
    await flushPromises()
    const image = wrapper.get('.question-image-full')
    expect(image.attributes('src')).toBe(props.src)
    expect(image.attributes('alt')).toBe(props.alt)
    expect(wrapper.get('h2').text()).toBe(props.alt)
    const firstWidth = parseFloat((image.element as HTMLImageElement).style.width)
    const firstHeight = parseFloat((image.element as HTMLImageElement).style.height)
    expect(firstWidth / firstHeight).toBeCloseTo(1000 / 1200)
    expect(firstHeight).toBeLessThanOrEqual(600)
    await wrapper.get('[aria-label="문제 이미지 확대"]').trigger('click')
    await flushPromises()
    expect(parseFloat((image.element as HTMLImageElement).style.width)).toBeGreaterThan(firstWidth)
    await wrapper.get('[aria-label="문제 이미지 축소"]').trigger('click')
    await flushPromises()
    expect(parseFloat((image.element as HTMLImageElement).style.width)).toBeCloseTo(firstWidth)
    await wrapper.get('[aria-label="문제 이미지 확대"]').trigger('click')
    await wrapper.get('.question-image-fit').trigger('click')
    await flushPromises()
    expect(parseFloat((image.element as HTMLImageElement).style.width)).toBeCloseTo(firstWidth)
    wrapper.unmount()
  })

  it.each(['button', 'escape', 'outside'] as const)('%s 방식으로 닫기를 요청한다', async action => {
    const wrapper = mount(QuestionImageDialog, { props })
    await flushPromises()
    if (action === 'button') await wrapper.get('[aria-label="문제 크게 보기 닫기"]').trigger('click')
    if (action === 'escape') await wrapper.get('dialog').trigger('cancel')
    if (action === 'outside') await wrapper.get('dialog').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('일반 이미지 클릭은 닫지 않고 종료 시 스크롤 잠금만 해제한다', async () => {
    const wrapper = mount(QuestionImageDialog, { props })
    await flushPromises()
    expect(document.body.style.overflow).toBe('hidden')
    await wrapper.get('img').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
    expect(document.body.style.overflow).toBe('')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })
})
