import type { ModelSelection } from "./wire.ts";

export interface TeamSetupFields {
  name?: string;
  title?: string;
  description?: string;
  soul?: string;
  /** Create only: the folder the new bot's tools work in. "" = private workspace. */
  cwd?: string;
  modelSelection?: ModelSelection;
  chiefOfStaff?: boolean;
}

export interface TeamSetupOperation {
  action: "create" | "update";
  botId: string;
  threadId?: string;
  fields: TeamSetupFields;
  expectedRevision?: string;
}

export interface TeamSetupResult {
  state: "applied" | "denied" | "cancelled" | "failed";
  bots: Array<{ id: string; name: string; action: "created" | "updated" | "deleted"; modelSelection?: ModelSelection; chiefOfStaff?: boolean }>;
  error?: string;
}

/** The complete, reviewed operation. It never accepts executable permissions. */
export interface TeamSetupRequest {
  version: 1;
  requestId: string;
  botId: string;
  threadId: string;
  reason: string;
  createdAt: number;
  requesterRevision: string;
  operations: TeamSetupOperation[];
  deletion?: { botId: string; name: string; expectedRevision: string };
  result?: TeamSetupResult;
  resumed?: boolean;
  /** Set when the setup applied on its own (direct-apply.ts) and Undo can reverse it. */
  undo?: TeamSetupUndo;
}

/** Undo deletes the bots a setup created while still unused and gives each updated bot back the values the card showed;
 * `revisions` pin every bot it touched as it applied, so a later change refuses Undo. */
export interface TeamSetupUndo {
  created: string[];
  before: Array<{ botId: string; fields: TeamSetupFields }>;
  revisions: Record<string, string>;
}
