// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { generateAiTitles, generateAiMetadata, titleServiceConfiguration, type TitleRequest } from './ai-titles';

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

  it('결제 크레딧 부족은 일시적인 요청량 제한과 구분한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code: 'insufficient_quota', message: 'private details' } }, { status: 429 }));
    await expect(generateAiTitles(input, { apiKey: 'test-key', fetcher }))
      .rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED', status: 429 });
  });
});

describe('AI 제목·태그 분류의 검색 기준과 원문 근거', () => {
  const history: TitleRequest = { subject: '한국사', explanationText: '', questions: [{ clientId: 'history-3', number: 3,
    text: '1987년 6월 민주 항쟁에서 시민들은 대통령 직선제 개헌을 요구하였다. ① 3·1 운동이 일어났다. ② 강화도 조약을 체결하였다.',
    passageText: '', instruction: '', tags: ['근대', '일제강점기'] }] };
  const suggestion = () => ({ clientId: 'history-3', title: '민주화 운동과 대통령 직선제 개헌', tags: ['현대사', '정치사'], reviewNote: '광복 이후 민주화 운동을 묻는 자료입니다.',
    tagEvidence: [{ tag: '현대사', source: 'question', quote: '1987년 6월 민주 항쟁' }, { tag: '정치사', source: 'question', quote: '대통령 직선제 개헌' }] });
  const options = (item: unknown) => ({ provider: 'gemini', apiKey: 'test-key', fetcher: vi.fn().mockResolvedValue(response([item])) });

  it('검색 메뉴와 같은 태그 목록을 보내고 근거가 있는 현대사·정치사만 반환한다', async () => {
    const config = options(suggestion());
    const result = await generateAiMetadata(history, config);
    expect(result[0]!.tags).toEqual(['현대사', '정치사']);
    const body = JSON.parse(config.fetcher.mock.calls[0]![1].body);
    expect(body.response_format.json_schema.schema.properties.titles.items.properties.tags.items.enum)
      .toEqual(['선사·고대', '중세', '근세', '근대', '일제강점기', '현대사', '정치사', '경제사', '사회사', '문화사']);
    expect(body.messages[0].content).toContain('1945년 광복 이후');
  });

  it('오답 선택지에만 있는 근거와 원문에 없는 인용을 태그에서 제외한다', async () => {
    const item = suggestion(); item.tags = ['일제강점기', '근대'];
    item.tagEvidence = [{ tag: '일제강점기', source: 'question', quote: '3·1 운동' }, { tag: '근대', source: 'question', quote: '원문에 없는 개항 이야기' }];
    const [result] = await generateAiMetadata(history, options(item));
    expect(result!.tags).toEqual([]);
    expect(result!.reviewNote).toContain('시대 태그 확인');
  });

  it('동등한 두 시대가 반환되면 시대를 확정하지 않고 주제만 유지한다', async () => {
    const item = suggestion(); item.tags = ['근대', '현대사', '정치사'];
    item.tagEvidence.push({ tag: '근대', source: 'question', quote: '1987년' });
    const [result] = await generateAiMetadata(history, options(item));
    expect(result!.tags).toEqual(['정치사']);
    expect(result!.reviewNote).toContain('시대 태그 확인');
  });

  it('자료가 공통 지문에 있으면 그 원문 근거로 분류한다', async () => {
    const source = { ...history, questions: [{ ...history.questions[0]!, text: '다음 운동의 영향을 고르시오.', passageText: '1987년 6월 민주 항쟁. 대통령 직선제 개헌을 요구하였다.' }] };
    const item = suggestion(); item.tagEvidence.forEach(evidence => { evidence.source = 'passage'; });
    expect((await generateAiMetadata(source, options(item)))[0]!.tags).toEqual(['현대사', '정치사']);
  });

  it('다른 과목의 태그·중복 태그·지나치게 긴 검수 안내는 거절한다', async () => {
    for (const invalid of [{ ...suggestion(), tags: ['기후와 환경'] }, { ...suggestion(), tags: ['현대사', '현대사'] }, { ...suggestion(), reviewNote: '가'.repeat(401) }]) {
      await expect(generateAiMetadata(history, options(invalid))).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    }
  });
});

describe('서버의 Gemini 제목 추천', () => {
  it('Gemini를 명시하면 Gemini 키와 모델만 선택하고 기존 OpenAI 키를 사용하지 않는다', () => {
    const secrets: Record<string, string> = { AI_TITLE_PROVIDER: ' Gemini ', GEMINI_API_KEY: 'gemini-key',
      GEMINI_TITLE_MODEL: 'gemini-custom-model', OPENAI_API_KEY: 'openai-key', OPENAI_TITLE_MODEL: 'openai-model' };
    expect(titleServiceConfiguration(name => secrets[name])).toEqual({ provider: 'gemini', apiKey: 'gemini-key', model: 'gemini-custom-model' });
    delete secrets.GEMINI_API_KEY;
    expect(titleServiceConfiguration(name => secrets[name]).apiKey).toBeUndefined();
    delete secrets.AI_TITLE_PROVIDER;
    expect(titleServiceConfiguration(name => secrets[name])).toEqual({ provider: 'openai', apiKey: 'openai-key', model: 'openai-model' });
  });

  it('Gemini의 구조화된 출력으로 같은 문항·해설을 보내고 검증한 제목만 반환한다', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([{ clientId: 'question-2', title: '기후와 지역별 생활 모습 비교' }]));
    expect(await generateAiTitles(input, { provider: 'gemini', apiKey: 'gemini-key', fetcher }))
      .toEqual([{ clientId: 'question-2', title: '기후와 지역별 생활 모습 비교' }]);
    const [url, options] = fetcher.mock.calls[0]!;
    const body = JSON.parse(options.body);
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer gemini-key');
    expect(body.model).toBe('gemini-3.5-flash-lite');
    expect(body.max_tokens).toBe(2500);
    expect(body.reasoning_effort).toBe('minimal');
    expect(body).not.toHaveProperty('store');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(JSON.parse(body.messages[1].content)).toEqual(input);
    expect(body.messages[0].content).toContain('태그는 이전의 자동 추천으로 오분류될 수 있으므로');
    expect(body.messages[0].content).toContain('선택지에만 등장하는 시대·인물·제도는 제목의 근거로 사용하지 않는다');
    expect(options.body).not.toContain('gemini-key');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('서비스 선택이나 키 설정이 잘못되면 외부 요청 없이 실패한다', async () => {
    const fetcher = vi.fn();
    expect(() => titleServiceConfiguration(() => 'other-service')).toThrow('AI_INVALID_PROVIDER');
    await expect(generateAiTitles(input, { provider: 'other-service', apiKey: 'test-key', fetcher }))
      .rejects.toMatchObject({ code: 'AI_INVALID_PROVIDER' });
    await expect(generateAiTitles(input, { provider: 'gemini', fetcher })).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [400, { error: { details: [{ reason: 'API_KEY_INVALID' }] } }, 'AI_INVALID_KEY'],
    [400, { error: { details: [{ reason: 'API_KEY_EXPIRED' }] } }, 'AI_INVALID_KEY'],
    [403, { error: { status: 'PERMISSION_DENIED' } }, 'AI_ACCESS_DENIED'],
    [404, { error: { status: 'NOT_FOUND' } }, 'AI_MODEL_UNAVAILABLE'],
    [400, { error: { status: 'INVALID_ARGUMENT' } }, 'AI_REQUEST_REJECTED'],
    [429, { error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }, 'AI_QUOTA_EXCEEDED'],
    [429, { error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }] } }, 'AI_RATE_LIMITED'],
  ])('Gemini HTTP %s 오류를 구분하고 다른 서비스로 재시도하지 않는다', async (status, problem, code) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(problem, { status }));
    await expect(generateAiTitles(input, { provider: 'gemini', apiKey: 'gemini-key', fetcher })).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('Gemini가 식별자를 바꾸거나 응답이 잘려도 기존 제목을 교체할 결과로 반환하지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response([{ clientId: 'other', title: '기후와 생활 모습' }]))
      .mockResolvedValueOnce(response([{ clientId: 'question-2', title: '기후와 생활 모습' }], 'length'));
    for (let i = 0; i < 2; i++) {
      await expect(generateAiTitles(input, { provider: 'gemini', apiKey: 'gemini-key', fetcher }))
        .rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    }
  });
});
