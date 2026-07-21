// Tiny DOM helpers so the rest of the UI can build elements declaratively without a framework.
// No dependencies, no JSX — just typed wrappers around document.createElement.

export interface ElProps {
  class?: string;
  text?: string;
  title?: string;
  type?: string;
  placeholder?: string;
  value?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: (ev: MouseEvent) => void;
  onInput?: (ev: Event) => void;
  onChange?: (ev: Event) => void;
  onKeyDown?: (ev: KeyboardEvent) => void;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
}

/** Create an element with common props and children (nodes or strings). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class != null) node.className = props.class;
  if (props.text != null) node.textContent = props.text;
  if (props.title != null) node.title = props.title;
  if (props.type != null) (node as unknown as { type: string }).type = props.type;
  if (props.placeholder != null) {
    (node as unknown as { placeholder: string }).placeholder = props.placeholder;
  }
  if (props.value != null) (node as unknown as { value: string }).value = props.value;
  if (props.selected != null) {
    (node as unknown as { selected: boolean }).selected = props.selected;
  }
  if (props.disabled != null) {
    (node as unknown as { disabled: boolean }).disabled = props.disabled;
  }
  if (props.onClick) node.addEventListener("click", props.onClick as EventListener);
  if (props.onInput) node.addEventListener("input", props.onInput);
  if (props.onChange) node.addEventListener("change", props.onChange);
  if (props.onKeyDown) node.addEventListener("keydown", props.onKeyDown as EventListener);
  if (props.dataset) {
    for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v;
  }
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

/** Remove all children from a node. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}
