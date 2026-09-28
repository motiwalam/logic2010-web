// The page of a module whose screen is not registered yet: its course problems can be
// browsed (read from the problem file with the engine's list model), with the help documents.

import { useEffect, useMemo, useRef, useState } from 'react';
import { TaggedRecord } from '../../engine/data/TaggedRecord';
import { readExercises } from '../../engine/problems/LogicModule';
import { ProblemListModel } from '../../engine/problems/ProblemList';
import { ProblemEntry, STATE_NO_WORK } from '../../engine/problems/ProblemEntry';
import { ProblemSet } from '../../engine/problems/ProblemSet';
import { javaTrim } from '../../engine/util/java';
import { ModuleLayout, ProblemHeader } from '../components/ModuleLayout';
import { MessageView } from '../components/MessageView';
import { nextProblem, ProblemList, type ProblemListHandle } from '../components/ProblemList';
import { Toolbar, ToolButton } from '../components/Toolbar';
import { listFromModel } from './problemRows';
import type { ModuleInfo, ModuleProps } from './registry';

class PreviewEntry extends ProblemEntry {
  computeState(): number {
    return STATE_NO_WORK;
  }
}

/** A problem set that only lists problems (no work, no checking). */
class PreviewProblemSet extends ProblemSet {
  constructor(private readonly info: ModuleInfo) {
    super();
  }
  getProblemStatement(record: TaggedRecord): string | null {
    const i = record.indexOfTag(this.info.statementTag);
    return i === -1 ? null : javaTrim(record.valueAt(i) ?? '');
  }
  hasWork(): boolean {
    return false;
  }
  getWork(): string | null {
    return null;
  }
  removeWork(): string | null {
    return null;
  }
  createEntry(record: string, unchecked: boolean): ProblemEntry {
    void unchecked;
    return new PreviewEntry(record, false, null);
  }
  getModuleIndex(): number {
    return this.info.index;
  }
  async restateProblems(): Promise<void> {}
}

export function PlaceholderModule({ info, props }: { info: ModuleInfo; props: ModuleProps }) {
  const [set, setSet] = useState<PreviewProblemSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<ProblemListHandle>(null);

  useEffect(() => {
    let live = true;
    const s = new PreviewProblemSet(info);
    readExercises(s, info.problemsKey)
      .then((ok) => {
        if (!live) return;
        if (!ok) setError('The problem file could not be read.');
        s.exercises = s;
        setSet(s);
      })
      .catch((err: unknown) => live && setError(String(err)));
    return () => {
      live = false;
    };
  }, [info]);

  const list = useMemo(() => (set ? listFromModel(new ProblemListModel(set, set, {}), set) : null), [set]);
  const index = set && props.problem ? set.indexOfName(props.problem) : -1;
  const record = set && index >= 0 ? new TaggedRecord(set.getRecordAt(index)) : null;
  const statement = record ? set!.getProblemStatement(record) : null;
  const note = record ? record.valueAt(record.indexOfTag('!')) : null;
  const go = (delta: number) => {
    if (!list) return;
    const n = nextProblem(list.rows, props.problem, delta);
    if (n) props.openProblem(n);
  };

  return (
    <ModuleLayout
      sidebar={
        list ? (
          <ProblemList ref={listRef} rows={list.rows} filter={list.filter} countLabel={list.countLabel} selected={props.problem} onOpen={(id) => props.openProblem(id)} />
        ) : (
          <p className="muted pad">{error ?? 'Loading problems…'}</p>
        )
      }
      header={
        <ProblemHeader
          name={record ? record.getName() : info.title}
          statement={statement == null ? undefined : info.id === 'symbolization' ? <p className="english">{statement}</p> : statement}
          note={note}
        />
      }
      toolbar={
        <Toolbar label="Problem">
          <ToolButton label="Select problem" shortcut="Mod+O" onClick={() => listRef.current?.focusSearch()} />
          <ToolButton label="Previous" shortcut="Alt+ArrowUp" onClick={() => go(-1)} />
          <ToolButton label="Next" shortcut="Alt+ArrowDown" altShortcuts={['Alt+N']} onClick={() => go(1)} />
        </Toolbar>
      }
      message={
        <MessageView
          message={{
            title: `The ${info.title.toLowerCase()} workspace is not available yet.`,
            text: 'You can browse the course problems and read the help documents. Work you import or fork for this module is kept, and will open here when the module is ready.',
            expanded: true,
          }}
          explain
        />
      }
    >
      <div className="placeholder-work">
        <p className="muted">{record ? 'Solving this problem will be possible here soon.' : 'Choose a problem from the list.'}</p>
      </div>
    </ModuleLayout>
  );
}
