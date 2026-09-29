/**
 * The non-UI parts of the module framework: reading problem files into a ProblemSet,
 * writing the student's work with its digest, and the modules' common readExercises /
 * readWork. Port of LogicModule.readProblems / writeProblems / writeExercises and of the
 * pattern every LPxxx.readExercises / readWork / getProblems follows.
 */
import * as DataFiles from '../data/DataFiles';
import { ScrambledReader } from '../data/Scrambler';
import { TaggedRecord } from '../data/TaggedRecord';
import { openDataFile, openLocalFile, openProblemFile, options } from '../program/LogicProgram';
import type { UserInfo } from '../program/UserInfo';
import { javaTrim } from '../util/java';
import { ProblemEntry, type ProblemNameSet } from './ProblemEntry';
import type { ProblemSet } from './ProblemSet';
import { isExcludedProblem, withoutBlueBookHeadings } from './excludedProblems';

/**
 * LogicModule.readProblems: reads the lines of a problem or work file into the set.
 * exercises (a course file): `#-` lines are collected as headings of the next problem.
 * Any other `#` line (and, when not exercises, a `#-` line too) sets the stored digest, so
 * the last one wins. sorted (a local file merged into the course's): problems are inserted
 * in name order, duplicates rejected.
 *
 * Problems excluded by the web program (excludedProblems.ts) are left out and kept aside
 * in set.excludedRecords.
 *
 * (With the `debug` option the desktop also prints the argument errors of each exercise;
 * that diagnostic output is left out.)
 */
export function readProblems(reader: ScrambledReader, set: ProblemSet, exercises: boolean, sorted: boolean): boolean {
  if (exercises && set.headingsByName == null) set.headingsByName = new Map();
  let headings: string[] | null = null;
  let s: string | null;
  while ((s = reader.readLine()) != null) {
    if (TaggedRecord.isBlankOrComment(s)) {
      if (exercises && s.indexOf('#-') === 0) {
        if (headings == null) headings = [];
        headings.push(s.substring(2));
      } else if (s.indexOf('#') === 0) {
        set.storedDigest = javaTrim(s.substring(1));
      }
    } else if (isExcludedProblem(s)) {
      // left out by the web program (excludedProblems.ts), with its Blue Book headings
      set.excludeRecord(s);
      headings = withoutBlueBookHeadings(headings);
    } else if (set.addProblem(s, headings, sorted) !== -1) {
      headings = null;
    }
  }
  reader.close();
  return true;
}

/** The result of writeProblems: the work file's readable name and text. */
export interface WrittenWork {
  fileName: string;
  text: string;
  digest: string;
}

/**
 * LogicModule.writeProblems: the module's work file (readable format), with the digest of
 * its records for the user. Like the desktop it first sets the user's digest version for
 * the module to "1" (the caller saves the user if it keeps it).
 */
export function writeProblems(set: ProblemSet, workFileName: string, user: UserInfo): WrittenWork {
  const key = set.getDigestVersKey();
  if (user.getField(key, '') !== '1') user.put(key, '1');
  // the digest covers the records as they will be read back from the saved file
  const records = DataFiles.canonicalRecords(set.allRecords(), DataFiles.schemaForKey(workFileName));
  const digest = user.computeDigest(records, user.get(key));
  return {
    fileName: DataFiles.workFileName(workFileName) ?? workFileName,
    text: DataFiles.writeWork(workFileName, records, digest),
    digest,
  };
}

/** LogicModule.writeExercises: the set as legacy lines, with each problem's `#-` headings. */
export function writeExercises(set: ProblemSet | null, lineSeparator = '\n'): string {
  if (set == null) return '';
  let out = '';
  for (const entry of set.elements()) {
    const name = TaggedRecord.nameOf(entry.name);
    const headings = set.headingsByName != null && name != null ? set.headingsByName.get(name) : undefined;
    for (const h of headings ?? []) out += '#-' + h + lineSeparator;
    out += entry.name + lineSeparator;
  }
  return out;
}

export interface ReadExercisesOptions {
  /** Leave out the course file (LogicProgram.noCoreProblems by default). */
  noCore?: boolean;
  /** Leave out the local file. */
  noLocal?: boolean;
  /** Read the local file from the edit directory. */
  edit?: boolean;
}

/**
 * LPxxx.readExercises: the course problems (`ruleDir/<file>`) and the instructor's local
 * additions (`local/<file>`, merged in name order) into set. key is the module's work file
 * key, e.g. "derwork.txt". Returns false where the desktop reports a file error.
 */
export async function readExercises(set: ProblemSet, key: string, opts: ReadExercisesOptions = {}): Promise<boolean> {
  const noCore = opts.noCore ?? options.noCoreProblems;
  if (!noCore) {
    const reader = await openDataFile(key);
    if (reader == null) return false;
    readProblems(reader, set, true, false);
  }
  if (!opts.noLocal) {
    const local = await openLocalFile(key, opts.edit ?? false);
    if (local != null) readProblems(local, set, true, !noCore);
  }
  set.excludedRecords = [];
  return true;
}

/** A work file's contents: its name ("derivation.rec", or legacy "derwork.txt") and text. */
export interface WorkFile {
  fileName: string;
  text: string;
}

/**
 * LPxxx.readWork: the student's work, or (when there is none yet) the course problems plus
 * the local ones, as the desktop's first start does. Work read from a work file has
 * readFromPlainFile set, so its digest must be checked (verifyDigest).
 */
export async function readWork(set: ProblemSet, key: string, work: WorkFile | null): Promise<boolean> {
  if (work != null) {
    set.readFromPlainFile = true;
    readProblems(DataFiles.openWorkText(work.fileName, work.text, key), set, false, false);
    return true;
  }
  if (!options.noCoreProblems) {
    const reader = await openDataFile(key);
    if (reader == null) return false;
    readProblems(reader, set, false, false);
  }
  const local = await openLocalFile(key);
  if (local != null) readProblems(local, set, false, true);
  set.excludedRecords = []; // course problems, not the student's work: nothing to keep
  return true;
}

export interface DigestCheck {
  /** False when the work file's records do not match its digest ("Could not digest file"). */
  ok: boolean;
  stored: string | null;
  computed: string;
}

/**
 * The desktop's check in LPxxx.getProblems: work read from a work file must carry the digest
 * of its records for the user; otherwise the module refuses it (not003) unless the user is
 * an instructor.
 */
export function verifyDigest(set: ProblemSet, user: UserInfo): DigestCheck {
  const computed = set.computeDigest(user);
  return { ok: !set.readFromPlainFile || computed === set.storedDigest, stored: set.storedDigest, computed };
}

/**
 * ProblemEntry.findExtraProblems(key, set): the names of the set's problems that are in
 * neither the course nor the local problem file (database or user problems), marking them.
 */
export async function findExtraProblems(key: string, set: ProblemSet): Promise<ProblemNameSet> {
  let names: ProblemNameSet | null = null;
  for (const local of [false, true]) {
    const reader = await openProblemFile(key, local);
    if (reader != null) names = ProblemEntry.readProblemNames(reader.readAll(), names);
  }
  return ProblemEntry.findExtraProblems(set, names);
}
