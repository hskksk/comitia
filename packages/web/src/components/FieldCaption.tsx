export function FieldCaption(props: {
  children: string;
  required?: boolean;
}) {
  return (
    <span className="field-caption">
      {props.children}
      <span
        className={
          props.required ? "field-mark is-required" : "field-mark is-optional"
        }
      >
        {props.required ? "必須" : "任意"}
      </span>
    </span>
  );
}
