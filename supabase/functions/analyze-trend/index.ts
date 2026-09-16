// @ts-nocheck

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const NAVER_NEWS_URL =
  "https://naverapihub.apigw.ntruss.com/search/v1/news";

const NAVER_TREND_URL =
  "https://naverapihub.apigw.ntruss.com/search-trend/v1/search";

const CLOVA_CHAT_URL =
  "https://clovastudio.stream.ntruss.com/v3/chat-completions/HCX-005";

const CLOVA_EMBEDDING_URL =
  "https://clovastudio.stream.ntruss.com/v1/api-tools/embedding/v2";


/* =========================================================
   Utilities
========================================================= */

function cleanHtml(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}


function formatDate(date) {
  return date.toISOString().slice(0, 10);
}


function average(values) {
  if (!values.length) {
    return 0;
  }

  return (
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length
  );
}


function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
  );
}


function round(value, digits = 3) {
  const factor = 10 ** digits;

  return (
    Math.round(value * factor) /
    factor
  );
}


/* =========================================================
   Cosine Similarity
========================================================= */

function cosineSimilarity(a, b) {
  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    a.length === 0 ||
    b.length === 0 ||
    a.length !== b.length
  ) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];

    normA +=
      a[i] * a[i];

    normB +=
      b[i] * b[i];
  }

  if (
    normA === 0 ||
    normB === 0
  ) {
    return 0;
  }

  return (
    dot /
    (
      Math.sqrt(normA) *
      Math.sqrt(normB)
    )
  );
}


/* =========================================================
   HyperCLOVA JSON Parser
========================================================= */

function extractJson(text) {
  const cleaned = String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start =
    cleaned.indexOf("{");

  const end =
    cleaned.lastIndexOf("}");

  if (
    start === -1 ||
    end === -1
  ) {
    throw new Error(
      "HyperCLOVA 응답에서 JSON을 찾지 못했습니다."
    );
  }

  return JSON.parse(
    cleaned.slice(
      start,
      end + 1
    )
  );
}


function getClovaText(data) {
  const content =
    data?.result?.message?.content;

  if (
    typeof content === "string"
  ) {
    return content;
  }

  if (
    Array.isArray(content)
  ) {
    return content
      .map((item) => {
        if (
          typeof item === "string"
        ) {
          return item;
        }

        return (
          item?.text ??
          item?.content ??
          ""
        );
      })
      .join("");
  }

  return "";
}


/* =========================================================
   CLOVA Embedding
========================================================= */

async function createEmbedding(
  text,
  clovaApiKey
) {
  const response =
    await fetch(
      CLOVA_EMBEDDING_URL,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${clovaApiKey}`,

          "X-NCP-CLOVASTUDIO-REQUEST-ID":
            crypto.randomUUID(),

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          text,
        }),
      }
    );

  const raw =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Embedding API ${response.status}: ${raw}`
    );
  }

  const data =
    JSON.parse(raw);

  const embedding =
    data?.result?.embedding;

  if (
    !Array.isArray(embedding)
  ) {
    throw new Error(
      "Embedding 결과를 받지 못했습니다."
    );
  }

  return embedding;
}


/* =========================================================
   Edge Function
========================================================= */

Deno.serve(async (req) => {

  if (
    req.method === "OPTIONS"
  ) {
    return new Response(
      "ok",
      {
        headers: corsHeaders,
      }
    );
  }


  try {

    /* -----------------------------------------------------
       Request
    ----------------------------------------------------- */

    const body =
      await req.json();

    const query =
      String(
        body?.query ?? ""
      ).trim();

    if (!query) {
      return Response.json(
        {
          ok: false,
          error:
            "검색어를 입력해 주세요.",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }


    /* -----------------------------------------------------
       Secrets
    ----------------------------------------------------- */

    const clientId =
      Deno.env.get(
        "NAVER_CLIENT_ID"
      );

    const clientSecret =
      Deno.env.get(
        "NAVER_CLIENT_SECRET"
      );

    const clovaApiKey =
      Deno.env.get(
        "CLOVA_API_KEY"
      );


    if (
      !clientId ||
      !clientSecret
    ) {
      throw new Error(
        "NAVER API 키가 없습니다."
      );
    }


    if (!clovaApiKey) {
      throw new Error(
        "CLOVA API 키가 없습니다."
      );
    }


    /* =====================================================
       STEP 1.
       NAVER News Search
    ===================================================== */

    const newsUrl =
      new URL(
        NAVER_NEWS_URL
      );

    newsUrl.searchParams.set(
      "query",
      query
    );

    newsUrl.searchParams.set(
      "display",
      "20"
    );

    newsUrl.searchParams.set(
      "start",
      "1"
    );

    newsUrl.searchParams.set(
      "sort",
      "date"
    );

    newsUrl.searchParams.set(
      "format",
      "json"
    );


    const newsResponse =
      await fetch(
        newsUrl,
        {
          headers: {
            "X-NCP-APIGW-API-KEY-ID":
              clientId,

            "X-NCP-APIGW-API-KEY":
              clientSecret,
          },
        }
      );


    const newsRaw =
      await newsResponse.text();


    if (
      !newsResponse.ok
    ) {
      throw new Error(
        `NAVER News API ${newsResponse.status}: ${newsRaw}`
      );
    }


    const newsData =
      JSON.parse(newsRaw);


    const articles =
      (
        newsData.items ?? []
      ).map(
        (
          article,
          index
        ) => ({
          id: index + 1,

          title:
            cleanHtml(
              article.title
            ),

          description:
            cleanHtml(
              article.description
            ),

          link:
            article.link,

          originallink:
            article.originallink,

          pubDate:
            article.pubDate,
        })
      );


    if (
      articles.length === 0
    ) {
      return Response.json(
        {
          ok: true,
          query,
          articles: [],
          interests: [],
        },
        {
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    }


    /* =====================================================
       STEP 2.
       기사 → HyperCLOVA 입력 데이터
    ===================================================== */

    const articleText =
      articles
        .map(
          (article) => `
[기사 ${article.id}]

제목:
${article.title}

내용:
${article.description}
`
        )
        .join("\n");


    /* =====================================================
       STEP 3.
       HyperCLOVA
       Long-tail Interest Extraction
    ===================================================== */

    const systemPrompt = `
당신은 뉴스 데이터를 기반으로
새로운 관심사 신호를 탐색하는
콘텐츠 리서치 분석가입니다.

사용자가 입력한 큰 주제와
최근 관련 기사들을 분석해
향후 독립적인 관심사나 콘텐츠 주제로
발전할 가능성이 있는
롱테일 관심사 후보를 찾아주세요.

단순한 기사 요약이 목적이 아닙니다.

아래 기준을 반드시 따르세요.

1.
입력 주제 자체는 후보에서 제외합니다.

2.
너무 넓고 일반적인 단어를
후보로 선택하지 않습니다.

3.
단순 회사명이나 인물명만
후보로 선택하지 않습니다.

4.
실제 기사에서 반복적으로 나타나거나
의미 있는 맥락을 가진 주제를 찾습니다.

5.
각 관심사마다
실제로 사람들이 NAVER에서 검색할 법한
검색어 변형을 3~5개 생성합니다.

6.
검색어 변형은 지나치게 긴 문장이 아니라
실제 검색창에 입력할 법한 표현이어야 합니다.

7.
근거가 된 기사 번호를
articleIds에 입력합니다.

8.
정확히 5개의 후보만 반환합니다.

9.
반드시 JSON만 반환합니다.

형식:

{
  "interests": [
    {
      "keyword": "대표 관심사",
      "searchKeywords": [
        "검색어 1",
        "검색어 2",
        "검색어 3"
      ],
      "reason": "왜 관심사 후보로 선정했는지",
      "articleIds": [1, 4, 7]
    }
  ]
}
`;


    const clovaResponse =
      await fetch(
        CLOVA_CHAT_URL,
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${clovaApiKey}`,

            "X-NCP-CLOVASTUDIO-REQUEST-ID":
              crypto.randomUUID(),

            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            messages: [
              {
                role: "system",
                content:
                  systemPrompt,
              },

              {
                role: "user",

                content: `
분석 주제:

${query}


최근 관련 기사:

${articleText}


위 기사들을 기반으로
검색 트렌드를 추가 검증할 가치가 있는
롱테일 관심사 5개를 추출하세요.
`,
              },
            ],

            topP: 0.8,
            topK: 0,

            maxTokens: 1600,

            temperature: 0.2,

            repetitionPenalty:
              1.1,
          }),
        }
      );


    const clovaRaw =
      await clovaResponse.text();


    if (
      !clovaResponse.ok
    ) {
      throw new Error(
        `CLOVA API ${clovaResponse.status}: ${clovaRaw}`
      );
    }


    const clovaData =
      JSON.parse(clovaRaw);


    const generatedText =
      getClovaText(
        clovaData
      );


    if (!generatedText) {
      throw new Error(
        "HyperCLOVA 응답이 비어 있습니다."
      );
    }


    const parsed =
      extractJson(
        generatedText
      );


    let interests =
      (
        parsed.interests ?? []
      )
        .filter(
          (item) =>
            item?.keyword
        )
        .slice(0, 5);


    if (
      interests.length === 0
    ) {
      throw new Error(
        "관심사 후보를 생성하지 못했습니다."
      );
    }


    /* =====================================================
       STEP 4.
       검색어 그룹 정리
    ===================================================== */

    interests =
      interests.map(
        (interest) => {

          let searchKeywords =
            Array.isArray(
              interest.searchKeywords
            )
              ? interest.searchKeywords
              : [];


          searchKeywords = [
            interest.keyword,
            ...searchKeywords,
          ]
            .map(
              (keyword) =>
                String(keyword).trim()
            )
            .filter(Boolean);


          searchKeywords =
            [
              ...new Set(
                searchKeywords
              ),
            ].slice(
              0,
              10
            );


          return {
            ...interest,

            searchKeywords,

            articleIds:
              Array.isArray(
                interest.articleIds
              )
                ? interest.articleIds
                : [],
          };
        }
      );


    /* =====================================================
       STEP 5.
       NAVER Search Trend
       최근 12주
    ===================================================== */

    const endDate =
      new Date();

    const startDate =
      new Date();

    startDate.setDate(
      endDate.getDate() - 84
    );


    const trendBody = {
      startDate:
        formatDate(startDate),

      endDate:
        formatDate(endDate),

      timeUnit:
        "week",

      keywordGroups:
        interests.map(
          (interest) => ({
            groupName:
              interest.keyword,

            keywords:
              interest.searchKeywords,
          })
        ),
    };


    const trendResponse =
      await fetch(
        NAVER_TREND_URL,
        {
          method: "POST",

          headers: {
            "X-NCP-APIGW-API-KEY-ID":
              clientId,

            "X-NCP-APIGW-API-KEY":
              clientSecret,

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify(
              trendBody
            ),
        }
      );


    const trendRaw =
      await trendResponse.text();


    if (
      !trendResponse.ok
    ) {
      throw new Error(
        `Search Trend API ${trendResponse.status}: ${trendRaw}`
      );
    }


    const trendData =
      JSON.parse(trendRaw);


    /* =====================================================
       STEP 6.
       Trend Momentum
    ===================================================== */

    interests =
      interests.map(
        (interest) => {

          const trendResult =
            trendData.results?.find(
              (item) =>
                item.title ===
                interest.keyword
            );


          const points =
            trendResult?.data ??
            [];


          const ratios =
            points.map(
              (point) =>
                Number(
                  point.ratio
                )
            );


          const middle =
            Math.max(
              1,
              Math.floor(
                ratios.length / 2
              )
            );


          const previous =
            ratios.slice(
              0,
              middle
            );


          const recent =
            ratios.slice(
              middle
            );


          const previousAverage =
            average(previous);


          const recentAverage =
            average(recent);


          const change =
            recentAverage -
            previousAverage;


          return {
            ...interest,

            articleCount:
              interest.articleIds.length,

            trend: {
              change:
                round(
                  change,
                  1
                ),

              previousAverage:
                round(
                  previousAverage,
                  1
                ),

              recentAverage:
                round(
                  recentAverage,
                  1
                ),

              data: points,
            },
          };
        }
      );


    /* =====================================================
       STEP 7.
       CLOVA Embedding
       원 주제 Vector
    ===================================================== */

    const queryEmbedding =
      await createEmbedding(
        query,
        clovaApiKey
      );


    /* =====================================================
       STEP 8.
       관심사 ↔ 기사 의미 검증
    ===================================================== */

    const semanticInterests =
      [];


    for (
      const interest of interests
    ) {

      const candidateText = `
${interest.keyword}

${interest.reason ?? ""}
`.trim();


      const evidenceArticles =
        interest.articleIds
          .map(
            (id) =>
              articles.find(
                (article) =>
                  article.id === id
              )
          )
          .filter(Boolean)
          .slice(0, 5);


      const evidenceText =
        evidenceArticles.length
          ? evidenceArticles
              .map(
                (article) => `
${article.title}

${article.description}
`
              )
              .join("\n")
          : articles
              .slice(0, 3)
              .map(
                (article) => `
${article.title}

${article.description}
`
              )
              .join("\n");


      /*
       * 후보 관심사 vector
       */
      const candidateEmbedding =
        await createEmbedding(
          candidateText,
          clovaApiKey
        );


      /*
       * 근거 기사 vector
       */
      const evidenceEmbedding =
        await createEmbedding(
          evidenceText,
          clovaApiKey
        );


      /*
       * 원래 검색 주제 ↔ 후보 관심사
       */
      const topicSimilarity =
        cosineSimilarity(
          queryEmbedding,
          candidateEmbedding
        );


      /*
       * 후보 관심사 ↔ 실제 근거 기사
       */
      const evidenceSimilarity =
        cosineSimilarity(
          candidateEmbedding,
          evidenceEmbedding
        );


      /*
       * 의미 검증 점수
       *
       * 기사와의 연관성에 조금 더 높은 가중치
       */
      const semanticScore =
        (
          topicSimilarity *
            0.4
        ) +
        (
          evidenceSimilarity *
            0.6
        );


      semanticInterests.push({
        ...interest,

        semantic: {
          topicSimilarity:
            round(
              topicSimilarity,
              3
            ),

          evidenceSimilarity:
            round(
              evidenceSimilarity,
              3
            ),

          score:
            round(
              semanticScore,
              3
            ),
        },
      });
    }


    /* =====================================================
       STEP 9.
       Trend 정규화
    ===================================================== */

    const positiveChanges =
      semanticInterests.map(
        (interest) =>
          Math.max(
            0,
            interest.trend.change
          )
      );


    const maxTrendChange =
      Math.max(
        ...positiveChanges,
        1
      );


    /* =====================================================
       STEP 10.
       최종 Interest Signal Score

       semantic 55%
       trend    30%
       evidence 15%

       프로젝트 내부 휴리스틱
    ===================================================== */

    const finalInterests =
      semanticInterests.map(
        (interest) => {

          const semanticScore =
            clamp(
              interest.semantic.score,
              0,
              1
            );


          const trendScore =
            clamp(
              Math.max(
                0,
                interest.trend.change
              ) /
                maxTrendChange,

              0,
              1
            );


          const evidenceScore =
            clamp(
              interest.articleCount /
                5,

              0,
              1
            );


          const signalScore =
            (
              semanticScore *
                0.55
            ) +
            (
              trendScore *
                0.30
            ) +
            (
              evidenceScore *
                0.15
            );


          return {
            ...interest,

            signal: {
              score:
                Math.round(
                  signalScore *
                    100
                ),

              semanticComponent:
                Math.round(
                  semanticScore *
                    100
                ),

              trendComponent:
                Math.round(
                  trendScore *
                    100
                ),

              evidenceComponent:
                Math.round(
                  evidenceScore *
                    100
                ),
            },
          };
        }
      );


    /* =====================================================
       STEP 11.
       Signal Score 순 정렬
    ===================================================== */

    finalInterests.sort(
      (a, b) =>
        b.signal.score -
        a.signal.score
    );


    /* =====================================================
       STEP 12.
       Response
    ===================================================== */

    return Response.json(
      {
        ok: true,

        query,

        total:
          newsData.total ?? 0,

        articles,

        interests:
          finalInterests,

        pipeline: {
          news:
            true,

          interestExtraction:
            true,

          trendValidation:
            true,

          semanticValidation:
            true,
        },

        methodology: {
          signalScore:
            "semantic 55% + trend momentum 30% + evidence 15%",

          semanticScore:
            "topic similarity 40% + evidence similarity 60%",
        },
      },

      {
        headers: {
          ...corsHeaders,

          "Content-Type":
            "application/json",
        },
      }
    );


  } catch (error) {

    console.error(error);


    return Response.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : String(error),
      },

      {
        status: 500,

        headers: {
          ...corsHeaders,

          "Content-Type":
            "application/json",
        },
      }
    );
  }
});