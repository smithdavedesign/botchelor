import { Fragment, type ReactNode } from "react";

/**
 * A translated sentence whose `{slots}` hold React nodes (a face, a link, a code word), so the sentence's word order is
 * the language's own (docs/i18n.md): `fillNodes(t("{lead} gave the final rose to {winner}"), { lead: <Who …/>, winner: … })`.
 * A slot with no node is left as written.
 */
export function fillNodes(text: string, nodes: Readonly<Record<string, ReactNode>>): ReactNode {
  return text.split(/(\{\w+\})/g).map((part, i) => {
    const slot = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{slot && slot in nodes ? nodes[slot] : part}</Fragment>;
  });
}
