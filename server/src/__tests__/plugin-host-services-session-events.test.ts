import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agentTaskSessions, agents, companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

let liveEventListener: ((event: {
  type: string;
  payload?: Record<string, unknown>;
}) => void) | null = null;

vi.mock("../services/heartbeat.js", () => ({
  heartbeatService: () => ({
    wakeup: vi.fn(async () => ({ id: "run-1" })),
  }),
}));

vi.mock("../services/live-events.js", () => ({
  subscribeCompanyLiveEvents: vi.fn((_companyId: string, listener: typeof liveEventListener) => {
    liveEventListener = listener;
    return () => {
      liveEventListener = null;
    };
  }),
}));

const { buildHostServices } = await import("../services/plugin-host-services.js");

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("plugin host services session events", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-plugin-host-services-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    liveEventListener = null;
    await db.delete(agentTaskSessions);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createEventBusStub() {
    return {
      forPlugin() {
        return {
          emit: async () => {},
          subscribe: () => {},
          clear: () => {},
        };
      },
    } as any;
  }

  async function seedCompanyAndAgent() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Engineer",
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: { command: "true" },
      runtimeConfig: {},
      permissions: {},
    });
    return { companyId, agentId };
  }

  it("forwards companyId on live agent session notifications", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const notifyWorker = vi.fn();
    const services = buildHostServices(
      db,
      "plugin-record-id",
      "paperclip.missions",
      createEventBusStub(),
      notifyWorker,
    );

    const session = await services.agentSessions.create({ agentId, companyId });
    const sendResult = await services.agentSessions.sendMessage({
      sessionId: session.sessionId,
      companyId,
      prompt: "hello",
    });

    liveEventListener?.({
      type: "heartbeat.run.log",
      payload: {
        runId: sendResult.runId,
        seq: 1,
        stream: "stdout",
        chunk: "hello from run",
      },
    });

    expect(notifyWorker).toHaveBeenCalledWith(
      "agents.sessions.event",
      expect.objectContaining({
        sessionId: session.sessionId,
        runId: sendResult.runId,
        companyId,
        eventType: "chunk",
      }),
    );

    services.dispose();
  });
});
