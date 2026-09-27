// Typed client for the accounts/work API served by server/ (documented in server/README.md).
// Browser fetch with the session cookie; no React here.

/** A work file's key, e.g. 'syntax1/derivation.rec'. */
export type WorkPath = string;
export const WORK_PATH_PATTERN = /^syntax[12]\/[a-z-]+\.rec$/;

/** Progress figures the client computes for a work file (the server stores them as given). */
export interface WorkSummary {
  completed?: number;
  attempted?: number;
  total?: number;
  [key: string]: unknown;
}

export interface User {
  username: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  /** Last change to the user's work (createdAt if none). */
  updatedAt: string;
}

export interface WorkFileMeta {
  path: WorkPath;
  /** Increases with every change to any of the user's files; never reused. 0 means "no file". */
  version: number;
  updatedAt: string;
  summary: WorkSummary;
}

export interface WorkFile extends WorkFileMeta {
  content: string;
}

export interface UserListing extends User {
  files: WorkFileMeta[];
}

export interface UserWork {
  user: User;
  files: WorkFile[];
}

export interface Conflict {
  path: WorkPath;
  /** The server's current file, or null if it does not exist there. */
  current: WorkFile | null;
}

export interface FileUpload {
  path: WorkPath;
  content: string;
  summary?: WorkSummary;
  /** The version this change is based on (0 for a new file). Required unless `force`. */
  baseVersion?: number;
}

/** Error codes the server sends (plus 'network' for failed requests). */
export type ApiErrorCode =
  | 'network'
  | 'bad_json'
  | 'bad_path'
  | 'invalid_request'
  | 'invalid_username'
  | 'invalid_password'
  | 'invalid_path'
  | 'invalid_content'
  | 'invalid_summary'
  | 'invalid_base_version'
  | 'duplicate_path'
  | 'username_taken'
  | 'wrong_credentials'
  | 'wrong_password'
  | 'not_signed_in'
  | 'no_such_user'
  | 'conflict'
  | 'too_large'
  | 'file_too_large'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'missing_header'
  | 'unsupported_media_type'
  | 'not_found'
  | 'method_not_allowed'
  | 'internal_error'
  | (string & {});

/** An API failure: `status` is the HTTP status (0 for network errors). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** For 409 'conflict': the files that changed on the server (one for single-file requests). */
  readonly conflicts: Conflict[];
  /** For 429 'rate_limited': seconds to wait. */
  readonly retryAfter?: number;
  /** The whole error object the server sent. */
  readonly details: Record<string, unknown>;

  constructor(status: number, code: ApiErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    if (Array.isArray(details.conflicts)) this.conflicts = details.conflicts as Conflict[];
    else if (code === 'conflict' && typeof details.path === 'string') {
      this.conflicts = [{ path: details.path, current: (details.current as WorkFile | null) ?? null }];
    } else this.conflicts = [];
    if (typeof details.retryAfter === 'number') this.retryAfter = details.retryAfter;
  }

  get isConflict(): boolean {
    return this.code === 'conflict';
  }
}

/** The API root: `<Vite base>api`, e.g. '/logic2010/api'. */
function defaultBaseUrl(): string {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return base.replace(/\/*$/, '/') + 'api';
}

export interface ApiClientOptions {
  /** API root URL (no trailing slash), e.g. 'http://127.0.0.1:8710/logic2010/api'. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

const encodePath = (path: WorkPath) => path.split('/').map(encodeURIComponent).join('/');

export class ApiClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? defaultBaseUrl()).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, credentials: 'include', headers: { Accept: 'application/json' } };
    if (method !== 'GET') {
      init.headers = { ...init.headers, 'Content-Type': 'application/json', 'X-Logic2010': '1' };
      init.body = JSON.stringify(body ?? {});
    }
    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + path, init);
    } catch (err) {
      throw new ApiError(0, 'network', `Could not reach the server: ${String(err)}`);
    }
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const error = (data as { error?: Record<string, unknown> } | undefined)?.error;
      if (error && typeof error.code === 'string') {
        throw new ApiError(res.status, error.code, String(error.message ?? error.code), error);
      }
      throw new ApiError(res.status, 'http_error', `The server answered ${res.status} ${res.statusText}.`);
    }
    return data as T;
  }

  // --- account and session ---

  /** Creates an account and signs in. */
  async register(username: string, password: string): Promise<User> {
    return (await this.request<{ user: User }>('POST', '/account', { username, password })).user;
  }

  async login(username: string, password: string): Promise<User> {
    return (await this.request<{ user: User }>('POST', '/session', { username, password })).user;
  }

  async logout(): Promise<void> {
    await this.request('DELETE', '/session');
  }

  /** The signed-in user, or null. */
  async me(): Promise<User | null> {
    return (await this.request<{ user: User | null }>('GET', '/session')).user;
  }

  /** Changes the password; other sessions of this user are signed out. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request('PUT', '/account/password', { currentPassword, newPassword });
  }

  /** Deletes the signed-in user's account and all their work. */
  async deleteAccount(password: string): Promise<void> {
    await this.request('DELETE', '/account', { password });
  }

  // --- public ---

  /** Users, most recently active first; `query` filters by name (case-insensitive substring). */
  async listUsers(options: { query?: string; limit?: number; offset?: number } = {}): Promise<{ total: number; users: UserListing[] }> {
    const params = new URLSearchParams();
    if (options.query) params.set('q', options.query);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    const qs = params.toString();
    return this.request('GET', '/users' + (qs ? `?${qs}` : ''));
  }

  /** Anyone's work (read-only). */
  async getUserWork(username: string): Promise<UserWork> {
    return this.request('GET', `/users/${encodeURIComponent(username)}`);
  }

  // --- own work ---

  async getMyWork(): Promise<UserWork> {
    return this.request('GET', '/work');
  }

  /**
   * Saves one file. Pass the version the change is based on (0 for a new file); a stale
   * version throws an ApiError with code 'conflict' and the server's file in `conflicts[0]`.
   * `force` overwrites whatever is there.
   */
  async putFile(
    path: WorkPath,
    content: string,
    options: { summary?: WorkSummary; baseVersion?: number; force?: boolean },
  ): Promise<WorkFileMeta> {
    const body = { content, summary: options.summary, baseVersion: options.baseVersion, force: options.force };
    return (await this.request<{ file: WorkFileMeta }>('PUT', `/work/${encodePath(path)}`, body)).file;
  }

  /** Deletes one file (same concurrency rules as putFile). */
  async deleteFile(path: WorkPath, options: { baseVersion?: number; force?: boolean }): Promise<void> {
    await this.request('DELETE', `/work/${encodePath(path)}`, options);
  }

  /**
   * Saves several files atomically: if any is stale (and not `force`), nothing is written and
   * the ApiError lists every conflict.
   */
  async putFiles(files: FileUpload[], options: { force?: boolean } = {}): Promise<WorkFileMeta[]> {
    return (await this.request<{ files: WorkFileMeta[] }>('PUT', '/work', { files, force: options.force })).files;
  }
}

/** The client for this site's API. */
export const api = new ApiClient();
