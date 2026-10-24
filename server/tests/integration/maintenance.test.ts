// Tests d'intégration du nettoyage : la route de maintenance supprime vraiment objets S3 et documents expirés.
import type { Express } from "express";
import request from "supertest";
import { Transfer } from "../../src/models/transfer.model.js";
import { createIntegrationContext, type IntegrationContext } from "./helpers/context.js";

const TOKEN = "integration-maintenance-token-0123456789abcdef";
let ctx: IntegrationContext;
let app: Express;

beforeAll(async () => {
  ctx = await createIntegrationContext("maintenance");
});
beforeEach(async () => {
  await ctx.reset();
  app = ctx.app({ maintenanceToken: TOKEN });
});
afterAll(async () => {
  await ctx.close();
});

async function createTransfer(fileCount: number, expiredHoursAgo?: number): Promise<string> {
  let req = request(app).post("/api/transfers");
  for (let i = 0; i < fileCount; i++) req = req.attach("files", Buffer.from(`fichier ${i}`), `f${i}.txt`);
  const { body } = await req.expect(201);
  if (expiredHoursAgo !== undefined) {
    await Transfer.updateOne(
      { code: body.code },
      { expiresAt: new Date(Date.now() - expiredHoursAgo * 3600_000) },
    );
  }
  return body.code as string;
}

describe("POST /api/maintenance/cleanup (vrai Mongo, vrai S3)", () => {
  it("supprime objets et document d'un transfert expiré, et seulement lui", async () => {
    const expired = await createTransfer(2, 2);
    const active = await createTransfer(1);

    const response = await request(app).post("/api/maintenance/cleanup").set("x-maintenance-token", TOKEN);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ transfers: 1, objects: 2, objectErrors: 0 });
    expect(await Transfer.exists({ code: expired })).toBeNull();
    const remaining = await Transfer.findOne({ code: active }).lean();
    expect(await ctx.listObjectKeys()).toEqual(remaining?.files.map((f) => f.storageKey));
  });

  it("garde un transfert expiré depuis moins que le délai de grâce", async () => {
    const recent = await createTransfer(1, 0.1);

    const response = await request(app).post("/api/maintenance/cleanup").set("x-maintenance-token", TOKEN);

    expect(response.body).toEqual({ transfers: 0, objects: 0, objectErrors: 0 });
    expect(await Transfer.exists({ code: recent })).not.toBeNull();
  });

  it("répond 403 à un mauvais jeton, sans rien supprimer", async () => {
    await createTransfer(1, 2);

    const response = await request(app)
      .post("/api/maintenance/cleanup")
      .set("x-maintenance-token", "mauvais");

    expect(response.status).toBe(403);
    expect(await Transfer.countDocuments()).toBe(1);
    expect(await ctx.listObjectKeys()).toHaveLength(1);
  });
});
