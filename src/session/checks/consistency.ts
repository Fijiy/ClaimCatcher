// Stage 5, the consistency rule (code, not the model): a True or False label
// whose own conclusion ONLY says evidence is missing becomes Unverified, so
// the label never contradicts its explanation. A conclusion that also says
// what the sources show ("BLS data confirm X, though the cause is unclear";
// "no evidence of a doubling; police data show a 4% rise") keeps its label.
// Ported from the local-mode prototype (prototype/local-mode-eval, prompt.js
// `consistency`), narrowed to that "only".

import type { Label } from '../types';

/** A part of the conclusion saying the evidence is missing or doesn't settle it. */
const WEAK = new RegExp(
  '\\b(?:' +
    [
      'not supported',
      'unsupported',
      'no (?:evidence|source|data|record|mention)s?',
      'lack of evidence',
      'not (?:enough|sufficient)',
      'insufficient',
      "(?:does|do|did)(?: not|n't) (?:mention|address|provide|confirm|support|show|establish|say|cover|include)",
      "(?:cannot|can't|could not|couldn't) be (?:confirmed|verified|determined|found)",
      '(?:impossible|unable) to (?:verify|confirm|determine|tell)',
      'not (?:in|found|mentioned|addressed|covered|given)\\b',
      'silent',
      'absent',
      'unclear',
    ].join('|') +
    ')',
  'i',
);
/**
 * A part of the conclusion saying what the sources show, for or against the
 * claim: a verb of finding or reporting, or a measured change. Bare "is",
 * "was", "true" or "correct" don't count: "it is impossible to verify" says
 * nothing the sources show.
 */
const FINDING =
  /\b(confirm|show|support|back|prove|demonstrat|indicat|reveal|report|find|found|give|gave|match|record|list|contradict|refute|debunk|rose|fell|grew|increas|decreas|declin)\w*/i;
/** Where a conclusion's parts meet: punctuation, or a word joining two statements. */
const PARTS = /[,;:.!?]|\b(?:but|though|although|while|whereas|however|yet|so)\b/i;

export function applyConsistencyRule(label: Label, conclusion: string): Label {
  if (label !== 'True' && label !== 'False') return label;
  const parts = conclusion.split(PARTS).map((part) => part?.trim() ?? '').filter(Boolean);
  if (!parts.some((part) => WEAK.test(part))) return label;
  const saysWhatSourcesShow = parts.some((part) => !WEAK.test(part) && FINDING.test(part));
  return saysWhatSourcesShow ? label : 'Unverified';
}
