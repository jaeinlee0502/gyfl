import { subjectTags } from '../shared/question-tags'
export type Subject = '국어' | '수학' | '영어' | '한국사' | '통합사회' | '통합과학'
export const subjects: { name: Subject; description: string; tags: string[] }[] = [
  { name: '국어', description: '읽고, 생각하고, 표현하는 힘', tags: [...subjectTags['국어']!] },
  { name: '수학', description: '개념을 연결하고 풀이를 발견하는 시간', tags: [...subjectTags['수학']!] },
  { name: '영어', description: '문맥 속에서 발견하는 언어의 감각', tags: [...subjectTags['영어']!] },
  { name: '한국사', description: '시대의 흐름 속에서 오늘을 읽다', tags: [...subjectTags['한국사']!] },
  { name: '통합사회', description: '사람과 사회, 우리가 살아가는 세계', tags: [...subjectTags['통합사회']!] },
  { name: '통합과학', description: '현상을 관찰하고 세상을 이해하는 방법', tags: [...subjectTags['통합과학']!] },
]
export interface ExamPassageImage { imageUrl: string; width: number; height: number; page: number }
export interface ExamPassage { id: string; title: string; text: string; images: ExamPassageImage[] }
export interface Question {
  id: string; subject: Subject; grade: 1 | 2; year: number; month: 3 | 6 | 9 | 10;
  number: number; title: string; tags: string[]; prompt: string;
  passage: string; choices: string[]; answer: number; explanation: string;
  kind: 'demo' | 'exam'; curriculum: '2022' | 'unverified';
  imageUrl?: string; width?: number; height?: number; points?: number;
  sourceUrl?: string; explanationUrl?: string; sourcePage?: number;
  sharedPassage?: ExamPassage;
  instruction?: string;
  responseType?: 'multiple_choice' | 'short_answer';
}
export const questions: Question[] = [
  { id: 'demo-history-1', subject: '한국사', grade: 2, year: 2026, month: 9, number: 1, title: '민주주의의 발전과 시민의 참여', tags: ['현대사', '정치사'], prompt: '다음 자료에 나타난 민주화 운동에 대한 설명으로 가장 적절한 것은?', passage: '1987년 6월, 시민들은 대통령 직선제 개헌을 요구하며 거리로 나섰다. 학생뿐 아니라 회사원과 종교인 등 다양한 사람들이 참여하였고, 이후 대통령 직선제 개헌이 이루어졌다.', choices: ['3·1 운동의 계기가 되었다.', '대한민국 임시 정부가 수립되었다.', '대통령 직선제 개헌으로 이어졌다.', '유신 헌법 제정에 영향을 주었다.', '4·19 혁명의 직접적인 원인이 되었다.'], answer: 3, explanation: '6월 민주 항쟁은 1987년에 전개되었으며, 그 결과 대통령 직선제 개헌이 이루어졌습니다.', kind: 'demo', curriculum: '2022' },
  { id: 'demo-history-2', subject: '한국사', grade: 1, year: 2025, month: 6, number: 2, title: '대한민국 정부 수립의 과정', tags: ['현대사', '정치사'], prompt: '다음 자료의 제헌 국회에 대한 설명으로 옳은 것은?', passage: '1948년 5월 10일 총선거로 구성된 제헌 국회는 헌법을 제정하였다. 제헌 헌법은 대한민국이 민주 공화국임을 명시하였고, 국회는 초대 대통령을 선출하였다.', choices: ['대한 제국의 수립을 선포하였다.', '초대 대통령을 선출하였다.', '독립 협회를 창립하였다.', '홍범 14조를 반포하였다.', '통리기무아문을 설치하였다.'], answer: 2, explanation: '제헌 국회는 1948년 헌법을 제정하고 이승만을 초대 대통령으로 선출하였습니다.', kind: 'demo', curriculum: '2022' },
  { id: 'demo-history-3', subject: '한국사', grade: 2, year: 2026, month: 3, number: 3, title: '개항과 근대 사회로의 전환', tags: ['근대', '경제사'], prompt: '다음 조약에 대한 설명으로 옳은 것은?', passage: '조선은 부산 외에 두 곳의 항구를 열고 일본인의 통상을 허용한다. 개항장에서 일본인이 저지른 범죄는 일본 관리가 재판한다.', choices: ['청과 체결한 조약이다.', '대한민국 정부가 체결하였다.', '일본의 영사 재판권을 인정하였다.', '조선의 관세 자주권을 강화하였다.', '외국과 맺은 최초의 대등한 조약이다.'], answer: 3, explanation: '강화도 조약은 일본의 영사 재판권 등을 인정한 불평등 조약이었습니다.', kind: 'demo', curriculum: '2022' },
  { id: 'demo-korean', subject: '국어', grade: 1, year: 2025, month: 9, number: 1, title: '시적 화자의 정서와 태도', tags: ['현대시'], prompt: '다음 시의 화자가 보이는 태도로 가장 적절한 것은?', passage: '비 그친 창가에 / 작은 잎 하나 빛난다 / 어제의 그늘을 털고 / 나는 다시 문을 연다\n\n— 화면 시연을 위해 창작한 짧은 시', choices: ['지난날에 대한 원망', '현실로부터의 도피', '새로운 시작에 대한 의지', '타인에 대한 비판', '자연에 대한 두려움'], answer: 3, explanation: '“그늘을 털고”, “다시 문을 연다”에서 새로운 시작에 대한 의지를 읽을 수 있습니다.', kind: 'demo', curriculum: '2022' },
  { id: 'demo-math', subject: '수학', grade: 1, year: 2025, month: 6, number: 1, title: '이차방정식의 두 근', tags: ['방정식과 부등식', '다항식'], prompt: '이차방정식 x² − 5x + 6 = 0의 두 근의 합은?', passage: 'x² − 5x + 6 = 0', choices: ['2', '3', '4', '5', '6'], answer: 4, explanation: '근과 계수의 관계에 따라 두 근의 합은 −(−5)/1 = 5입니다.', kind: 'demo', curriculum: '2022' },
  { id: 'demo-english', subject: '영어', grade: 2, year: 2026, month: 6, number: 1, title: '작은 습관이 만드는 변화', tags: ['주제·제목', '요지·주장'], prompt: '다음 글의 주제로 가장 적절한 것은?', passage: 'Learning does not always require a dramatic change. Reading a few pages every day may seem insignificant, but these small actions accumulate. Over time, a steady habit can take you further than a single burst of effort.', choices: ['the value of consistent small efforts', 'the importance of reading quickly', 'the danger of changing routines', 'the benefits of competition', 'the need for instant results'], answer: 1, explanation: '작은 행동의 누적과 꾸준한 습관의 가치를 설명하는 글입니다.', kind: 'demo', curriculum: '2022' },
  { id: 'demo-social', subject: '통합사회', grade: 1, year: 2025, month: 9, number: 1, title: '지속가능한 도시의 선택', tags: ['지리', '기후와 환경', '지속가능발전'], prompt: '도시의 지속가능성을 높이는 정책으로 가장 적절한 것은?', passage: 'A시는 교통 혼잡과 대기 오염을 줄이면서 주민들의 이동권을 보장하는 정책을 검토하고 있다.', choices: ['도심 녹지의 주차장 전환', '대중교통 노선의 축소', '보행 공간의 폐지', '대중교통과 자전거 도로의 연계', '자가용 이용 보조금의 확대'], answer: 4, explanation: '대중교통과 자전거 도로를 연계하면 교통의 접근성을 높이고 환경 부담을 줄일 수 있습니다.', kind: 'demo', curriculum: '2022' },
  { id: 'demo-science', subject: '통합과학', grade: 2, year: 2026, month: 3, number: 1, title: '힘과 운동의 관계', tags: ['물리', '역학 시스템'], prompt: '질량이 일정한 물체에 작용하는 알짜힘을 2배로 할 때, 가속도는 어떻게 되는가?', passage: '마찰과 공기 저항은 무시한다.\n뉴턴의 운동 법칙: F = ma', choices: ['1/4배가 된다.', '1/2배가 된다.', '변하지 않는다.', '2배가 된다.', '4배가 된다.'], answer: 4, explanation: 'F = ma에서 질량 m이 일정하면 가속도 a는 알짜힘 F에 비례합니다.', kind: 'demo', curriculum: '2022' },
]
