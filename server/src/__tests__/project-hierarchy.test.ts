import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, companyMemberships, createDb, projectAccessMembers, projects } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { projectService } from "../services/projects.js";
import { projectRoutes } from "../routes/projects.js";
import { errorHandler } from "../middleware/index.js";

describe("project hierarchy", () => {
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  const previousPrivacy = process.env.PAPERCLIP_ISSUE_PRIVACY_MODE;
  beforeAll(async () => {
    temp = await startEmbeddedPostgresTestDatabase("project-hierarchy-");
    db = createDb(temp.connectionString);
    process.env.PAPERCLIP_ISSUE_PRIVACY_MODE = "enforce";
  });
  afterAll(async () => {
    if (previousPrivacy === undefined) delete process.env.PAPERCLIP_ISSUE_PRIVACY_MODE;
    else process.env.PAPERCLIP_ISSUE_PRIVACY_MODE = previousPrivacy;
    await temp?.cleanup();
  });
  async function company() {
    const [row] = await db.insert(companies).values({ name: "Hierarchy", issuePrefix: `H${randomUUID().slice(0, 7)}` }).returning();
    return row.id;
  }
  it("persists nesting, clears parents, and promotes children on deletion without inheriting settings", async () => {
    const companyId = await company(), svc = projectService(db);
    const parent = await svc.create(companyId, { name: "Parent", visibility: "private", status: "in_progress" });
    const child = await svc.create(companyId, { name: "Child", parentProjectId: parent.id });
    expect(await svc.getById(child.id)).toMatchObject({ parentProjectId: parent.id, visibility: "open", status: "backlog", goalIds: [] });
    expect(await svc.update(child.id, { parentProjectId: null })).toMatchObject({ parentProjectId: null });
    await svc.update(child.id, { parentProjectId: parent.id });
    await db.delete(projects).where(eq(projects.id, parent.id));
    expect(await svc.getById(child.id)).toMatchObject({ parentProjectId: null });
  });
  it("rejects foreign parents, self-parenting and indirect cycles on create/update", async () => {
    const companyId = await company(), svc = projectService(db);
    const parent = await svc.create(companyId, { name: "Parent" });
    const child = await svc.create(companyId, { name: "Child", parentProjectId: parent.id });
    const leaf = await svc.create(companyId, { name: "Leaf", parentProjectId: child.id });
    await expect(svc.update(parent.id, { parentProjectId: leaf.id })).rejects.toThrow("cycle");
    await expect(svc.update(parent.id, { parentProjectId: parent.id })).rejects.toThrow("cycle");
    await expect(svc.create(await company(), { name: "Foreign", parentProjectId: parent.id })).rejects.toThrow("company");
    const foreign = await svc.create(await company(), { name: "Foreign" });
    await expect(svc.update(parent.id, { parentProjectId: foreign.id })).rejects.toThrow("company");
    expect(await svc.getById(parent.id)).toMatchObject({ parentProjectId: null });
  });
  it("serializes opposing moves across service instances so only one can commit", async () => {
    const companyId = await company(), svc = projectService(db);
    const a = await svc.create(companyId, { name: "A" }), b = await svc.create(companyId, { name: "B" });
    const outcomes = await Promise.allSettled([
      projectService(db).update(a.id, { parentProjectId: b.id }),
      projectService(db).update(b.id, { parentProjectId: a.id }),
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    const rows = await svc.list(companyId);
    expect(rows.filter(row => row.parentProjectId === null)).toHaveLength(1);
  });
  it("hides private parent references in list/detail/update and rejects choosing an unreadable parent", async () => {
    const companyId = await company(), svc = projectService(db), userId = randomUUID();
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "member" });
    const parent = await svc.create(companyId, { name: "Hidden parent", visibility: "private" });
    const child = await svc.create(companyId, { name: "Open child", parentProjectId: parent.id });
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { type: "board", userId, source: "session", isInstanceAdmin: false, companyIds: [companyId],
        memberships: [{ companyId, membershipRole: "member", status: "active" }] }; next();
    });
    app.use("/api", projectRoutes(db)); app.use(errorHandler);
    const list = await request(app).get(`/api/companies/${companyId}/projects`).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: child.id, parentProjectId: null });
    expect((await request(app).get(`/api/projects/${child.id}`).expect(200)).body.parentProjectId).toBeNull();
    expect((await request(app).patch(`/api/projects/${child.id}`).send({ description: "Updated" }).expect(200)).body.parentProjectId).toBeNull();
    await request(app).patch(`/api/projects/${child.id}`).send({ parentProjectId: parent.id }).expect(404);
    await request(app).post(`/api/companies/${companyId}/projects`).send({ name: "Other", parentProjectId: parent.id }).expect(404);
    await db.insert(projectAccessMembers).values({ companyId, projectId: parent.id, subjectType: "user", subjectId: userId });
    expect((await request(app).get(`/api/projects/${child.id}`).expect(200)).body.parentProjectId).toBe(parent.id);
    await request(app).patch(`/api/projects/${parent.id}`).send({ parentProjectId: child.id }).expect(422);
  });
});
