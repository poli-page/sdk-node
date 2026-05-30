// Minimal TypeDoc 0.27 JSON shape — just the fields the extractor reads.
// TypeDoc kinds (numeric, from its ReflectionKind enum):
//   Project = 1, Module = 2, Function = 64, Class = 128, Interface = 256,
//   Constructor = 512, Property = 1024, Method = 2048,
//   CallSignature = 4096, Parameter = 32768.

export interface TdNode {
  readonly id: number;
  readonly name: string;
  readonly kind: number;
  readonly comment?: TdComment;
  readonly children?: readonly TdNode[];
  readonly signatures?: readonly TdSignature[];
  readonly type?: TdType;
  readonly sources?: readonly { fileName: string; line: number; url?: string }[];
  readonly flags?: TdFlags;
}

export interface TdSignature {
  readonly id: number;
  readonly name: string;
  readonly kind: number;
  readonly comment?: TdComment;
  readonly parameters?: readonly TdParameter[];
  readonly type?: TdType;
}

export interface TdParameter {
  readonly id: number;
  readonly name: string;
  readonly type?: TdType;
  readonly flags?: TdFlags;
  readonly comment?: TdComment;
}

export interface TdComment {
  readonly summary?: readonly TdCommentPart[];
  readonly blockTags?: readonly { tag: string; content?: readonly TdCommentPart[] }[];
}

export interface TdCommentPart {
  readonly kind: 'text' | 'code' | 'inline-tag';
  readonly text: string;
}

export interface TdFlags {
  readonly isOptional?: boolean;
  readonly isReadonly?: boolean;
}

export type TdType =
  | { type: 'reference'; name: string; target?: number; package?: string; typeArguments?: TdType[] }
  | { type: 'intrinsic'; name: string }
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'union'; types: TdType[] }
  | { type: 'intersection'; types: TdType[] }
  | { type: 'array'; elementType: TdType }
  | { type: 'tuple'; elements?: TdType[] }
  | { type: 'reflection'; declaration?: TdNode }
  | { type: string; name?: string };

/** Render a TdType as a human-readable TypeScript string. */
export function renderTdType(t: TdType | undefined): string {
  if (!t) return 'unknown';
  switch (t.type) {
    case 'reference': {
      const args = (t.typeArguments ?? []).map(renderTdType);
      return args.length > 0 ? `${t.name}<${args.join(', ')}>` : t.name;
    }
    case 'intrinsic':
      return t.name;
    case 'literal':
      return JSON.stringify(t.value);
    case 'union':
      return t.types.map(renderTdType).join(' | ');
    case 'intersection':
      return t.types.map(renderTdType).join(' & ');
    case 'array':
      return `${renderTdType(t.elementType)}[]`;
    case 'tuple':
      return `[${(t.elements ?? []).map(renderTdType).join(', ')}]`;
    case 'reflection':
      return 'object';
    default:
      return (t as { name?: string }).name ?? t.type;
  }
}

/** Flatten a comment summary into plain text. */
export function summaryText(c: TdComment | undefined): string {
  if (!c?.summary) return '';
  return c.summary
    .map((p) => (p.kind === 'code' ? p.text.replace(/^`|`$/g, '') : p.text))
    .join('')
    .trim();
}

/** First sentence of a summary — used for descriptions and ledes. */
export function firstSentence(s: string): string {
  const trimmed = s.replace(/\n+/g, ' ').trim();
  const dot = trimmed.indexOf('. ');
  return dot === -1 ? trimmed : trimmed.slice(0, dot + 1);
}

/** Depth-first find. */
export function findFirst(node: TdNode | undefined, pred: (n: TdNode) => boolean): TdNode | undefined {
  if (!node) return undefined;
  if (pred(node)) return node;
  for (const child of node.children ?? []) {
    const found = findFirst(child, pred);
    if (found) return found;
  }
  return undefined;
}

export function findAll(node: TdNode, pred: (n: TdNode) => boolean, out: TdNode[] = []): TdNode[] {
  if (pred(node)) out.push(node);
  for (const child of node.children ?? []) findAll(child, pred, out);
  return out;
}

export const KIND = {
  Project: 1,
  Module: 2,
  Function: 64,
  Class: 128,
  Interface: 256,
  Constructor: 512,
  Property: 1024,
  Method: 2048,
  CallSignature: 4096,
  Parameter: 32768,
} as const;
