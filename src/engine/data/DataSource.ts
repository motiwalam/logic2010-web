/**
 * Where the engine reads the course data files (the data/ directory: links.conf,
 * options.rec, messages/, syntax1/, syntax2/, local/, ...). Paths are relative to data/,
 * with forward slashes, e.g. "syntax1/rules.list".
 *
 * The desktop program reads these from its Contents/Resources directory; in the browser
 * they are fetched from <base>/data/, and in tests they are read from the repository.
 */
export interface DataSource {
  /** The file's text, or null if there is no such file. */
  readText(path: string): Promise<string | null>;
}

/** Fetches data files over HTTP from baseUrl (e.g. "/logic2010/data/"). */
export class HttpDataSource implements DataSource {
  constructor(private readonly baseUrl: string) {}

  async readText(path: string): Promise<string | null> {
    const response = await fetch(this.baseUrl + path);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`could not read ${path}: HTTP ${response.status}`);
    return response.text();
  }
}
