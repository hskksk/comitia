import { createServer, type Server } from "node:http";
import express from "express";
import { TaskState, type AgentCard } from "@a2a-js/sdk";
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  restHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import { parseTickFromMetadata, type Tick } from "@comitia/shared";

class TickExecutor implements AgentExecutor {
  private activeSessionId: string | undefined;

  constructor(private readonly onTick: (tick: Tick) => void) {}

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const userMessage = requestContext.userMessage;
    const tick = parseTickFromMetadata(
      userMessage.metadata as Record<string, unknown> | undefined,
    );

    if (tick) {
      if (
        tick.type === "session.start" &&
        tick.sessionId !== undefined &&
        tick.sessionId === this.activeSessionId
      ) {
        // Idempotent: ignore a duplicate session.start for the active session.
      } else {
        if (tick.type === "session.start" && tick.sessionId !== undefined) {
          this.activeSessionId = tick.sessionId;
        }
        this.onTick(tick);
      }
    }

    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;
    const timestamp = new Date().toISOString();

    eventBus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          message: undefined,
          timestamp,
        },
        artifacts: [],
        history: [userMessage],
        metadata: undefined,
      }),
    );

    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: undefined,
          timestamp,
        },
        metadata: undefined,
      }),
    );

    eventBus.finished();
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId: "",
        status: {
          state: TaskState.TASK_STATE_CANCELED,
          message: undefined,
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      }),
    );
    eventBus.finished();
  }
}

export interface LocalA2aServerOptions {
  agentId: string;
  relayBaseUrl: string;
  onTick: (tick: Tick) => void;
}

export interface LocalA2aServer {
  readonly localBaseUrl: string;
  close: () => Promise<void>;
}

export async function startLocalA2aServer(
  options: LocalA2aServerOptions,
): Promise<LocalA2aServer> {
  const publicBaseUrl = `${options.relayBaseUrl.replace(/\/$/, "")}/agents/${options.agentId}/`;
  const tickExecutor = new TickExecutor(options.onTick);

  const agentCard: AgentCard = {
    name: `comitia-adapter-${options.agentId}`,
    description: "Comitia adapter A2A server",
    supportedInterfaces: [
      {
        url: publicBaseUrl,
        protocolBinding: "HTTP+JSON",
        tenant: "",
        protocolVersion: "1.0",
      },
    ],
    provider: undefined,
    version: "0.0.1",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [],
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [],
    signatures: [],
  };

  const taskStore = new InMemoryTaskStore();
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    tickExecutor,
  );

  const app = express();
  app.use(
    "/.well-known/agent-card.json",
    agentCardHandler({ agentCardProvider: requestHandler }),
  );
  app.use(
    "/",
    restHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  const httpServer: Server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(0, () => resolve());
  });

  const addr = httpServer.address();
  if (!addr || typeof addr === "string") {
    throw new Error("local A2A server address is unavailable");
  }
  const localBaseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    localBaseUrl,
    close: async () => {
      if (typeof httpServer.closeAllConnections === "function") {
        httpServer.closeAllConnections();
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
