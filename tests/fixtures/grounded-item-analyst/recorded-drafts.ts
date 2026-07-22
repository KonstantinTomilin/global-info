/**
 * Recorded LLM drafts for C2 offline tests (no live network).
 * Generic fixtures — no hard-coded real subject names in runtime code paths;
 * tests inject subject via profile.
 */

export const CORRUPTION_FIXTURE_SOURCE = [
  "Authors of the investigation describe circumstances of a joint vacation involving a",
  "business figure and a government official. The publication frames these circumstances",
  "as a possible conflict of interest and a corruption risk that requires documentary",
  "verification. The authors cite travel records and photographs as supporting material",
  "for their claims, while noting that media allegations are not a court finding.",
].join(" ");

export const POLITICS_FIXTURE_SOURCE = [
  "The newspaper reports that the businessman attended a political fundraiser and met",
  "with several lawmakers. The article describes political exposure and lobbying contacts",
  "but does not allege bribery or a criminal conviction. It notes the meetings are a",
  "matter of public record according to campaign filings.",
].join(" ");

export function recordedCorruptionDraft(subjectDisplayName: string) {
  const s0 = `В материале сообщается о расследовании обстоятельств совместного отдыха, связанных с ${subjectDisplayName}.`;
  const s1 =
    "Авторы публикации утверждают, что эти обстоятельства могут указывать на конфликт интересов и коррупционный риск.";
  const s2 =
    "Издание отмечает, что медийные утверждения не являются судебным решением и требуют проверки документов.";
  return {
    clientDescription: [s0, s1, s2].join(" "),
    claimKind: "SOURCE_ALLEGATION" as const,
    attribution: "утверждают / сообщается",
    whyItMatters:
      "Для compliance важно зафиксировать alleged conflict-of-interest сюжет и проверить первичные travel/gift документы по этой публикации.",
    qualification:
      "Наличие публикации не подтверждает обвинения; требуется проверка первичных документов.",
    recommendedChecks: [
      "Сверить факты поездки с первичными документами",
      "Проверить наличие опровержений и статус должностного лица на дату событий",
    ],
    entities: [subjectDisplayName],
    dates: [],
    regions: [],
    supportingSpans: [
      {
        sentenceIndex: 0,
        quote: "joint vacation involving a business figure and a government official",
      },
      {
        sentenceIndex: 1,
        quote: "possible conflict of interest and a corruption risk",
      },
      {
        sentenceIndex: 2,
        quote: "media allegations are not a court finding",
      },
    ],
    analysisConfidence: 0.82,
  };
}

export function recordedPoliticsDraft(subjectDisplayName: string) {
  const s0 = `В публикации сообщается о политической экспозиции ${subjectDisplayName} через участие во встречах с законодателями.`;
  const s1 =
    "Авторы статьи описывают контакты и fundraising, но не утверждают факт взятки или уголовного приговора.";
  return {
    clientDescription: [s0, s1].join(" "),
    claimKind: "SOURCE_ALLEGATION" as const,
    attribution: "сообщается / описывают",
    whyItMatters:
      "Политическая экспозиция важна для due diligence как контекст влияния, без автоматической квалификации как коррупции.",
    qualification:
      "Политические контакты в СМИ не равны доказанному правонарушению; нужна проверка filings.",
    recommendedChecks: [
      "Сверить упоминания с campaign filings",
      "Отделить политический контекст от уголовных alleged фактов",
    ],
    entities: [subjectDisplayName],
    dates: [],
    regions: [],
    supportingSpans: [
      {
        sentenceIndex: 0,
        quote: "attended a political fundraiser and met with several lawmakers",
      },
      {
        sentenceIndex: 1,
        quote: "does not allege bribery or a criminal conviction",
      },
    ],
    analysisConfidence: 0.8,
  };
}

/** Intentionally bad draft — hallucinated entity + missing attribution. */
export function recordedHallucinatedDraft() {
  return {
    clientDescription:
      "В материале доказано, что субъект перевёл миллиард долларов через банк Atlantis Nova Holdings.",
    claimKind: "SOURCE_ALLEGATION" as const,
    attribution: null,
    whyItMatters: "Крупный перевод важен.",
    qualification: "Нужна проверка.",
    recommendedChecks: ["Проверить банк"],
    entities: ["Atlantis Nova Holdings"],
    dates: [],
    regions: [],
    supportingSpans: [
      {
        sentenceIndex: 0,
        quote: "conflict of interest",
      },
    ],
    analysisConfidence: 0.9,
  };
}
