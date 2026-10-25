import type { AvatarDocument, Op } from '@vexstudio/format';

export interface QuestionOption {
  id: string;
  label: string;
  detail: string;
  /** What choosing this option changes: the editor previews it before the person answers. */
  ops: Op[];
}

/**
 * A question is only asked when the answer changes the result visibly, cannot be deduced from
 * the image or the request, and the default would probably be wrong.
 */
export interface Question {
  id: string;
  text: string;
  why: string;
  options: QuestionOption[];
  recommended: string;
}

export interface Proposal {
  /** What the assistant did and why, one line per decision. */
  summary: string[];
  /** A complete draft: already applies the recommended option of every open question. */
  ops: Op[];
  questions: Question[];
  confidence: number;
  provider: string;
}

export interface AssistantInput {
  doc: AvatarDocument;
  message: string;
  /** Answers to earlier questions: question id → option id. */
  answers: Record<string, string>;
}

export interface Assistant {
  readonly name: string;
  propose(input: AssistantInput, signal?: AbortSignal): Promise<Proposal>;
}
