import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function normalizeEnvValue(
  value: unknown,
  variableName: string
) {
  let normalized = String(value ?? "");

  /*
   * Vercel에 실수로
   * VITE_SUPABASE_...=값
   * 전체를 붙여 넣은 경우도 자동 보정
   */
  const prefix = `${variableName}=`;

  normalized = normalized.trim();

  if (normalized.startsWith(prefix)) {
    normalized = normalized.slice(prefix.length);
  }

  /*
   * 앞뒤 따옴표 제거
   */
  if (
    (normalized.startsWith('"') &&
      normalized.endsWith('"')) ||
    (normalized.startsWith("'") &&
      normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }

  /*
   * HTTP Header에서 허용되지 않는
   * 줄바꿈 / 탭 / 제어문자 제거
   *
   * production에서 발생한
   * "Failed to execute 'fetch' ... Invalid value"
   * 방지용
   */
  normalized = normalized
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .trim();

  return normalized;
}

const supabaseUrl = normalizeEnvValue(
  import.meta.env.VITE_SUPABASE_URL,
  "VITE_SUPABASE_URL"
).replace(/\/+$/, "");

const supabaseKey = normalizeEnvValue(
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  "VITE_SUPABASE_ANON_KEY"
);

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Supabase 환경변수가 없습니다. VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY를 확인하세요."
  );
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
  throw new Error(
    "VITE_SUPABASE_URL 형식이 올바르지 않습니다."
  );
}

/*
 * 키 내용 자체는 노출하지 않고
 * 브라우저 fetch가 받을 수 없는 문자가 남아 있는지만 확인
 */
if (/[^\x20-\x7E]/.test(supabaseKey)) {
  throw new Error(
    "VITE_SUPABASE_ANON_KEY에 사용할 수 없는 문자가 포함되어 있습니다."
  );
}

type Article = {
  id?: number;
  title: string;
  description?: string;
  link?: string;
  originallink?: string;
  pubDate?: string;
};

type TrendPoint = {
  period: string;
  ratio: number;
};

type Interest = {
  keyword: string;
  reason: string;

  searchKeywords?: string[];

  articleIds?: number[];
  articleCount?: number;

  trend?: {
    change?: number;
    previousAverage?: number;
    recentAverage?: number;
    data?: TrendPoint[];
  };

  semantic?: {
    topicSimilarity?: number;
    evidenceSimilarity?: number;
    score?: number;
  };

  signal?: {
    score?: number;
    semanticComponent?: number;
    trendComponent?: number;
    evidenceComponent?: number;
  };
};

type AnalyzeResponse = {
  ok: boolean;
  query?: string;
  total?: number;
  articles?: Article[];
  interests?: Interest[];
  error?: string;
};

function cleanText(text?: string) {
  if (!text) return "";

  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

function formatDate(date?: string) {
  if (!date) return "";

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function similarityPercent(value?: number) {
  return Math.round((value ?? 0) * 100);
}
function getArticleUrl(article: Article) {
  return article.originallink || article.link || "";
}

function getArticleHost(article: Article) {
  const url = getArticleUrl(article);

  if (!url) return "기사 출처";

  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "기사 출처";
  }
}

function App() {
  const [query, setQuery] = useState("생성형 AI");
  const [searchedQuery, setSearchedQuery] = useState("");

  const [loading, setLoading] = useState(false);

  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] =
    useState("분석 준비 중...");

  const [articles, setArticles] = useState<Article[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [error, setError] = useState("");

  /*
   * 진행률에 따라 현재 Workflow Step 결정
   */
  const currentStep =
    !loading && searchedQuery
      ? 4
      : progress < 15
        ? 0
        : progress < 38
          ? 1
          : progress < 62
            ? 2
            : progress < 80
              ? 3
              : 4;

  const flowSteps = [
    "주제 입력",
    "기사 수집",
    "관심사 추출",
    "트렌드 검증",
    "의미 검증",
  ];

  async function analyze() {
    const keyword = query.trim();

    if (!keyword || loading) {
      return;
    }

    setLoading(true);

    setError("");
    setArticles([]);
    setInterests([]);
    setSearchedQuery("");

    setProgress(2);
    setProgressLabel("분석 준비 중...");

    /*
     * React가 초기 2% 상태를 먼저 보여주도록
     * 아주 잠깐 기다림
     */
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 80);
    });

    const startedAt = Date.now();

    /*
     * 서버가 완료되기 전까지
     * 최대 92%까지만 올라가는 UX Progress
     */
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;

      let nextProgress = 2;

      if (elapsed < 700) {
        // 2 → 15
        nextProgress =
          2 + (elapsed / 700) * 13;
      } else if (elapsed < 1800) {
        // 15 → 38
        nextProgress =
          15 +
          ((elapsed - 700) / 1100) * 23;
      } else if (elapsed < 3200) {
        // 38 → 62
        nextProgress =
          38 +
          ((elapsed - 1800) / 1400) * 24;
      } else if (elapsed < 5000) {
        // 62 → 80
        nextProgress =
          62 +
          ((elapsed - 3200) / 1800) * 18;
      } else if (elapsed < 8000) {
        // 80 → 92
        nextProgress =
          80 +
          ((elapsed - 5000) / 3000) * 12;
      } else {
        nextProgress = 92;
      }

      const safeProgress = Math.min(
        92,
        nextProgress
      );

      setProgress(safeProgress);

      if (safeProgress < 15) {
        setProgressLabel("분석 준비 중...");
      } else if (safeProgress < 38) {
        setProgressLabel("관련 기사 수집 중...");
      } else if (safeProgress < 62) {
        setProgressLabel(
          "롱테일 관심사 추출 중..."
        );
      } else if (safeProgress < 80) {
        setProgressLabel(
          "검색 트렌드 검증 중..."
        );
      } else {
        setProgressLabel(
          "의미 연관성 검증 중..."
        );
      }
    }, 60);

    try {
      /*
       * 실제 Supabase 분석 요청
       */
      const requestPromise = fetch(
        `${supabaseUrl}/functions/v1/analyze-trend`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },

          body: JSON.stringify({
            query: keyword,
          }),
        }
      ).then(async (response) => {
        const responseText =
          await response.text();

        let parsedData: AnalyzeResponse;

        try {
          parsedData =
            JSON.parse(responseText);
        } catch {
          throw new Error(
            `서버 응답을 읽지 못했습니다. (${response.status})`
          );
        }

        if (!response.ok) {
          throw new Error(
            parsedData?.error ||
              `Edge Function 요청 실패 (${response.status})`
          );
        }

        return parsedData;
      });

      /*
       * 서버가 너무 빨리 끝나도
       * 진행 Animation이 자연스럽게 보이도록
       * 최소 3.5초 유지
       */
      const minimumLoadingTime =
        new Promise<void>((resolve) => {
          window.setTimeout(
            resolve,
            3500
          );
        });

      const [data] =
        await Promise.all([
          requestPromise,
          minimumLoadingTime,
        ]);

      if (!data) {
        throw new Error(
          "서버에서 응답을 받지 못했습니다."
        );
      }

      if (!data.ok) {
        throw new Error(
          data.error ||
            "분석 요청에 실패했습니다."
        );
      }

      window.clearInterval(
        progressTimer
      );

      /*
       * 92 → 100도 단계적으로 마무리
       */
      setProgress(94);
      setProgressLabel("결과 정리 중...");

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 220);
      });

      setProgress(97);

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 180);
      });

      setProgress(100);
      setProgressLabel("분석 완료");

      /*
       * 100% 화면을 잠깐 보여준 뒤 결과 노출
       */
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 550);
      });

      setSearchedQuery(keyword);
      setArticles(
        data.articles ?? []
      );
      setInterests(
        data.interests ?? []
      );
    } catch (err) {
      window.clearInterval(
        progressTimer
      );

      setProgressLabel(
        "분석 중 문제가 발생했습니다."
      );

      console.error(err);

      if (
        err instanceof TypeError &&
        err.message.includes("Invalid value")
      ) {
        setError(
          "배포 환경변수 형식이 올바르지 않습니다. Vercel의 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 값을 다시 확인해 주세요."
        );
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(
          "분석 중 오류가 발생했습니다."
        );
      }
    } finally {
      window.clearInterval(
        progressTimer
      );

      setLoading(false);
    }
  }

  return (
    <main>
      <nav>
        <strong>TrendFlow</strong>

        <span>
          SonYujin Trend Flow Project
        </span>
      </nav>

      <section className="hero">
        <p className="eyebrow">
          CONTENT RESEARCH AGENT
        </p>

        <h1>
          이미 알려진 이슈보다,
          <br />
          다음 관심사를 먼저 찾습니다.
        </h1>

        <p className="description">
          관련 기사를 수집하고 HyperCLOVA X로
          롱테일 관심사를 추출한 뒤,
          검색 관심도와 의미적 연관성을 함께 검증합니다.
        </p>

        {/* =========================
            검색
        ========================= */}

        <div className="search">
          <input
            type="text"
            value={query}
            placeholder="분석할 주제를 입력하세요"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void analyze();
              }
            }}
          />

          <button
            type="button"
            disabled={loading}
            onClick={() => {
              void analyze();
            }}
          >
            {loading
              ? "분석 중..."
              : "분석 시작"}
          </button>
        </div>

        {/* =========================
            Workflow
        ========================= */}

        <div className="analysis-flow">
          {flowSteps.map(
            (step, index) => {
              const isCompleted =
                index < currentStep ||
                (!loading &&
                  Boolean(searchedQuery));

              const isCurrent =
                loading &&
                index === currentStep;

              return (
                <div
                  className="flow-item"
                  key={step}
                >
                  <div
                    className={[
                      "flow-step",
                      isCompleted
                        ? "completed"
                        : "",
                      isCurrent
                        ? "current"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="flow-dot">
                      {isCompleted
                        ? "✓"
                        : index + 1}
                    </span>

                    <span className="flow-label">
                      {step}
                    </span>
                  </div>

                  {index <
                    flowSteps.length -
                    1 && (
                      <div
                        className={[
                          "flow-line",
                          index <
                            currentStep
                            ? "completed"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span />
                      </div>
                    )}
                </div>
              );
            }
          )}
        </div>

        {/* =========================
            Progress
        ========================= */}

        {loading && (
          <div
            className="analysis-progress"
            aria-live="polite"
          >
            <div className="progress-status">
              <div className="progress-live">
                <span className="live-dot" />

                LIVE ANALYSIS
              </div>

              <div className="progress-number">
                {Math.round(progress)}

                <span>%</span>
              </div>
            </div>

            <div className="download-track">
              <div
                className="download-fill"
                style={{
                  width: `${progress}%`,
                }}
              />
            </div>

            <div className="progress-message">
              <strong>
                {progressLabel}
              </strong>

              <span>
                TrendFlow가 데이터를 수집하고
                검증하고 있습니다.
              </span>
            </div>
          </div>
        )}
      </section>

      {/* =========================
          Error
      ========================= */}

      {error && (
        <section className="results">
          <div className="error">
            {error}
          </div>
        </section>
      )}

      {/* =========================
          Signal Result
      ========================= */}

      {interests.length > 0 && (
        <section className="signals">
          <div className="signals-head">
            <p className="eyebrow">
              DISCOVERED SIGNALS
            </p>

            <h2>
              지금 움직이고 있는 관심사
            </h2>

            <p>
              기사에서 추출한 관심사 후보를
              NAVER 검색 트렌드와 CLOVA
              Embedding 기반 의미 연관성으로
              다시 검증했습니다.
            </p>
          </div>

          <div className="signal-list">
            {interests.map(
              (interest, index) => {
                const trendChange =
                  interest.trend
                    ?.change ?? 0;

                const articleCount =
                  interest.articleCount ??
                  interest.articleIds
                    ?.length ??
                  0;

                const semanticScore =
                  similarityPercent(
                    interest.semantic
                      ?.score
                  );

                const topicSimilarity =
                  similarityPercent(
                    interest.semantic
                      ?.topicSimilarity
                  );

                const evidenceSimilarity =
                  similarityPercent(
                    interest.semantic
                      ?.evidenceSimilarity
                  );

                const signalScore =
                  interest.signal
                    ?.score ?? 0;

                const evidenceArticles =
                  (interest.articleIds ?? [])
                    .map((id) =>
                      articles.find(
                        (article) => article.id === id
                      )
                    )
                    .filter(
                      (article): article is Article =>
                        Boolean(article)
                    );

                return (
                  <div
                    className="signal"
                    key={`${interest.keyword}-${index}`}
                  >
                    <div className="signal-rank">
                      {String(
                        index + 1
                      ).padStart(
                        2,
                        "0"
                      )}
                    </div>

                    <div className="signal-main">
                      <div className="signal-title-row">
                        <h3>
                          {
                            interest.keyword
                          }
                        </h3>

                        <span className="signal-score">
                          {
                            signalScore
                          }
                        </span>
                      </div>

                      <p>
                        {
                          interest.reason
                        }
                      </p>

                      {interest.searchKeywords &&
                        interest
                          .searchKeywords
                          .length >
                        0 && (
                          <div className="keyword-group">
                            {interest.searchKeywords.map(
                              (
                                keyword
                              ) => (
                                <span
                                  key={
                                    keyword
                                  }
                                >
                                  {
                                    keyword
                                  }
                                </span>
                              )
                            )}
                          </div>
                        )}
                    </div>

                    <div className="signal-data">

                      {/* SIGNAL SCORE */}

                      <div className="metric-card">
                        <div className="metric-heading">
                          <span>Signal Score</span>

                          <div className="metric-info">
                            <button
                              type="button"
                              className="info-button"
                              aria-label="Signal Score 설명"
                            >
                              i
                            </button>

                            <div className="metric-tooltip">
                              <strong>Signal Score</strong>

                              <p>
                                발견된 관심사의 우선순위를 비교하기 위해
                                TrendFlow가 만든 내부 지표입니다.
                              </p>

                              <div className="tooltip-formula">
                                의미 연관성 55%
                                <br />
                                검색 관심도 30%
                                <br />
                                근거 기사 15%
                              </div>

                              <small>
                                절대적인 트렌드 예측 확률은 아닙니다.
                              </small>
                            </div>
                          </div>
                        </div>

                        <strong className="metric-value">
                          {signalScore}
                        </strong>
                      </div>


                      {/* 관심도 변화 */}

                      <div className="metric-card">
                        <div className="metric-heading">
                          <span>관심도 변화</span>

                          <div className="metric-info">
                            <button
                              type="button"
                              className="info-button"
                              aria-label="관심도 변화 설명"
                            >
                              i
                            </button>

                            <div className="metric-tooltip">
                              <strong>관심도 변화</strong>

                              <p>
                                NAVER 검색 트렌드의 최근 구간 평균과
                                이전 구간 평균의 차이입니다.
                              </p>

                              <small>
                                실제 검색 횟수가 아니라 상대적 검색 관심도
                                변화입니다.
                              </small>
                            </div>
                          </div>
                        </div>

                        <strong
                          className={[
                            "metric-value",
                            trendChange > 0
                              ? "up"
                              : trendChange < 0
                                ? "down"
                                : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {trendChange > 0 ? "+" : ""}
                          {trendChange.toFixed(1)}p
                        </strong>
                      </div>


                      {/* 의미 연관성 */}

                      <div className="metric-card">
                        <div className="metric-heading">
                          <span>의미 연관성</span>

                          <div className="metric-info">
                            <button
                              type="button"
                              className="info-button"
                              aria-label="의미 연관성 설명"
                            >
                              i
                            </button>

                            <div className="metric-tooltip">
                              <strong>의미 연관성</strong>

                              <p>
                                CLOVA Embedding으로 텍스트를 벡터화한 뒤
                                코사인 유사도를 이용해 계산한 의미적
                                연관성입니다.
                              </p>

                              <div className="tooltip-formula">
                                입력 주제 ↔ 관심사
                                <br />
                                관심사 ↔ 근거 기사
                              </div>

                              <small>
                                값이 높을수록 기사 맥락과 입력 주제에
                                의미적으로 가까운 후보입니다.
                              </small>
                            </div>
                          </div>
                        </div>

                        <strong className="metric-value">
                          {semanticScore}%
                        </strong>
                      </div>


                      {/* 근거 기사 */}

                      <div className="metric-card evidence-card">
                        <div className="metric-heading">
                          <span>근거 기사</span>

                          <div className="metric-info evidence-info">
                            <button
                              type="button"
                              className="info-button"
                              aria-label="근거 기사 보기"
                            >
                              i
                            </button>

                            <div className="evidence-tooltip">
                              <div className="evidence-tooltip-head">
                                <div>
                                  <strong>근거 기사</strong>

                                  <p>
                                    이 관심사 추출에 사용된 기사입니다.
                                  </p>
                                </div>

                                <span>
                                  {evidenceArticles.length} sources
                                </span>
                              </div>

                              <div className="evidence-sources">
                                {evidenceArticles.length > 0 ? (
                                  evidenceArticles.map(
                                    (article, sourceIndex) => {
                                      const articleUrl =
                                        getArticleUrl(article);

                                      return (
                                        <a
                                          className="evidence-source"
                                          key={
                                            article.id ??
                                            `${article.title}-${sourceIndex}`
                                          }
                                          href={articleUrl || undefined}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          <div className="source-title-row">
                                            <span className="source-number">
                                              {sourceIndex + 1}
                                            </span>

                                            <strong className="source-title">
                                              {cleanText(article.title)}
                                            </strong>

                                            <span className="source-arrow">
                                              ↗
                                            </span>
                                          </div>

                                          <small className="source-meta">
                                            {getArticleHost(article)}
                                            {article.pubDate
                                              ? ` · ${formatDate(article.pubDate)}`
                                              : ""}
                                          </small>
                                        </a>
                                      );
                                    }
                                  )
                                ) : (
                                  <p className="no-source">
                                    연결된 근거 기사가 없습니다.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <strong className="metric-value">
                          {articleCount}건
                        </strong>
                      </div>

                    </div>

                    <div className="semantic-detail">
                      <span>
                        주제 연관성{" "}
                        {
                          topicSimilarity
                        }
                        %
                      </span>

                      <span>
                        기사 근거 연관성{" "}
                        {
                          evidenceSimilarity
                        }
                        %
                      </span>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </section>
      )}

      {/* =========================
          Articles
      ========================= */}

      {articles.length > 0 && (
        <section className="results">
          <div className="result-head">
            <div>
              <p className="eyebrow">
                SOURCE ARTICLES
              </p>

              <h2>
                “
                {searchedQuery ||
                  query}
                ” 관련 기사
              </h2>
            </div>

            <strong>
              {articles.length}개 기사 수집
            </strong>
          </div>

          <div className="articles">
            {articles.map(
              (article, index) => {
                const url =
                  article.originallink ||
                  article.link;

                return (
                  <article
                    key={
                      article.id ??
                      `${article.title}-${index}`
                    }
                  >
                    <div className="number">
                      {String(
                        index + 1
                      ).padStart(
                        2,
                        "0"
                      )}
                    </div>

                    <div>
                      <h3>
                        {cleanText(
                          article.title
                        )}
                      </h3>

                      <p>
                        {cleanText(
                          article.description
                        )}
                      </p>

                      <small>
                        {formatDate(
                          article.pubDate
                        )}
                      </small>
                    </div>

                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        기사 보기 ↗
                      </a>
                    )}
                  </article>
                );
              }
            )}
          </div>
        </section>
      )}
    </main>
  );
}

const rootElement =
  document.getElementById("root");

if (!rootElement) {
  throw new Error(
    "root element를 찾을 수 없습니다."
  );
}

createRoot(rootElement).render(
  <App />
);