import { GateViolation } from "../domain/errors.js";
import { PROJECT_RULE_TEMPLATES } from "./project-rule.js";
import { THREAD_TEMPLATE_TEMPLATES } from "./thread-template.js";
import type { SystemTemplate, SystemTemplateKind } from "./types.js";

export type { SystemTemplate, SystemTemplateKind } from "./types.js";

const ALL_TEMPLATES: SystemTemplate[] = [
  ...PROJECT_RULE_TEMPLATES,
  ...THREAD_TEMPLATE_TEMPLATES,
];

export function listSystemTemplates(kind?: SystemTemplateKind): SystemTemplate[] {
  if (!kind) {
    return ALL_TEMPLATES;
  }
  return ALL_TEMPLATES.filter((template) => template.kind === kind);
}

export function getSystemTemplate(
  kind: SystemTemplateKind,
  id: string,
): SystemTemplate | undefined {
  return ALL_TEMPLATES.find(
    (template) => template.kind === kind && template.id === id,
  );
}

export function resolveTemplateContent(input: {
  kind: SystemTemplateKind;
  templateId?: string;
  content?: string;
}): string {
  const trimmed = input.content?.trim() ?? "";
  if (input.templateId) {
    const template = getSystemTemplate(input.kind, input.templateId);
    if (!template) {
      throw new GateViolation(
        `未知のテンプレです: ${input.kind}/${input.templateId}`,
      );
    }
    return trimmed || template.content;
  }
  if (trimmed) {
    return trimmed;
  }
  throw new GateViolation("templateId または content が必要です");
}
