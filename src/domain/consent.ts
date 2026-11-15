/**
 * Required content of an informed consent form, 21 CFR 50.25.
 *
 * The checker looks for each element in the consent text and reports which ones it could not find.
 * It is a completeness screen for intake, not a judgment of adequacy: the submitter must point to
 * where any unfound element is covered (or explain why an "additional" element does not apply), and
 * the IRB reviewer still judges the form under 21 CFR 56.111(a)(4).
 */

export type ElementKind = "basic" | "additional" | "registry";

export interface ConsentElement {
  id: string;
  cfr: string;
  kind: ElementKind;
  label: string;
  /** Any one pattern matching counts as "found". Lowercase text is searched. */
  patterns: RegExp[];
}

export const CONSENT_ELEMENTS: ConsentElement[] = [
  {
    id: "research-purpose-procedures",
    cfr: "50.25(a)(1)",
    kind: "basic",
    label: "Statement that the study is research, its purposes, expected duration, procedures, and which procedures are experimental",
    patterns: [/\bresearch (study|project)\b/, /\bpurpose of (this|the) (study|research)\b/, /\bexperimental\b/, /\binvestigational\b/],
  },
  {
    id: "risks",
    cfr: "50.25(a)(2)",
    kind: "basic",
    label: "Reasonably foreseeable risks or discomforts",
    patterns: [/\brisks?\b/, /\bdiscomforts?\b/, /\bside effects?\b/],
  },
  {
    id: "benefits",
    cfr: "50.25(a)(3)",
    kind: "basic",
    label: "Benefits to the subject or others that may reasonably be expected",
    patterns: [/\bbenefits?\b/],
  },
  {
    id: "alternatives",
    cfr: "50.25(a)(4)",
    kind: "basic",
    label: "Appropriate alternative procedures or treatments",
    patterns: [/\balternatives?\b/, /\bother (treatments?|options|choices)\b/],
  },
  {
    id: "confidentiality",
    cfr: "50.25(a)(5)",
    kind: "basic",
    label: "Extent of confidentiality, noting that FDA may inspect records",
    patterns: [
      /\b(food and drug administration|fda)\b[^.]{0,120}\b(inspect|review|see|access)/,
      /\b(inspect|review|see|access)[^.]{0,120}\b(food and drug administration|fda)\b/,
    ],
  },
  {
    id: "injury-compensation",
    cfr: "50.25(a)(6)",
    kind: "basic",
    label: "For more than minimal risk: compensation and medical treatment available if injury occurs",
    patterns: [/\binjur(y|ed|ies)\b.*\b(treatment|compensation|pay|cost)/, /\b(treatment|compensation)\b.*\binjur(y|ed|ies)\b/],
  },
  {
    id: "contacts",
    cfr: "50.25(a)(7)",
    kind: "basic",
    label: "Whom to contact with questions about the research, subjects' rights, and research-related injury",
    patterns: [/\b(questions|concerns)\b.*\b(contact|call)\b/, /\b(contact|call)\b.*\b(questions|concerns)\b/],
  },
  {
    id: "voluntary",
    cfr: "50.25(a)(8)",
    kind: "basic",
    label: "Participation is voluntary; refusal or withdrawal carries no penalty or loss of benefits",
    patterns: [/\bvoluntary\b/, /\b(withdraw|stop taking part|leave the study)\b/],
  },
  {
    id: "unforeseeable-risks",
    cfr: "50.25(b)(1)",
    kind: "additional",
    label: "Treatment may involve currently unforeseeable risks (including to an embryo or fetus)",
    patterns: [/\bunforeseeable\b/, /\bunknown risks?\b/, /\brisks? (that )?(are|is) not (yet )?known\b/],
  },
  {
    id: "investigator-termination",
    cfr: "50.25(b)(2)",
    kind: "additional",
    label: "Circumstances in which the investigator may end participation without consent",
    patterns: [/\b(investigator|doctor|sponsor)\b.*\b(may|can)\b.*\b(remove|end|stop|take you out)/],
  },
  {
    id: "additional-costs",
    cfr: "50.25(b)(3)",
    kind: "additional",
    label: "Additional costs to the subject",
    patterns: [/\bcosts?\b/, /\bpay for\b/, /\bcharged?\b/],
  },
  {
    id: "withdrawal-consequences",
    cfr: "50.25(b)(4)",
    kind: "additional",
    label: "Consequences of withdrawing and how to withdraw safely",
    patterns: [/\bif you (decide to )?(withdraw|leave|stop)\b/],
  },
  {
    id: "new-findings",
    cfr: "50.25(b)(5)",
    kind: "additional",
    label: "Significant new findings will be shared",
    patterns: [/\bnew (information|findings)\b/],
  },
  {
    id: "number-of-subjects",
    cfr: "50.25(b)(6)",
    kind: "additional",
    label: "Approximate number of subjects",
    patterns: [/\b(about|approximately|up to|around)\s+[\d,]+\s+(people|participants|subjects|patients)\b/],
  },
  {
    id: "clinicaltrials-gov",
    cfr: "50.25(c)",
    kind: "registry",
    label: "ClinicalTrials.gov statement (required wording for applicable clinical trials)",
    patterns: [/a description of this clinical trial will be available on/],
  },
];

export interface ConsentCheckOptions {
  /** More than minimal risk makes 50.25(a)(6) required. */
  greaterThanMinimalRisk: boolean;
  /** Applicable clinical trial under 42 U.S.C. 282(j) makes 50.25(c) required. */
  applicableClinicalTrial: boolean;
}

export interface ElementResult {
  element: ConsentElement;
  required: boolean;
  found: boolean;
}

export interface ConsentCheck {
  results: ElementResult[];
  /** Required elements the checker could not find. Intake cannot complete until each is resolved. */
  missingRequired: ConsentElement[];
  /** Additional elements not found; the submitter must say where they are or why they do not apply. */
  missingAdditional: ConsentElement[];
}

export function checkConsentText(text: string, opts: ConsentCheckOptions): ConsentCheck {
  const haystack = text.toLowerCase().replace(/\s+/g, " ");
  const results = CONSENT_ELEMENTS.map((element) => {
    const required =
      element.kind === "basic"
        ? element.id !== "injury-compensation" || opts.greaterThanMinimalRisk
        : element.kind === "registry"
          ? opts.applicableClinicalTrial
          : false;
    const found = element.patterns.some((p) => p.test(haystack));
    return { element, required, found };
  });
  return {
    results,
    missingRequired: results.filter((r) => r.required && !r.found).map((r) => r.element),
    missingAdditional: results.filter((r) => r.element.kind === "additional" && !r.found).map((r) => r.element),
  };
}

/**
 * Each unfound element must be resolved by the submitter, either by pointing to where it is covered
 * or (for additional elements only) by explaining why it does not apply.
 */
export interface ElementResolution {
  elementId: string;
  location?: string;
  notApplicableBecause?: string;
}

export function unresolvedElements(check: ConsentCheck, resolutions: ElementResolution[]): ConsentElement[] {
  const byId = new Map(resolutions.map((r) => [r.elementId, r]));
  const needs = [...check.missingRequired, ...check.missingAdditional];
  return needs.filter((el) => {
    const r = byId.get(el.id);
    if (!r) return true;
    if (r.location?.trim()) return false;
    if (el.kind === "additional" && r.notApplicableBecause?.trim()) return false;
    return true;
  });
}
