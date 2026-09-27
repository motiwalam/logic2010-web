/**
 * Message catalogues and parameter substitution. Port of Message.java, MessageRef.java,
 * ErrorRef.java and MessageParamSource.java.
 *
 * A catalogue line is a TaggedRecord with the fields n (id), i or e (title; e marks an
 * error), x (text) and b (button spec, see DialogHandler). The global catalogue is loaded
 * with the program (loadProgram); each module has its own, loaded with loadModuleMessages.
 * Ids are looked up case-insensitively.
 */
import type { ScrambledReader } from '../data/Scrambler';
import { TaggedRecord } from '../data/TaggedRecord';
import { DelimitedTokenizer } from '../util/DelimitedTokenizer';
import { javaTrim, parseJavaInt } from '../util/java';

/** Parameters of a message: lower-case names to values. */
export type MessageParams = Map<string, string>;

/** Something that can supply a message parameter's value (MessageParamSource). */
export interface MessageParamSource {
  getParamValue(name: string): string | null;
}

export class Message {
  id: string;
  title: string;
  text = 'no further explanation available';
  buttons: string | null = null;
  isError = false;

  constructor(id: string) {
    this.id = id;
    this.title = id;
  }

  /** Message.parseMessages: a catalogue from the lines of a reader (keys in lower case). */
  static parseMessages(reader: ScrambledReader | null): Map<string, Message> | null {
    if (reader == null) return null;
    const table = new Map<string, Message>();
    const record = TaggedRecord.fromReader(reader, true);
    while (record.readNext()) {
      let i = record.indexOfTag('n');
      if (i === -1) continue;
      const message = new Message(javaTrim(record.values[i]));
      if ((i = record.indexOfAnyTag('ie')) !== -1) {
        message.title = javaTrim(record.values[i]);
        message.isError = record.tagAt(i) === 'e';
      }
      if ((i = record.indexOfTag('x')) !== -1) message.text = javaTrim(record.values[i]);
      if ((i = record.indexOfTag('b')) !== -1) message.buttons = record.values[i];
      table.set(message.id.toLowerCase(), message);
    }
    return table;
  }

  /** Message.get: the global message with the id; an unknown id gives the "bad error id" message. */
  static get(id: string): Message {
    return globalMessages?.get(id.toLowerCase()) ?? Message.badId(id, 'OK');
  }

  /**
   * The get of a module's Message subclass (DerivationMessage.get, ...): the message in the
   * module's catalogue. The "bad error id" message it gives for an unknown id has no buttons.
   */
  static getModule(moduleIndex: number, id: string): Message {
    return moduleMessages.get(moduleIndex)?.get(id.toLowerCase()) ?? Message.badId(id, null);
  }

  private static badId(id: string, buttons: string | null): Message {
    const message = new Message(id);
    message.title = 'bad error id';
    message.text = 'The program has encountered an unknown error id.  Please report this: ' + message.id;
    message.buttons = buttons;
    message.isError = true;
    return message;
  }

  /** Message.getText: the text of the global message with the id, or of the message. */
  static getText(idOrMessage: string | Message | null): string | null {
    if (idOrMessage == null) return null;
    return typeof idOrMessage === 'string' ? Message.get(idOrMessage).text : idOrMessage.text;
  }

  /** Message.indent: indents every line of s (lines are separated by the escape "\n") by n blanks. */
  static indent(s: string, n: number): string {
    let blanks = ' ';
    while (blanks.length < n) blanks += blanks;
    const prefix = blanks.substring(0, n);
    const sep = '\\n';
    let out = '';
    let j: number;
    do {
      if ((j = s.indexOf(sep)) === -1) {
        out += prefix + s;
      } else {
        out += prefix + s.substring(0, j + sep.length);
        s = s.substring(j + sep.length);
      }
    } while (j !== -1);
    return out;
  }

  /**
   * Message.substitute: replaces each <name> in s by the parameter's value (from params,
   * then from the sources). <indentN> indents the next value by N blanks; an unknown
   * parameter is kept as <name> (in lower case). Sets the plural parameter <s> from <n>
   * (in params, which is changed).
   */
  static substitute(s: string, params: MessageParams | null, sources?: readonly (MessageParamSource | null)[] | null): string;
  static substitute(s: string | null, params: MessageParams | null, sources?: readonly (MessageParamSource | null)[] | null): string | null;
  static substitute(
    s: string | null,
    params: MessageParams | null,
    sources: readonly (MessageParamSource | null)[] | null = null,
  ): string | null {
    if (s == null) return null;
    let out = '';
    let indent = 0;
    const open = new DelimitedTokenizer('\\<');
    const close = new DelimitedTokenizer('\\>');
    open.setInput(s);
    Message.addPluralSuffix(params);
    for (;;) {
      out += open.nextToken(true) ?? 'null';
      if (open.getDelimiter() !== '<') return out;
      close.setInput(open.getRemaining());
      const name = close.nextToken(true);
      if (close.getDelimiter() !== '>') return out + '<' + name;
      open.setInput(close.getRemaining());
      const key = (name ?? 'null').toLowerCase();
      if (key.length >= 6 && key.substring(0, 6) === 'indent') {
        indent = parseJavaInt(javaTrim(key.substring(6))) ?? 0;
      } else {
        let value: string | null | undefined;
        if (params != null && (value = params.get(key)) != null) out += Message.indent(value, indent);
        else if ((value = Message.lookupParam(sources, key)) != null) out += Message.indent(value, indent);
        else out += Message.indent('<' + key + '>', indent);
        indent = 0;
      }
    }
  }

  static lookupParam(sources: readonly (MessageParamSource | null)[] | null | undefined, name: string): string | null {
    for (const source of sources ?? []) {
      const value = source == null ? null : source.getParamValue(name);
      if (value != null) return value;
    }
    return null;
  }

  static putParam(params: MessageParams | null, name: string, value: string | null): MessageParams {
    const table = params ?? new Map<string, string>();
    table.set(name.toLowerCase(), value ?? '');
    return table;
  }

  /** Message.params(k1, v1, k2, v2, ...). */
  static params(...keyValues: (string | null)[]): MessageParams {
    let table: MessageParams = new Map();
    for (let i = 0; i + 1 < keyValues.length; i += 2) table = Message.putParam(table, keyValues[i] ?? 'null', keyValues[i + 1]);
    return table;
  }

  /**
   * Message.mergeParams(a, b) (LogicProgram.mergeTables(a, b, true)): a's entries are put
   * into b (a new table if b is null), replacing b's; returns b (b itself if a is null).
   */
  static mergeParams(a: MessageParams | null, b: MessageParams | null): MessageParams | null {
    if (a == null) return b;
    const out = b ?? new Map<string, string>();
    for (const [k, v] of a) out.set(k, v);
    return out;
  }

  /** Sets <s> to "s" unless <n> is 1, one, a, an or the. */
  static addPluralSuffix(params: MessageParams | null): void {
    if (params == null) return;
    let n = params.get('n');
    if (n == null) return;
    n = javaTrim(n).toLowerCase();
    params.set('s', n === '1' || n === 'one' || n === 'a' || n === 'an' || n === 'the' ? '' : 's');
  }
}

/** The global catalogue (Message.globalMessages); set by loadProgram. */
export let globalMessages: Map<string, Message> | null = null;

export function setGlobalMessages(table: Map<string, Message> | null): void {
  globalMessages = table;
}

/** The loaded module catalogues, by module index (the modules' messageClass tables). */
export const moduleMessages = new Map<number, Map<string, Message>>();

/** A message id with its parameters (MessageRef). */
export class MessageRef {
  constructor(
    public id: string,
    public params: MessageParams | null = null,
  ) {}

  getId(): string {
    return this.id;
  }

  getParams(): MessageParams | null {
    return this.params;
  }

  putParam(name: string, value: string | null): this {
    this.params = Message.putParam(this.params, name, value);
    return this;
  }
}

/** ErrorRef: a MessageRef that a server call (a ResponseHandler) can fill in. */
export class ErrorRef extends MessageRef {
  setError(id: string, params: MessageParams | null): void {
    this.id = id;
    this.params = params;
  }

  getError(): ErrorRef {
    return this;
  }
}
