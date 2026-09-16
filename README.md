# TrendFlow

## VS Code에서 시작
1. 이 폴더를 VS Code에서 엽니다.
2. `.env.example`을 복사해 `.env`를 만들고 Supabase URL과 anon key를 입력합니다.
3. 터미널에서 `npm install`
4. `npm run dev`

## Supabase 백엔드
`supabase/functions/analyze-trend/index.ts`가 NAVER News API를 호출합니다.
NAVER Client ID/Secret은 프론트 `.env`가 아니라 Supabase Edge Function Secrets에 저장해야 합니다.

다음 단계에서 Search Trend, CLOVA, Embedding, cosine similarity를 이 함수에 연결합니다.
