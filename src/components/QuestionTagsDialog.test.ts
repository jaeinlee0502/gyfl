import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { questions } from '../data'
import { QuestionTagsConflictError } from '../tag-editing'
import QuestionTagsDialog from './QuestionTagsDialog.vue'

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
})
function setup() {
  const saveTags = vi.fn().mockResolvedValue(['현대사', '문화사'])
  const loadTags = vi.fn().mockResolvedValue(['현대사', '경제사'])
  const wrapper = mount(QuestionTagsDialog, { props: { question: { ...questions[0]!, kind: 'exam' }, suggestedTags: ['현대사', '정치사', '문화사'], saveTags, loadTags } })
  return { wrapper, saveTags, loadTags }
}
describe('공유 태그 편집창', () => {
  it('태그 선택·직접 입력을 합쳐 중복 없이 저장하며 취소는 서버를 호출하지 않는다', async () => {
    const { wrapper, saveTags } = setup()
    await wrapper.get('textarea').setValue('#현대사, 문화사\n현대사')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(saveTags).toHaveBeenCalledWith(questions[0]!.id, ['현대사', '정치사'], ['현대사', '문화사'])
    expect(wrapper.emitted('saved')).toHaveLength(1)
    wrapper.unmount()
    const cancelled = setup()
    await cancelled.wrapper.findAll('button').find(b => b.text() === '취소')!.trigger('click')
    expect(cancelled.saveTags).not.toHaveBeenCalled()
    expect(cancelled.wrapper.emitted('close')).toHaveLength(1)
    cancelled.wrapper.unmount()
  })

  it('동시 수정 시 입력을 보존하고 최신 태그로 다시 시작한 뒤 저장한다', async () => {
    const { wrapper, saveTags, loadTags } = setup()
    saveTags.mockRejectedValueOnce(new QuestionTagsConflictError())
    await wrapper.get('textarea').setValue('현대사, 문화사')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('textarea').element).toHaveProperty('value', '현대사, 문화사')
    expect(wrapper.get('[role="alert"]').text()).toContain('다른 선생님')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').find(b => b.text() === '최신 태그 불러오기')!.trigger('click'); await flushPromises()
    expect(loadTags).toHaveBeenCalledWith(questions[0]!.id)
    expect(wrapper.get('textarea').element).toHaveProperty('value', '현대사, 경제사')
    await wrapper.get('textarea').setValue('현대사, 경제사, 문화사')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(saveTags).toHaveBeenLastCalledWith(questions[0]!.id, ['현대사', '경제사'], ['현대사', '경제사', '문화사'])
    wrapper.unmount()
  })

  it('길이 제한과 변경 없는 저장을 막고 빈 목록은 저장할 수 있다', async () => {
    const { wrapper, saveTags } = setup()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('textarea').setValue('가'.repeat(61))
    expect(wrapper.get('[role="alert"]').text()).toContain('60자')
    await wrapper.get('form').trigger('submit')
    expect(saveTags).not.toHaveBeenCalled()
    await wrapper.get('textarea').setValue('')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(saveTags).toHaveBeenCalledWith(questions[0]!.id, ['현대사', '정치사'], [])
    wrapper.unmount()
  })
})
