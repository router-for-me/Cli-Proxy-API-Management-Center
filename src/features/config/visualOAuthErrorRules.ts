import { isMap, isSeq, parseDocument } from 'yaml';
import {
  buildErrorRules,
  readErrorRules,
  validateErrorRule,
} from '@/features/providers/errorRules';
import { assertConfigListsUnchanged } from '@/services/api/configPatch';
import { normalizeErrorRule, serializeErrorRule } from '@/services/api/errorRules';
import type { OAuthChannelRules } from '@/types/visualConfig';
import { isRecord } from '@/utils/helpers';

const root = ['oauth', 'request-scoped-errors'];

export function readOAuthErrorRules(raw: unknown): OAuthChannelRules[] {
  if (!isRecord(raw)) return [];
  return Object.entries(raw).flatMap(([channel, list]) =>
    Array.isArray(list)
      ? [
          {
            channel,
            rules: readErrorRules(
              list.map((rule) => normalizeErrorRule(isRecord(rule) ? rule : {}))
            ),
          },
        ]
      : []
  );
}

export const invalidOAuthChannel = (groups: OAuthChannelRules[]) =>
  groups.find(({ rules }) => rules.some((rule) => validateErrorRule(rule, true)))?.channel;

export function writeOAuthErrorRules(
  doc: ReturnType<typeof parseDocument>,
  baseline: OAuthChannelRules[],
  desired: OAuthChannelRules[],
  sourceYaml: string,
  serverYaml: string,
  guard: boolean
) {
  const source = parseDocument(sourceYaml);
  const channels = new Set([...baseline, ...desired].map((group) => group.channel));
  const paths: string[][] = [];
  const latestYaml = doc.toString();
  for (const channel of channels) {
    const before = baseline.find((group) => group.channel === channel);
    const after = desired.find((group) => group.channel === channel);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const path = [...root, channel];
    paths.push(path);
    if (!after) {
      doc.deleteIn(path);
      continue;
    }
    // IDs refer to the retained source (the merged draft after recovery), not the latest list.
    // Move original nodes with their rules so reordering preserves extra fields and comments.
    const old = source.getIn(path, true);
    const seq = isSeq(old) ? old : source.createNode([]);
    const originals = [...seq.items];
    const built = buildErrorRules(after.rules);
    seq.items = after.rules.map((rule, i) => {
      const node = rule.sourceIndex === undefined ? undefined : originals[rule.sourceIndex];
      const next = serializeErrorRule(built[i]);
      if (!isMap(node) || !rule.original) return source.createNode(next);
      const previous = serializeErrorRule(rule.original);
      for (const key of Object.keys(next) as (keyof typeof next)[]) {
        if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
          node.set(key, source.createNode(next[key]));
        }
      }
      return node;
    });
    for (let i = 1; i <= root.length; i++) {
      const parent = root.slice(0, i);
      if (!isMap(doc.getIn(parent, true))) doc.setIn(parent, doc.createNode({}));
    }
    doc.setIn(path, seq);
  }
  if (guard && paths.length)
    assertConfigListsUnchanged(serverYaml, doc.toString(), latestYaml, paths);
}
