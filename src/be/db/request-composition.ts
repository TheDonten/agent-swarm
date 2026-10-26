import type { RequestComposition, RequestCompositionPart } from "../../types";
import { getDbClient } from "./runtime";

type RequestCompositionRow = Omit<RequestComposition, "parts"> & { parts: string };

export interface CreateRequestCompositionInput {
  taskId: string;
  agentId: string;
  sessionId: string;
  provider: string;
  model?: string;
  source: RequestComposition["source"];
  parts: RequestCompositionPart[];
  tokenRatio?: number;
}

/**
 * Store a manifest as the session's next `seq`. The MAX + 1 read runs in the
 * same immediate transaction as the insert, so two posts for one session
 * cannot claim the same seq.
 */
export async function createRequestComposition(
  input: CreateRequestCompositionInput,
): Promise<RequestComposition> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const staticEstTokens = input.parts.reduce((sum, part) => sum + part.estTokens, 0);
  const tokenRatio = input.tokenRatio ?? 1;

  const seq = await getDbClient().transaction(async (tx) => {
    const last = await tx.get<{ seq: number | null }>(
      "SELECT MAX(seq) AS seq FROM request_composition WHERE sessionId = ?",
      [input.sessionId],
    );
    const next = last?.seq == null ? 0 : last.seq + 1;
    await tx.run(
      `INSERT INTO request_composition
         (id, taskId, agentId, sessionId, seq, provider, model, source, parts, staticEstTokens, tokenRatio, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.taskId,
        input.agentId,
        input.sessionId,
        next,
        input.provider,
        input.model ?? null,
        input.source,
        JSON.stringify(input.parts),
        staticEstTokens,
        tokenRatio,
        createdAt,
      ],
    );
    return next;
  });

  return {
    id,
    taskId: input.taskId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    seq,
    provider: input.provider,
    model: input.model ?? null,
    source: input.source,
    parts: input.parts,
    staticEstTokens,
    tokenRatio,
    createdAt,
  };
}

/** Every manifest of a task, oldest session first. */
export async function getRequestCompositionsByTask(taskId: string): Promise<RequestComposition[]> {
  const rows = await getDbClient().query<RequestCompositionRow>(
    `SELECT id, taskId, agentId, sessionId, seq, provider, model, source, parts, staticEstTokens, tokenRatio, createdAt
       FROM request_composition WHERE taskId = ? ORDER BY createdAt ASC, seq ASC`,
    [taskId],
  );
  return rows.map((row) => ({ ...row, parts: JSON.parse(row.parts) as RequestCompositionPart[] }));
}
