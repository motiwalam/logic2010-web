/**
 * The student identity used for work-file digests. Port of the digest part of
 * UserInfo.java (computeDigest, the name fields) and of the user.txt format 2.
 *
 * The web program uses the desktop's local-mode user (localUser), so that exported work
 * files load in the desktop's local mode, and vice versa.
 */
import { Base64Codec } from '../util/Base64Codec';
import { Md5 } from '../util/Md5';
import { javaTrim, utf8Bytes } from '../util/java';
import { getCredentials } from './LogicProgram';

export const FIELD_KEYS = ['firstName', 'midName', 'lastName', 'studentID', 'email', 'institution', 'term', 'className'] as const;

export class UserInfo {
  readonly fields = new Map<string, string>();

  constructor(fields?: Record<string, string>) {
    for (const k of FIELD_KEYS) this.fields.set(k, '');
    if (fields) for (const [k, v] of Object.entries(fields)) this.fields.set(k, v);
  }

  /** The desktop's local-mode user (the user.txt it writes on first start in local mode). */
  static localUser(): UserInfo {
    return new UserInfo({
      firstName: 'Logic',
      midName: '',
      lastName: 'User',
      studentID: 'demo',
      email: '',
      institution: 'Demo',
      term: '',
      className: '',
      ident: '',
      derDigestVers: '1',
    });
  }

  /** Reads a user.txt in format 2 (first line "2", then key:value lines). Other formats give null. */
  static parse(text: string): UserInfo | null {
    const lines = text.split(/\r\n|\r|\n/);
    if (javaTrim(lines[0] ?? '') !== '2') return null;
    const user = new UserInfo();
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':');
      if (i !== -1) user.fields.set(line.substring(0, i), line.substring(i + 1));
    }
    return user;
  }

  get(key: string): string | null {
    return this.fields.get(key) ?? null;
  }

  put(key: string, value: string): void {
    this.fields.set(key, value);
  }

  getField(key: string, fallback: string): string {
    return this.fields.get(key) ?? fallback;
  }

  getFirstName(): string {
    return this.getField('firstName', '');
  }

  getMiddleName(): string {
    return this.getField('midName', '');
  }

  getLastName(): string {
    return this.getField('lastName', '');
  }

  getStudentId(): string {
    return this.getField('studentID', '');
  }

  getInstitution(): string {
    return this.getField('institution', '');
  }

  getFullName(): string {
    let s = this.getFirstName();
    s = javaTrim(s) + ' ' + javaTrim(this.getMiddleName());
    s = javaTrim(s) + ' ' + javaTrim(this.getLastName());
    return javaTrim(s);
  }

  /**
   * UserInfo.computeDigest: base64 MD5 over the user line and each record + "\n" (and the
   * `digest` credentials' password, if the options have one). version null (a module never
   * saved) uses "Name (id)", version "1" uses "Name (id@institution)", others no user line.
   */
  computeDigest(records: Iterable<string> | null = null, version: string | null = '1'): string {
    const md5 = new Md5();
    if (version == null) {
      md5.update(utf8Bytes(this.getFullName() + ' (' + this.getStudentId() + ')\n'));
    } else if (version === '1') {
      md5.update(utf8Bytes(this.getFullName() + ' (' + this.getStudentId() + '@' + this.getInstitution() + ')\n'));
    }
    if (records != null) for (const r of records) md5.update(utf8Bytes(r + '\n'));
    const credentials = getCredentials('digest');
    if (credentials != null && credentials.password != null) md5.update(utf8Bytes(credentials.password));
    return new Base64Codec(md5.digest()).toString();
  }
}
