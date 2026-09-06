import { FieldCaption } from "./FieldCaption.js";

export type SystemTemplateItem = {
  id: string;
  kind: "project_rule" | "thread_template";
  title: string;
  summary: string;
  content: string;
};

export function TemplatePicker(props: {
  label: string;
  templates: SystemTemplateItem[];
  templateId: string;
  onSelect: (templateId: string, content: string) => void;
  emptyLabel: string;
  requirement?: "required" | "optional";
}) {
  return (
    <label>
      {props.requirement ? (
        <FieldCaption required={props.requirement === "required"}>
          {props.label}
        </FieldCaption>
      ) : (
        props.label
      )}
      <select
        value={props.templateId}
        onChange={(event) => {
          const id = event.target.value;
          const template = props.templates.find((item) => item.id === id);
          props.onSelect(id, template?.content ?? "");
        }}
        required={props.requirement === "required"}
      >
        <option value="">{props.emptyLabel}</option>
        {props.templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.title}
          </option>
        ))}
      </select>
      {props.templateId ? (
        <span className="hint muted">
          {props.templates.find((item) => item.id === props.templateId)?.summary}
        </span>
      ) : null}
    </label>
  );
}
