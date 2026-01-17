import { ComponentProps } from "react";
import Form from "@rjsf/core";
import { RJSFSchema, UiSchema, WidgetProps, FieldTemplateProps, SubmitButtonProps, IconButtonProps } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";

export interface SchemaFormProps extends Omit<ComponentProps<typeof Form>, "validator"> {
  schema: RJSFSchema;
  uiSchema?: UiSchema;
}

// --- Templates ---

function FieldTemplate(props: FieldTemplateProps) {
  const { id, label, children, errors, help, description, hidden, required, displayLabel } = props;
  if (hidden) return <div className="hidden">{children}</div>;

  return (
    <div className={cn("space-y-2 mb-4", props.classNames)}>
      {displayLabel && (
        <Label htmlFor={id} className={errors && (errors as any).length > 0 ? "text-destructive" : ""}>
          {label} {required ? <span className="text-destructive">*</span> : null}
        </Label>
      )}
      {children}
      {description}
      {errors}
      {help}
    </div>
  );
}

function ErrorListTemplate(props: any) {
  const { errors } = props;
  return (
    <ul className="text-sm font-medium text-destructive space-y-1">
      {errors.map((error: any, i: number) => (
        <li key={i}>{error.stack}</li>
      ))}
    </ul>
  );
}

// --- Widgets ---

const BaseInputWidget = (props: WidgetProps) => {
  return (
    <Input
      id={props.id}
      value={props.value || ""}
      placeholder={props.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readonly}
      type={props.type}
      onChange={(event) => props.onChange(event.target.value === "" ? props.options.emptyValue : event.target.value)}
      onBlur={() => props.onBlur(props.id, props.value)}
      onFocus={() => props.onFocus(props.id, props.value)}
    />
  );
};

const TextareaWidget = (props: WidgetProps) => {
  return (
    <Textarea
      id={props.id}
      value={props.value || ""}
      placeholder={props.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readonly}
      onChange={(event) => props.onChange(event.target.value === "" ? props.options.emptyValue : event.target.value)}
      onBlur={() => props.onBlur(props.id, props.value)}
      onFocus={() => props.onFocus(props.id, props.value)}
    />
  );
};

const CheckboxWidget = (props: WidgetProps) => {
  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        id={props.id}
        checked={props.value}
        disabled={props.disabled || props.readonly}
        onCheckedChange={(checked) => props.onChange(checked)}
      />
      <label
        htmlFor={props.id}
        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        {props.label}
      </label>
    </div>
  );
};

const SelectWidget = (props: WidgetProps) => {
  const { options, value, onChange, disabled, readonly, placeholder } = props;
  const enumOptions = options.enumOptions || [];

  return (
    <Select
      value={value ? String(value) : undefined}
      onValueChange={(val) => onChange(val)}
      disabled={disabled || readonly}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder || "Select..."} />
      </SelectTrigger>
      <SelectContent>
        {enumOptions.map((option: any, i: number) => (
          <SelectItem key={i} value={String(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

// --- Buttons ---

function SubmitButton(props: SubmitButtonProps) {
  return (
    <div className="flex justify-end pt-4">
      <Button type="submit" variant="default">
        {props.uiSchema?.["ui:submitButtonOptions"]?.submitText || "Submit"}
      </Button>
    </div>
  );
}

function AddButton(props: IconButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full mt-2"
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <Plus className="mr-2 h-4 w-4" /> Add Item
    </Button>
  );
}

function RemoveButton(props: IconButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-destructive hover:text-destructive/90 hover:bg-destructive/10"
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function MoveUpButton(props: IconButtonProps) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={props.onClick}
        disabled={props.disabled}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
    );
}

function MoveDownButton(props: IconButtonProps) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={props.onClick}
        disabled={props.disabled}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
    );
}


const widgets = {
  TextWidget: BaseInputWidget,
  TextareaWidget: TextareaWidget,
  CheckboxWidget: CheckboxWidget,
  SelectWidget: SelectWidget,
};

const templates = {
  FieldTemplate,
  ErrorListTemplate,
  ButtonTemplates: {
    SubmitButton,
    AddButton,
    RemoveButton,
    MoveUpButton,
    MoveDownButton
  },
};

export function SchemaForm(props: SchemaFormProps) {
  return (
    <Form
      validator={validator}
      widgets={widgets}
      templates={templates}
      showErrorList={false}
      noHtml5Validate
      {...props}
    />
  );
}
