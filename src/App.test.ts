import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App.vue'

beforeEach(() => localStorage.clear())

describe('문제 탐색', () => {
  it('한국사 태그와 학년 필터를 함께 적용하고 초기화한다', async () => {
    const wrapper = mount(App)
    expect(wrapper.findAll('.question-card')).toHaveLength(3)
    await wrapper.findAll('.tags button').find(b => b.text().includes('현대사'))!.trigger('click')
    expect(wrapper.findAll('.question-card')).toHaveLength(2)
    await wrapper.get('.select-row select').setValue('1')
    expect(wrapper.findAll('.question-card')).toHaveLength(1)
    expect(wrapper.get('.question-card').text()).toContain('1948년')
    await wrapper.get('.filter-reset').trigger('click')
    expect(wrapper.findAll('.question-card')).toHaveLength(3)
  })
  it('과목 변경 후 검색하고 결과가 없을 때 안내한다', async () => {
    const wrapper = mount(App)
    await wrapper.findAll('.subject-tabs button').find(b => b.text().includes('통합과학'))!.trigger('click')
    await wrapper.get('input').setValue('#물리')
    expect(wrapper.findAll('.question-card')).toHaveLength(1)
    await wrapper.get('input').setValue('없는 검색 결과')
    expect(wrapper.findAll('.question-card')).toHaveLength(0)
    expect(wrapper.get('.empty-state').text()).toContain('조건에 맞는 예시 문제가 없어요')
  })
  it('정답을 펼치고 북마크를 새 화면에도 유지한다', async () => {
    const wrapper = mount(App)
    expect(wrapper.find('.answer-panel').exists()).toBe(false)
    await wrapper.get('.answer-button').trigger('click')
    expect(wrapper.get('.answer-panel').text()).toContain('정답 ③')
    await wrapper.get('.bookmark-button').trigger('click')
    wrapper.unmount()
    const restored = mount(App)
    await restored.get('.saved-filter').trigger('click')
    expect(restored.findAll('.question-card')).toHaveLength(1)
    expect(restored.get('.bookmark-button').attributes('aria-pressed')).toBe('true')
    await restored.get('.bookmark-button').trigger('click')
    expect(restored.findAll('.question-card')).toHaveLength(0)
  })
  it('시행 연도·월을 필터링하고 날짜순을 변경한다', async () => {
    const wrapper = mount(App)
    const selects = wrapper.findAll('.select-row select')
    await selects[1]!.setValue('2026')
    await selects[2]!.setValue('3')
    expect(wrapper.findAll('.question-card')).toHaveLength(1)
    expect(wrapper.get('.question-card').text()).toContain('영사 재판권')
    await wrapper.get('.filter-reset').trigger('click')
    await wrapper.get('.sort-select select').setValue('oldest')
    expect(wrapper.get('.question-card').text()).toContain('1948년')
  })
  it('잘못된 로컬 저장 데이터로도 시작한다', () => {
    localStorage.setItem('gyfl-bookmarks-v1', '{broken')
    expect(mount(App).findAll('.question-card')).toHaveLength(3)
  })
})
