// Work-file paths: a workspace stores each module's work file per notation, under keys like
// 'syntax1/derivation.rec' (the server's WORK_PATH_PATTERN). The file names are the
// desktop's readable work files (DataFiles.WORK_FILES).

export type Notation = 1 | 2;

export type ModuleId = 'derivation' | 'truth-tables' | 'invalidity' | 'parsing' | 'symbolization' | 'recognition';

export interface WorkFileInfo {
  /** The readable file name, e.g. 'derivation.rec'. */
  file: string;
  /** The desktop's internal (older-format) name, e.g. 'derwork.txt'. */
  internal: string;
  /** The module the file belongs to. */
  module: ModuleId;
  title: string;
}

/** Every work file, in the order of DataFiles.WORK_FILES. */
export const WORK_FILES: readonly WorkFileInfo[] = [
  { file: 'derivation.rec', internal: 'derwork.txt', module: 'derivation', title: 'Derivation work' },
  { file: 'invalidity.rec', internal: 'invwork.txt', module: 'invalidity', title: 'Invalidity work' },
  { file: 'parsing.rec', internal: 'parwork.txt', module: 'parsing', title: 'Parsing work' },
  { file: 'recognition.rec', internal: 'recwork.txt', module: 'recognition', title: 'Rule-recognition work' },
  { file: 'symbolization.rec', internal: 'symwork.txt', module: 'symbolization', title: 'Symbolization work' },
  { file: 'truth-tables.rec', internal: 'truwork.txt', module: 'truth-tables', title: 'Truth-table work' },
  {
    file: 'symbolization-answers.rec',
    internal: 'keywork.txt',
    module: 'symbolization',
    title: 'Answer keys for your own symbolization problems',
  },
];

export const WORK_PATH_PATTERN = /^syntax([12])\/([a-z-]+\.rec)$/;

export function workPath(notation: Notation, file: string): string {
  return `syntax${notation}/${file}`;
}

export function parseWorkPath(path: string): { notation: Notation; file: string } | null {
  const m = WORK_PATH_PATTERN.exec(path);
  return m ? { notation: Number(m[1]) as Notation, file: m[2] } : null;
}

export function workFileInfo(file: string): WorkFileInfo | undefined {
  return WORK_FILES.find((w) => w.file === file);
}

export function isNotation(n: unknown): n is Notation {
  return n === 1 || n === 2;
}
