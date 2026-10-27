export class QuestionTagsConflictError extends Error {
  constructor() { super('다른 선생님이 먼저 태그를 수정했어요. 최신 태그를 불러온 뒤 다시 수정해 주세요.') }
}

export function normalizeQuestionTags(tags: string[]) {
  if (!Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== 'string')) {
    throw new Error('태그는 최대 20개까지 입력해 주세요.')
  }
  const cleaned = [...new Set(tags.map(tag => tag.trim().replace(/\s+/g, ' ')))]
  if (cleaned.some(tag => !tag || tag.length > 60)) throw new Error('각 태그는 1~60자로 입력해 주세요.')
  return cleaned
}

export function parseQuestionTags(value: string) {
  return normalizeQuestionTags(value.split(/[,，#\n]+/u).map(tag => tag.trim()).filter(Boolean))
}
