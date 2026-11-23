import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  issueThreadInteractions,
  issues,
} from "@paperclipai/db";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres company pending interaction tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("GET /companies/:companyId/interactions (routes + postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-company-interactions-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    const cleanups = [
      () => db.delete(issueThreadInteractions),
      () => db.delete(issues),
      () => db.delete(companyMemberships),
      () => db.delete(agents),
      () => db.delete(companies),
    ];
    for (const cleanup of cleanups) await cleanup().catch(() => undefined);
  });

  afterAll(async () => {
    await db.$client.end();
    await tempDb?.cleanup();
  });

  function app(actor: Record<string, unknown>) {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    testApp.use("/api", issueRoutes(db, {} as any, {}));
    testApp.use(errorHandler);
    return testApp;
  }

  function agentActor(companyId: string, agentId: string) {
    return { type: "agent", source: "agent_key", companyId, agentId, runId: randomUUID() };
  }

  function boardActor(companyId: string, userId: string) {
    return {
      type: "board",
      source: "session",
      userId,
      companyIds: [companyId],
      memberships: [{ companyId, status: "active", membershipRole: "operator" }],
      isInstanceAdmin: false,
    };
  }

  async function seedCompany(prefix: string) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const userId = `${prefix.toLowerCase()}-operator`;
    await db.insert(companies).values({
      id: companyId,
      name: `${prefix} Company`,
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: `${prefix} Asker`,
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "operator",
    });
    return { companyId, agentId, userId };
  }

  let issueSequence = 0;

  async function seedIssue(companyId: string, prefix: string, status = "in_progress") {
    const issueId = randomUUID();
    issueSequence += 1;
    await db.insert(issues).values({
      id: issueId,
      companyId,
      identifier: `${prefix}-${issueSequence}`,
      title: `${prefix} issue ${issueSequence}`,
      status,
      priority: "medium",
    });
    return issueId;
  }

  async function seedInteraction(input: {
    companyId: string;
    issueId: string;
    agentId?: string;
    kind?: string;
    status?: string;
    hoursAgo: number;
  }) {
    const id = randomUUID();
    const createdAt = new Date(Date.now() - input.hoursAgo * 3_600_000);
    await db.insert(issueThreadInteractions).values({
      id,
      companyId: input.companyId,
      issueId: input.issueId,
      kind: input.kind ?? "request_confirmation",
      status: input.status ?? "pending",
      payload: (input.kind === "ask_user_questions"
        ? {
            version: 1,
            questions: [{
              id: "scope",
              prompt: "Which scope?",
              selectionMode: "single",
              options: [{ id: "phase-1", label: "Phase 1" }],
            }],
          }
        : { version: 1, prompt: "Proceed?" }) as any,
      createdByAgentId: input.agentId ?? null,
      createdAt,
      updatedAt: createdAt,
    });
    return id;
  }

  it("matches the per-issue pending totals, longest wait first, for an agent caller", async () => {
    const { companyId, agentId } = await seedCompany("PIA");
    const open = await seedIssue(companyId, "PIA");
    const blocked = await seedIssue(companyId, "PIA", "blocked");
    const closed = await seedIssue(companyId, "PIA", "done");
    const newest = await seedInteraction({ companyId, issueId: open, agentId, hoursAgo: 1 });
    const oldest = await seedInteraction({
      companyId,
      issueId: blocked,
      agentId,
      kind: "ask_user_questions",
      hoursAgo: 30,
    });
    const middle = await seedInteraction({ companyId, issueId: open, hoursAgo: 5 });
    await seedInteraction({ companyId, issueId: open, status: "accepted", hoursAgo: 50 });
    // Pending row on a closed issue reads as expired per-issue, so it is not counted.
    await seedInteraction({ companyId, issueId: closed, hoursAgo: 80 });

    const other = await seedCompany("PIB");
    const otherIssue = await seedIssue(other.companyId, "PIB");
    await seedInteraction({ companyId: other.companyId, issueId: otherIssue, hoursAgo: 100 });

    const agentApp = app(agentActor(companyId, agentId));
    const res = await request(agentApp).get(`/api/companies/${companyId}/interactions?status=pending`);
    expect(res.status).toBe(200);

    let perIssuePending = 0;
    for (const issueId of [open, blocked, closed]) {
      const perIssue = await request(agentApp).get(`/api/issues/${issueId}/interactions`);
      expect(perIssue.status, JSON.stringify(perIssue.body)).toBe(200);
      perIssuePending += (perIssue.body as Array<{ status: string }>)
        .filter((interaction) => interaction.status === "pending").length;
    }
    expect(res.body.total).toBe(perIssuePending);
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([oldest, middle, newest]);

    const first = res.body.items[0];
    expect(first).toMatchObject({
      kind: "ask_user_questions",
      issue: { id: blocked, status: "blocked" },
      createdBy: { type: "agent", agentId, name: "PIA Asker" },
    });
    expect(first.issue.identifier).toMatch(/^PIA-/);
    expect(first.waitingHours).toBeGreaterThanOrEqual(29.9);
    expect(res.body.items[1].createdBy).toBeNull();

    const filtered = await request(agentApp)
      .get(`/api/companies/${companyId}/interactions?kind=ask_user_questions`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.map((item: { id: string }) => item.id)).toEqual([oldest]);
  });

  it("serves board users too", async () => {
    const { companyId, userId } = await seedCompany("PIC");
    const issueId = await seedIssue(companyId, "PIC");
    await seedInteraction({ companyId, issueId, hoursAgo: 2 });
    const res = await request(app(boardActor(companyId, userId)))
      .get(`/api/companies/${companyId}/interactions`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("refuses cross-company callers and unsupported status filters", async () => {
    const mine = await seedCompany("PID");
    const theirs = await seedCompany("PIE");
    const theirIssue = await seedIssue(theirs.companyId, "PIE");
    await seedInteraction({ companyId: theirs.companyId, issueId: theirIssue, hoursAgo: 3 });

    const crossAgent = await request(app(agentActor(mine.companyId, mine.agentId)))
      .get(`/api/companies/${theirs.companyId}/interactions`);
    expect([403, 404]).toContain(crossAgent.status);
    expect(crossAgent.body.items).toBeUndefined();

    const crossBoard = await request(app(boardActor(mine.companyId, mine.userId)))
      .get(`/api/companies/${theirs.companyId}/interactions`);
    expect([403, 404]).toContain(crossBoard.status);

    const badStatus = await request(app(agentActor(mine.companyId, mine.agentId)))
      .get(`/api/companies/${mine.companyId}/interactions?status=accepted`);
    expect(badStatus.status).toBe(400);
  });
});
