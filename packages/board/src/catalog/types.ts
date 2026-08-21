import type { SharedArtifactKind } from "@comitia/shared";

export type SystemTemplateKind = Extract<
  SharedArtifactKind,
  "project_rule" | "thread_template"
>;

export type SystemTemplate = {
  id: string;
  kind: SystemTemplateKind;
  title: string;
  summary: string;
  content: string;
};
