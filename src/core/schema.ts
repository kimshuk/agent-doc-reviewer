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

const identitySchema = {
  type: "object", additionalProperties: false, required: ["provider", "model"],
  properties: { provider: { type: "string", minLength: 1 }, model: { type: "string", minLength: 1 } }
} as const;

// Non-null sha256 fields must be lowercase 64-hex; a truncated/garbage hash is corruption.
// (ajv applies `pattern` only to string instances, so `null` still passes the union types.)
const sha256Hex = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;
const sha256OrNull = { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" } as const;

export const ROUND_ARTIFACT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "round", "lineageId", "timestamp", "stage", "author", "reviewer",
             "document_sha256", "criteria_sha256", "prior_document_sha256", "parent_round_sha256",
             "parent_responses_sha256", "prior_approval_sha256", "criteriaMeta", "requirementIds",
             "verdict", "result"],
  properties: {
    schemaVersion: { const: 1 },
    round: { type: "integer", minimum: 1 },
    lineageId: { type: "string", minLength: 1 },
    timestamp: { type: "string", minLength: 1 },
    stage: { enum: ["spec", "plan"] },
    author: identitySchema, reviewer: identitySchema,
    document_sha256: sha256Hex, criteria_sha256: sha256Hex,
    prior_document_sha256: sha256OrNull,
    parent_round_sha256: sha256OrNull, parent_responses_sha256: sha256OrNull, prior_approval_sha256: sha256OrNull,
    criteriaMeta: {
      type: "object",
      additionalProperties: {
        type: "object", additionalProperties: false, required: ["required"],
        properties: { required: { type: "boolean" } }
      }
    },
    requirementIds: { type: "array", items: { type: "string" } },
    verdict: { enum: ["approved", "changes_requested"] },
    result: REVIEW_SCHEMA
  },
  // Parent-hash invariant: round 1 has NO parent (both null); every later round has BOTH
  // (both non-null). This forbids a round > 1 that nulls its parents to skip continuity checks,
  // and forbids a round 1 that fabricates a parent. The two hashes are always together.
  allOf: [{
    if: { properties: { round: { const: 1 } } },
    then: { properties: { parent_round_sha256: { type: "null" }, parent_responses_sha256: { type: "null" } } },
    else: { properties: { parent_round_sha256: sha256Hex, parent_responses_sha256: sha256Hex } }
  }]
} as const;

export const RESPONSES_ARTIFACT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["round", "lineageId", "round_sha256", "finalized", "responses"],
  properties: {
    round: { type: "integer", minimum: 1 },
    lineageId: { type: "string", minLength: 1 },
    round_sha256: sha256Hex,
    finalized: { const: true },
    responses: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["findingId", "response"],
        properties: {
          findingId: { type: "string" },
          response: { enum: ["accepted_and_revised", "rejected_with_evidence", "already_addressed", "needs_user_decision"] },
          evidence: { type: "string" }
        }
      }
    }
  }
} as const;

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(REVIEW_SCHEMA as object);
const validateRound = ajv.compile(ROUND_ARTIFACT_SCHEMA as object);
const validateResponsesEnvelope = ajv.compile(RESPONSES_ARTIFACT_SCHEMA as object);

export function validateStructural(data: unknown): { ok: true } | { ok: false; errors: string } {
  if (validate(data)) return { ok: true };
  return { ok: false, errors: ajv.errorsText(validate.errors, { separator: "; " }) };
}

export function validateRoundArtifact(data: unknown): { ok: true } | { ok: false; errors: string } {
  if (validateRound(data)) return { ok: true };
  return { ok: false, errors: ajv.errorsText(validateRound.errors, { separator: "; " }) };
}

export function validateResponsesArtifact(data: unknown): { ok: true } | { ok: false; errors: string } {
  if (validateResponsesEnvelope(data)) return { ok: true };
  return { ok: false, errors: ajv.errorsText(validateResponsesEnvelope.errors, { separator: "; " }) };
}
