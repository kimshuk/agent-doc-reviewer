import { Ajv } from "ajv";

const coverageArray = {
  type: "array",
  items: {
    type: "object", additionalProperties: false,
    required: ["id", "assessment", "note", "findingIds"],
    properties: {
      id: { type: "string" },
      assessment: { enum: ["met", "partial", "not_met", "not_applicable"] },
      note: { type: "string" },
      findingIds: { type: "array", items: { type: "string" } }
    }
  }
} as const;

export const REVIEW_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["feasibility", "feasibilityRationale", "feasibilityFindingIds",
             "criteriaCoverage", "upstreamCoverage", "findings"],
  properties: {
    feasibility: { enum: ["feasible", "feasible_with_conditions", "not_feasible"] },
    feasibilityRationale: { type: "string" },
    feasibilityFindingIds: { type: "array", items: { type: "string" } },
    criteriaCoverage: coverageArray,
    upstreamCoverage: coverageArray,
    findings: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "status", "severity", "disposition", "category",
                   "claim", "where", "fix", "completionCondition", "supersededByFindingIds"],
        properties: {
          id: { type: "string" },
          status: { enum: ["new", "still_present", "resolved", "superseded"] },
          severity: { enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
          disposition: { enum: ["required", "optional"] },
          category: { type: "string" },
          claim: { type: "string" },
          where: {
            type: "object", additionalProperties: false,
            required: ["path", "startLine", "endLine"],
            properties: {
              path: { type: "string" },
              startLine: { type: "integer", minimum: 1 },
              endLine: { type: "integer", minimum: 1 }
            }
          },
          fix: { type: "string" },
          completionCondition: { type: "string" },
          supersededByFindingIds: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
} as const;

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(REVIEW_SCHEMA as object);

export function validateStructural(data: unknown): { ok: true } | { ok: false; errors: string } {
  if (validate(data)) return { ok: true };
  return { ok: false, errors: ajv.errorsText(validate.errors, { separator: "; " }) };
}
