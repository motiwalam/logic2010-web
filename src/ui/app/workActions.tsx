// Actions on work files: import (.rec, older .txt, or .zip), export (one file, or all as a
// zip), start over, and fork someone else's work. Each asks before replacing anything.

import { parseWorkPath, workPath, WORK_FILES, type ModuleId, type Notation } from '../../workspace/paths';
import type { WorkSource } from '../../workspace/source';
import { download, exportZip, exportZipName, forkChanges, planImport, readUploads, resetChanges } from '../../workspace/transfer';
import type { WorkspaceStore } from '../../workspace/WorkspaceStore';
import { dialogs } from '../dialogs/dialogs';
import { describePath } from './accountFlows';

/** Opens the file picker; resolves the chosen files (empty if cancelled). */
export function pickFiles(accept = '.rec,.txt,.zip'): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = accept;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/**
 * Imports work files into the notation. `only` restricts to one module's files (the module
 * page's Import). Returns whether anything was imported.
 */
export async function importFlow(store: WorkspaceStore, own: WorkSource, notation: Notation, files?: File[], only?: ModuleId): Promise<boolean> {
  const chosen = files ?? (await pickFiles());
  if (chosen.length === 0) return false;
  let uploads;
  try {
    uploads = await readUploads(chosen);
  } catch (err) {
    await dialogs.message({ title: 'The file could not be read', text: err instanceof Error ? err.message : String(err), isError: true, expanded: true });
    return false;
  }
  const plan = planImport(uploads, notation, own);
  if (only) {
    for (const item of plan.items.filter((i) => i.detected.info.module !== only)) {
      plan.rejected.push({ source: item.source, reason: `This is ${item.detected.info.title.toLowerCase()}; import it from Settings or that module.` });
    }
    plan.items = plan.items.filter((i) => i.detected.info.module === only);
  }
  if (plan.items.length === 0) {
    await dialogs.message({
      title: 'Nothing to import',
      text: plan.rejected.map((r) => `${r.source}: ${r.reason}`).join('\n') || 'No work files were chosen.',
      isError: true,
      expanded: true,
    });
    return false;
  }
  const replacing = plan.items.filter((i) => i.replaces);
  const ok = await dialogs.confirm({
    title: replacing.length > 0 ? 'Replace your work?' : 'Import work?',
    body: (
      <>
        <p>These files will be imported into notation {notation}:</p>
        <ul className="plain-list">
          {plan.items.map((i) => (
            <li key={i.path}>
              <strong>{i.detected.info.title}</strong> from {i.source}
              {i.replaces ? ' — replaces your current work' : ''}
              {!i.digestOk && <div className="field-error">Its digest does not match its records (edited by hand?): the module will refuse it, as the desktop program does.</div>}
            </li>
          ))}
        </ul>
        {plan.rejected.length > 0 && (
          <>
            <p>Not imported:</p>
            <ul className="plain-list muted">
              {plan.rejected.map((r) => (
                <li key={r.source}>
                  {r.source}: {r.reason}
                </li>
              ))}
            </ul>
          </>
        )}
        {replacing.length > 0 && <p className="muted small">Replaced work is kept under Settings › Earlier copies.</p>}
      </>
    ),
    confirmLabel: replacing.length > 0 ? 'Replace and import' : 'Import',
    danger: replacing.length > 0,
  });
  if (!ok) return false;
  store.replaceFiles(Object.fromEntries(plan.items.map((i) => [i.path, i.text])), 'Replaced by an imported file');
  dialogs.notify(`Imported ${plan.items.map((i) => i.detected.info.title.toLowerCase()).join(', ')}.`, { tone: 'success' });
  return true;
}

/** Downloads one module's work file(s). */
export function exportModule(source: WorkSource, notation: Notation, module: ModuleId): void {
  const files = WORK_FILES.filter((w) => w.module === module);
  let n = 0;
  for (const w of files) {
    const text = source.getFile(workPath(notation, w.file));
    if (text != null) {
      download(w.file, text, 'text/plain;charset=utf-8');
      n++;
    }
  }
  if (n === 0) dialogs.notify('There is no work to export yet.', { tone: 'info' });
}

/** Downloads all of a notation's work as a zip. */
export function exportAll(source: WorkSource, notation: Notation): void {
  if (!source.paths().some((p) => parseWorkPath(p)?.notation === notation)) {
    dialogs.notify(`There is no work in notation ${notation} to export yet.`, { tone: 'info' });
    return;
  }
  download(exportZipName(notation, source.ownerName), exportZip(source, notation), 'application/zip');
}

/** Starts over: deletes the notation's work (or one module's), after confirmation. */
export async function resetFlow(store: WorkspaceStore, own: WorkSource, notation: Notation, module?: ModuleId): Promise<boolean> {
  const files = module ? WORK_FILES.filter((w) => w.module === module).map((w) => w.file) : undefined;
  const changes = resetChanges(own, notation, files);
  const paths = Object.keys(changes);
  if (paths.length === 0) {
    dialogs.notify('There is no work to delete.', { tone: 'info' });
    return false;
  }
  const ok = await dialogs.confirm({
    title: module ? 'Start this module over?' : `Start over in notation ${notation}?`,
    body: (
      <>
        <p>This deletes your work in:</p>
        <ul className="plain-list">
          {paths.map((p) => (
            <li key={p}>{describePath(p)}</li>
          ))}
        </ul>
        <p className="muted small">A copy is kept under Settings › Earlier copies until newer copies push it out. Export your work first if you want to keep it.</p>
      </>
    ),
    confirmLabel: 'Delete my work',
    danger: true,
  });
  if (!ok) return false;
  store.replaceFiles(changes, 'Deleted when starting over');
  dialogs.notify('Your work was deleted. You are starting fresh.', { tone: 'info' });
  return true;
}

/** Copies someone's work into yours, after confirmation. */
export async function forkFlow(store: WorkspaceStore, own: WorkSource, from: WorkSource, notation: Notation): Promise<boolean> {
  const hasOther = from.paths().some((p) => parseWorkPath(p)?.notation !== notation);
  const scope = hasOther
    ? await dialogs.choose<'one' | 'all'>({
        title: `Fork ${from.ownerName}'s work`,
        prompt: `${from.ownerName} has work in both notations.`,
        choices: [
          { value: 'one', label: `Notation ${notation} only` },
          { value: 'all', label: 'Both notations' },
        ],
      })
    : 'one';
  if (scope == null) return false;
  const changes = forkChanges(from, scope === 'all' ? 'all' : notation);
  const paths = Object.keys(changes);
  if (paths.length === 0) {
    dialogs.notify(`${from.ownerName} has no work to fork in notation ${notation}.`, { tone: 'info' });
    return false;
  }
  const replaced = paths.filter((p) => own.getFile(p) != null);
  const ok = await dialogs.confirm({
    title: `Copy ${from.ownerName}'s work into yours?`,
    body: (
      <>
        <ul className="plain-list">
          {paths.map((p) => (
            <li key={p}>
              {describePath(p)}
              {own.getFile(p) != null ? ' — replaces your work' : ''}
            </li>
          ))}
        </ul>
        <p className="muted small">Modules they have no work in keep yours. {replaced.length > 0 ? 'Replaced work is kept under Settings › Earlier copies.' : ''}</p>
      </>
    ),
    confirmLabel: replaced.length > 0 ? 'Replace and fork' : 'Fork',
    danger: replaced.length > 0,
  });
  if (!ok) return false;
  store.replaceFiles(changes, `Replaced by forking ${from.ownerName}'s work`);
  dialogs.notify(`${from.ownerName}'s work is now in your workspace.`, { tone: 'success' });
  return true;
}

