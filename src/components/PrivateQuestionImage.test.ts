import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PrivateQuestionImage from './PrivateQuestionImage.vue'

let callbacks: IntersectionObserverCallback[]
beforeEach(() => {
  callbacks = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { callbacks.push(callback) }
    observe = vi.fn()
    disconnect = vi.fn()
  })
})
const props = () => ({ path: 'imports/exam/questions/1.webp', alt: '검수한 문제 원문', buttonLabel: '1번 문제 크게 보기', width: 900, height: 1200, loadImage: vi.fn().mockResolvedValue('blob:private-image') })
const visible = (index = 0) => callbacks[index]!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)

describe('화면에 보이는 비공개 문제 이미지', () => {
  it('화면에 가까워지기 전에는 요청하지 않고 보일 때 한 번만 불러온다', async () => {
    const input = props()
    const wrapper = mount(PrivateQuestionImage, { props: input })
    expect(input.loadImage).not.toHaveBeenCalled()
    visible(); await flushPromises()
    visible(); await flushPromises()
    expect(input.loadImage).toHaveBeenCalledExactlyOnceWith(input.path)
    expect(wrapper.get('img').attributes('src')).toBe('blob:private-image')
    await wrapper.get('.exam-image-button').trigger('click')
    expect(wrapper.emitted('image')).toEqual([['blob:private-image']])
    wrapper.unmount()
  })

  it('개별 이미지 오류를 표시하고 목록을 떠나지 않고 다시 시도한다', async () => {
    const input = props(); input.loadImage.mockRejectedValueOnce(new Error('이미지 연결 실패'))
    const wrapper = mount(PrivateQuestionImage, { props: input })
    visible(); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('이미지 연결 실패')
    await wrapper.get('.private-image-retry').trigger('click'); await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('blob:private-image')
    expect(input.loadImage).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('이미 알고 있는 이미지 주소는 다시 요청하지 않는다', async () => {
    const input = { ...props(), src: 'blob:existing-image' }
    const wrapper = mount(PrivateQuestionImage, { props: input })
    expect(wrapper.get('img').attributes('src')).toBe('blob:existing-image')
    expect(input.loadImage).not.toHaveBeenCalled()
    expect(callbacks).toHaveLength(0)
    wrapper.unmount()
  })

  it('이미지가 바뀌면 예전 요청의 늦은 결과를 버린다', async () => {
    const input = props()
    let finish!: (url: string) => void
    input.loadImage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(PrivateQuestionImage, { props: input })
    visible()
    await wrapper.setProps({ src: 'blob:new-image', path: 'imports/new/questions/2.webp' })
    finish('blob:old-image'); await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('blob:new-image')
    wrapper.unmount()
  })

  it('화면 감지 기능이 없는 브라우저도 이미지를 불러올 수 있다', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const input = props()
    const wrapper = mount(PrivateQuestionImage, { props: input })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('blob:private-image')
    wrapper.unmount()
  })
})
