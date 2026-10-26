import { describe, expect, it } from 'vitest'
import { hasPrivateUseCharacters, normalizeKnownEquationText } from './pdf-text'

describe('식별된 한글 수식 글꼴의 텍스트', () => {
  it('글꼴이 확인된 경우에만 알려진 제곱근·숫자·덧셈 기호를 읽는다', () => {
    expect(normalizeKnownEquationText('\ue05c\ue039 \ue048 \ue05c\ue036', 'INPILL+HyhwpEQ')).toBe('√6 + √3')
    expect(normalizeKnownEquationText('\ue0fc\ue047\ue03d', 'HyhwpEQ')).toBe('x=0')
  })

  it('임의의 글꼴이나 글꼴 이름 누락에 같은 의미를 부여하지 않는다', () => {
    for (const font of [undefined, 'sans-serif', 'OtherEquationFont', 'HyhwpEQ-Other']) {
      expect(normalizeKnownEquationText('\ue05c\ue048', font)).toBe('\ue05c\ue048')
    }
  })

  it('분수선·근호 윗선·선분 기호로 함께 쓰이는 글자는 연산자로 추측하지 않는다', () => {
    expect(normalizeKnownEquationText('\ue06d\uefff', 'ABCDEF+HyhwpEQ')).toBe('\ue06d\uefff')
    expect(normalizeKnownEquationText('√6 + 원주각', 'HyhwpEQ')).toBe('√6 + 원주각')
    expect(hasPrivateUseCharacters('\ue05c')).toBe(true)
    expect(hasPrivateUseCharacters('√6')).toBe(false)
  })
})
