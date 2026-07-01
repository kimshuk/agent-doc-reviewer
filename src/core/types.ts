export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type Disposition = "required" | "optional";
export type FindingStatus = "new" | "still_present" | "resolved" | "superseded";
export type Assessment = "met" | "partial" | "not_met" | "not_applicable";
export type Feasibility = "feasible" | "feasible_with_conditions" | "not_feasible";
export type Stage = "spec" | "plan";
export type Verdict = "approved" | "changes_requested";

export interface Location { path: string; startLine: number; endLine: number; }

export interface Finding {
  id: string;
  status: FindingStatus;
  severity: Severity;
  disposition: Disposition;
  category: string;
  claim: string;
  where: Location;
  fix: string;
  completionCondition: string;
  supersededByFindingIds: string[];
}

export interface Coverage { id: string; assessment: Assessment; note: string; findingIds: string[]; }

export interface ReviewResult {
  feasibility: Feasibility;
  feasibilityRationale: string;
  feasibilityFindingIds: string[];
  criteriaCoverage: Coverage[];
  upstreamCoverage: Coverage[];
  findings: Finding[];
}

export type AuthorResponseKind =
  | "accepted_and_revised" | "rejected_with_evidence" | "already_addressed" | "needs_user_decision";
export interface AuthorResponse { findingId: string; response: AuthorResponseKind; evidence?: string; }

export interface Identity { provider: string; model: string; }
export interface CriterionMeta { required: boolean; }
export type CriteriaMeta = Record<string, CriterionMeta>;
export interface ProviderSpec { provider: string; model: string; }

export interface ReviewRequest {
  system: string;
  user: string;
  schema: object;
  model: string;
  temperature: 0;
  priorInvalidOutput?: string;
  validationErrors?: string;
}
export interface StructuredRequest {
  system: string;
  user: string;
  schema: object;
  schemaName: string;              // caller-supplied tool/schema name; keeps review persona out of generic calls
  model: string;
  temperature: number;
  priorInvalidOutput?: string;
  validationErrors?: string;
}
export interface StructuredProvider {
  name: string;
  generateStructured(req: StructuredRequest): Promise<unknown>;
}
export interface ReviewerProvider extends StructuredProvider {
  review(req: ReviewRequest): Promise<unknown>;
}
