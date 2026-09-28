/**
 * The Recognition module's records. Port of the static record methods of LPRecognition.java
 * and RecognitionProblemPanel.parseRuleList.
 *
 * A recognition problem or work line:
 *   $name  =argument ("P . Q .: R")  @correct rules (R1.R2)  ~near-miss rules  &success comment
 *   *the student's answer  e errors  t seconds
 */
import { TaggedRecord } from '../../data/TaggedRecord';
import { DelimitedTokenizer } from '../../util/DelimitedTokenizer';
import { javaTrim } from '../../util/java';

export const workFileName = 'recwork.txt';
export const logFileName = 'recdata.txt';

export function getProblemStatement(record: TaggedRecord | string | null): string | null {
  const t = record instanceof TaggedRecord ? record : new TaggedRecord(record);
  return t.valueAt(t.indexOfAnyTag('='));
}

export function hasWork(record: TaggedRecord | string | null): boolean {
  const t = record instanceof TaggedRecord ? record : new TaggedRecord(record);
  return t.indexOfTag('*') !== -1;
}

export function getWork(record: TaggedRecord): string {
  return record.formatFields('*');
}

/** LPRecognition.removeWork(TaggedRecord): the record without the student's answer. */
export function removeWork(record: TaggedRecord): string {
  return record.formatFields('$=@~&%u!');
}

/** RecognitionProblemPanel.parseRuleList: "MP.MT" as upper-case names; null if none. */
export function parseRuleList(s: string | null): string[] | null {
  if (s == null) return null;
  const out: string[] = [];
  const tokens = new DelimitedTokenizer('\\.');
  tokens.setInput(s);
  let t: string | null;
  while ((t = tokens.nextToken()) != null) {
    if ((t = javaTrim(t)).length !== 0) out.push(t.toUpperCase());
  }
  return out.length === 0 ? null : out;
}

/** LPRecognition.nameVersion: the course database's version column for a problem name. */
export function nameVersion(s: string | null): string {
  return s != null && s.toLowerCase().startsWith('recog') ? '1' : 'NULL';
}
