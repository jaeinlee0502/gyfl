// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { generateAiTitles, type TitleRequest } from './ai-titles';

const input: TitleRequest = { subject: '통합사회', explanationText: '2번 해설: 기후가 주민 생활에 미치는 영향을 비교한다.',
  questions: [{ clientId: 'question-2', number: 2, text: '기온과 두 지역의 생활 모습을 비교하시오.', passageText: '', instruction: '', tags: ['지리'] }] };
const response = (titles: unknown, finish_reason = 'stop') => Response.json({ choices: [{ finish_reason, message: { content: JSON.stringify({ titles }) } }] });

describe('서버의 OpenAI 제목 추천', () => {
  it('키가 없으면 외부 요청 없이 설정 오류를 반환한다', async () => {
    const fetcher = vi.fn();
    await expect(generateAiTitles(input, { fetcher })).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('문제·해설을 구조화된 요청으로 보내고 검증한 제목만 반환한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([{ clientId: 'question-2', title: '기후와 지역별 생활 모습 비교' }]));
    expect(await generateAiTitles(input, { apiKey: 'test-server-key', fetcher })).toEqual([{ clientId: 'question-2', title: '기후와 지역별 생활 모습 비교' }]);
    const [url, options] = fetcher.mock.calls[0]!;
    const body = JSON.parse(options.body);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer test-server-key');
    expect(body.store).toBe(false);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(JSON.parse(body.messages[1].content)).toEqual(input);
    expect(body.messages[0].content).toContain('정체');
    expect(options.body).not.toContain('test-server-key');
  });

  it.each([
    [], [{ clientId: 'other-question', title: '다른 문제의 제목' }],
    [{ clientId: 'question-2', title: '지리의 핵심 개념' }],
    [{ clientId: 'question-2', title: '정답은 ③' }],
    [{ clientId: 'question-2', title: ' ' }],
    [{ clientId: 'question-2', title: '긴 제목'.repeat(40) }],
  ])('누락·다른 식별자·일반 제목·정답 노출을 거절한다 (%j)', async (...titles) => {
    const fetcher = vi.fn().mockResolvedValue(response(titles));
    await expect(generateAiTitles(input, { apiKey: 'test-key', fetcher })).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  it('잘린 응답이나 중복 식별자로 원본 제목을 덮어쓰지 않는다', async () => {
    const title = { clientId: 'question-2', title: '기후와 생활 모습' };
    await expect(generateAiTitles(input, { apiKey: 'test-key', fetcher: vi.fn().mockResolvedValue(response([title], 'length')) }))
      .rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    const second = { ...input, questions: [...input.questions, { ...input.questions[0]!, clientId: 'question-3', number: 3 }] };
    await expect(generateAiTitles(second, { apiKey: 'test-key', fetcher: vi.fn().mockResolvedValue(response([title, title])) }))
      .rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

  it('한도·연결 오류와 시간 초과를 구분하고 제공업체의 내부 오류는 노출하지 않는다', async () => {
    await expect(generateAiTitles(input, { apiKey: 'test-key', fetcher: vi.fn().mockResolvedValue(new Response('private details', { status: 429 })) }))
      .rejects.toMatchObject({ code: 'AI_RATE_LIMITED', status: 429 });
    await expect(generateAiTitles(input, { apiKey: 'test-key', fetcher: vi.fn().mockResolvedValue(new Response('private details', { status: 401 })) }))
      .rejects.toMatchObject({ code: 'AI_INVALID_KEY' });
    await expect(generateAiTitles(input, { apiKey: 'test-key', fetcher: vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')) }))
      .rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });
});
