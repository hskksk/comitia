import { z } from "zod";
import {
  AGREEMENT_OUTCOMES,
  AGREEMENT_STATES,
  CONSENSUS_TYPES,
  DECLARATION_KINDS,
  ENGINE_DIVERSITY,
  EVENT_KINDS,
  PARTICIPANT_KINDS,
  POST_TYPES,
  PROPOSAL_OUTCOMES,
  PROPOSAL_TARGETS,
  ROLES,
  SHARED_ARTIFACT_KINDS,
  THREAD_STATES,
  THREAD_TYPES,
  WORK_PHASES,
} from "./constants.js";

export const threadTypeSchema = z.enum(THREAD_TYPES);
export const threadStateSchema = z.enum(THREAD_STATES);
export const workPhaseSchema = z.enum(WORK_PHASES);
export const postTypeSchema = z.enum(POST_TYPES);
export const consensusTypeSchema = z.enum(CONSENSUS_TYPES);
export const proposalTargetSchema = z.enum(PROPOSAL_TARGETS);
export const sharedArtifactKindSchema = z.enum(SHARED_ARTIFACT_KINDS);
export const declarationKindSchema = z.enum(DECLARATION_KINDS);
export const agreementOutcomeSchema = z.enum(AGREEMENT_OUTCOMES);
export const agreementStateSchema = z.enum(AGREEMENT_STATES);
export const proposalOutcomeSchema = z.enum(PROPOSAL_OUTCOMES);
export const roleSchema = z.enum(ROLES);
export const participantKindSchema = z.enum(PARTICIPANT_KINDS);
export const engineDiversitySchema = z.enum(ENGINE_DIVERSITY);
export const eventKindSchema = z.enum(EVENT_KINDS);

export const selectCandidatePayloadSchema = z.object({
  proposalVersionId: z.string().uuid(),
});

export const declareRoughPayloadSchema = z.object({
  binding: z.boolean(),
  summary: z.string().min(1),
});

export const ownerDecidePayloadSchema = z.object({
  binding: z.boolean(),
  summary: z.string().min(1),
});

export const requestRatificationPayloadSchema = z.object({});

export const ratifyPayloadSchema = z.object({
  binding: z.boolean(),
  summary: z.string().min(1),
});

export const sendBackPayloadSchema = z.object({
  reason: z.string().min(1),
});

export const rejectThreadPayloadSchema = z.object({
  summary: z.string().optional(),
  recordAsAgreement: z.boolean().optional(),
  binding: z.boolean().optional(),
});

export const completeThreadPayloadSchema = z.object({});

export const resolveObjectionPayloadSchema = z.object({
  note: z.string().min(1),
});

export const extendWindowPayloadSchema = z.object({
  hours: z.number().positive(),
});

export const shortenWindowPayloadSchema = z.object({
  hours: z.number().positive(),
});

export const clockSatisfyPayloadSchema = z.object({
  binding: z.boolean(),
  summary: z.string().min(1),
});

export const declarationPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("select_candidate"),
    ...selectCandidatePayloadSchema.shape,
  }),
  z.object({
    kind: z.literal("declare_rough"),
    ...declareRoughPayloadSchema.shape,
  }),
  z.object({
    kind: z.literal("owner_decide"),
    ...ownerDecidePayloadSchema.shape,
  }),
  z.object({
    kind: z.literal("request_ratification"),
    ...requestRatificationPayloadSchema.shape,
  }),
  z.object({
    kind: z.literal("ratify"),
    ...ratifyPayloadSchema.shape,
  }),
  z.object({
    kind: z.literal("send_back"),
    ...sendBackPayloadSchema.shape,
  }),
  z.object({
    kind: z.literal("reject_thread"),
    ...rejectThreadPayloadSchema.shape,
  }),
  z.object({
    kind: z.literal("complete_thread"),
    ...completeThreadPayloadSchema.shape,
  }),
  z.object({
    kind: z.literal("resolve_objection"),
    ...resolveObjectionPayloadSchema.shape,
  }),
  z.object({
    kind: z.literal("extend_window"),
    ...extendWindowPayloadSchema.shape,
  }),
  z.object({
    kind: z.literal("shorten_window"),
    ...shortenWindowPayloadSchema.shape,
  }),
  z.object({
    kind: z.literal("clock_satisfy"),
    ...clockSatisfyPayloadSchema.shape,
  }),
]);

export const conflictCitationSchema = z.object({
  agreementId: z.string().uuid(),
  note: z.string().min(1),
});

export const objectionInputSchema = z.object({
  authorId: z.string().uuid(),
  blocking: z.boolean(),
  resolvedAt: z.date().nullable(),
  proposalVersionId: z.string().uuid(),
});

export const evaluateConsensusInputSchema = z.object({
  consensusType: consensusTypeSchema,
  candidateVersionId: z.string().uuid().nullable(),
  objections: z.array(objectionInputSchema),
  mainParticipantIds: z.array(z.string().uuid()),
});

export const evaluateConsensusResultSchema = z.object({
  satisfied: z.boolean(),
  reasons: z.array(z.string()),
});

export const foundingArtifactInputSchema = z
  .object({
    templateId: z.string().min(1).optional(),
    content: z.string().optional(),
  })
  .refine((value) => Boolean(value.templateId || value.content?.trim()), {
    message: "templateId または content が必要です",
  });
